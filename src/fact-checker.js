/**
 * fact-checker.js
 * Every REVIEW_INTERVAL_MS (default 3 min) automatically:
 *   1. Grabs segments added in the last 3 minutes from contextManager
 *   2. Auto-compacts the context window if it's getting full
 *   3. Sends recent transcript + summarised older context to Kimi
 *   4. Kimi uses the built-in `search` tool to verify factual claims
 *   5. Emits 'findings' with the result for the UI to display
 *
 * Emits:
 *   'findings'  — { text: string, searchCount: number }
 *   'error'     — Error
 */

'use strict';

const EventEmitter = require('events');

const REVIEW_INTERVAL_MS = parseInt(process.env.FACT_CHECK_INTERVAL_MS || String(3 * 60 * 1000));

// ── Kimi tool definition (OpenAI-format) ──────────────────────────────────────

const SEARCH_TOOL = {
  type    : 'function',
  function: {
    name       : 'search',
    description: 'Search the web to verify a factual claim. Use concise, targeted queries.',
    parameters : {
      type      : 'object',
      properties: {
        query: {
          type       : 'string',
          description: 'The search query (English preferred for best results)',
        },
      },
      required: ['query'],
    },
  },
};

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a real-time fact-checking assistant embedded in a conference call.

Every 3 minutes you receive:
- RECENT TRANSCRIPT: the last 3 minutes of conversation
- CONTEXT SUMMARY: compressed summary of the earlier conversation (for reference)

Your task:
1. Scan the RECENT TRANSCRIPT for specific, verifiable factual claims — especially:
   numbers, model names, parameter counts, benchmark scores, company names,
   dates, market figures, technical specifications, pricing, and named research.
2. For each claim worth checking, use the search() tool to verify it.
   Prioritise claims that sound specific but could be wrong or outdated.
3. Report ONLY genuine issues — do not flag vague statements or opinions.
4. Limit to 3 findings maximum per cycle. If nothing is wrong, say so briefly.

Output format (adapt language to match the transcript — Chinese if Chinese was spoken):
⚠️ CLAIM: "<exact quote>" → FINDING: <what search found> (Source: <url>)
✅ VERIFIED: "<claim>" is accurate.
— No issues found in this segment. (if nothing wrong)

Be concise. Each finding should be 1-2 sentences max.`;

// ─────────────────────────────────────────────────────────────────────────────

class FactChecker extends EventEmitter {
  /**
   * @param {object} config
   * @param {import('./agent-openrouter').AgentOpenRouter} config.agent
   * @param {import('./context-manager-v3').ContextManagerV3} config.contextManager
   * @param {import('./tools/search').SearchTool} config.searchTool
   * @param {string} [config.coreIdentity]  core identity prompt (shared, no session context)
   * @param {number} [config.intervalMs]   override interval (default 3 min)
   * @param {boolean} [config.enabled]
   */
  constructor (config = {}) {
    super();
    this.agent          = config.agent;
    this.contextManager = config.contextManager;
    this.searchTool     = config.searchTool;
    this.coreIdentity   = config.coreIdentity || '';
    this.intervalMs     = config.intervalMs || REVIEW_INTERVAL_MS;
    this.enabled        = config.enabled ?? (process.env.FACT_CHECK_ENABLED !== 'false');

    this._timer       = null;
    this._running     = false;  // prevent overlapping runs
    this._searchCount = 0;      // total searches this session
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start () {
    if (!this.enabled) return;
    if (this._timer) return;
    this._timer = setInterval(() => this._review(), this.intervalMs);
    console.log(`[FactChecker] Started — interval: ${this.intervalMs / 1000}s`);
  }

  stop () {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  async runNow () { return this._review(); }

  // ── Core review cycle ──────────────────────────────────────────────────────

  async _review () {
    if (this._running || !this.agent) return;
    this._running = true;

    try {
      // 1. Get segments from the last REVIEW_INTERVAL_MS
      const since   = Date.now() - this.intervalMs;
      const hasTimestamps = this.contextManager.segments.some(s => typeof s.addedAt === 'number');
      const recent  = hasTimestamps
        ? this.contextManager.segments.filter(s => (s.addedAt || 0) >= since)
        : this.contextManager.segments.slice(-10);

      if (recent.length === 0) return;  // nothing new spoken

      // 2. Auto-compact if approaching the threshold (>75% full)
      const stats = this.contextManager.getStats();
      if (stats.totalTokens > this.contextManager.compactThreshold * 0.75) {
        await this.contextManager._compact();
      }

      // 3. Build the review prompt
      const recentText  = recent.map(s => {
        const lang = s.language && s.language !== 'auto' ? `[${s.language.toUpperCase()}] ` : '';
        return `[${s.time}] ${lang}${s.text}`;
      }).join('\n');

      // Include compressed older context as background (summaries only — cheap tokens)
      const summaryContext = this.contextManager.summaries.length > 0
        ? '=== Earlier conversation (summarised) ===\n' +
          this.contextManager.summaries.map(s => `[${s.from}→${s.to}] ${s.summary}`).join('\n')
        : '';

      const userContent = [
        summaryContext ? `CONTEXT SUMMARY:\n${summaryContext}` : null,
        `RECENT TRANSCRIPT (last ${Math.round(this.intervalMs / 60000)} min):\n${recentText}`,
        '\nPlease verify any factual claims in the RECENT TRANSCRIPT using the search tool.',
      ].filter(Boolean).join('\n\n');

      // 4. Run Kimi with tool-calling
      const sessionSearchCount = { n: 0 };

      const result = await this.agent.chatWithTools(
        [
          { role: 'system', content: [this.coreIdentity, SYSTEM_PROMPT].filter(Boolean).join('\n\n') },
          { role: 'user',   content: userContent },
        ],
        [SEARCH_TOOL],
        {
          search: async ({ query }) => {
            sessionSearchCount.n++;
            this._searchCount++;
            try {
              const hits = await this.searchTool.search(query, 3);
              if (!hits || hits.length === 0) return 'No results found.';
              return hits.map(h => `[${h.title}] ${h.snippet} — ${h.url}`).join('\n');
            } catch (e) {
              return `Search error: ${e.message}`;
            }
          },
        },
        { maxIterations: 8, maxTokens: 1200 }
      );

      if (result && result.trim()) {
        this.emit('findings', {
          text       : result.trim(),
          searchCount: sessionSearchCount.n,
          segCount   : recent.length,
        });
      }

    } catch (err) {
      this.emit('error', err);
    } finally {
      this._running = false;
    }
  }
}

module.exports = { FactChecker };

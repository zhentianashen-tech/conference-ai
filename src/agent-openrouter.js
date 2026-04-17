/**
 * agent-openrouter.js
 * OpenAI-compatible analysis engine — works with Kimi (Moonshot), OpenRouter,
 * or any other OpenAI-compatible API endpoint.
 *
 * Key methods:
 *   chat(messages, opts)              → string  (single response)
 *   chatStream(messages, onChunk, opts) → string  (streams tokens, calls onChunk per delta)
 *   analyzeTranscript(...)            → string  (opinionated wrapper for proactive analysis)
 *   summarizeForCompaction(text)      → string  (for context-manager-v3 compaction)
 *   getConceptIntro(concept)          → string|null
 */

'use strict';

const EventEmitter = require('events');

// Default to Kimi; override with ANALYSIS_BASE_URL for other providers.
const DEFAULT_BASE = 'https://api.moonshot.cn/v1';

class AgentOpenRouter extends EventEmitter {
  /**
   * @param {object} config
   * @param {string} [config.apiKey]        OPENROUTER_API_KEY
   * @param {string} [config.model]         e.g. 'anthropic/claude-3.5-haiku'
   * @param {string} [config.fastModel]     cheaper model for compaction/concept lookups
   * @param {string} [config.siteUrl]       sent as HTTP-Referer (required by OpenRouter)
   * @param {string} [config.siteName]      sent as X-Title
   * @param {number} [config.maxTokens]     default 1024
   * @param {number} [config.temperature]   default 0.3
   */
  constructor (config = {}) {
    super();
    // API key: prefer MOONSHOT_API_KEY, fall back to OPENROUTER_API_KEY for compatibility
    this.apiKey      = config.apiKey    || process.env.MOONSHOT_API_KEY    || process.env.OPENROUTER_API_KEY;
    // Base URL: Kimi by default, overridable for other providers
    this.baseUrl     = config.baseUrl   || process.env.ANALYSIS_BASE_URL   || DEFAULT_BASE;
    this.model       = config.model     || process.env.ANALYSIS_MODEL      || process.env.OPENROUTER_MODEL || 'kimi-k2.5';
    this.fastModel   = config.fastModel || process.env.ANALYSIS_FAST_MODEL || this.model;
    this.maxTokens   = config.maxTokens   || parseInt(process.env.AGENT_MAX_TOKENS || '1024');
    // kimi-k2.5 is a thinking model — API rejects any temperature other than 1.
    // Force it unconditionally; ignore AGENT_TEMPERATURE env for kimi-k* models.
    this.temperature = this.model.startsWith('kimi-k')
      ? 1
      : (config.temperature ?? parseFloat(process.env.AGENT_TEMPERATURE || '0.3'));

    if (!this.apiKey) {
      console.warn('[Agent] No MOONSHOT_API_KEY set. Calls will fail.');
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  _headers () {
    return {
      'Authorization' : `Bearer ${this.apiKey}`,
      'Content-Type'  : 'application/json',
    };
  }

  async _post (body) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method  : 'POST',
      headers : this._headers(),
      body    : JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const host   = new URL(this.baseUrl).hostname;
      throw new Error(`[${host}] HTTP ${res.status}: ${detail}`);
    }
    return res;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Single-turn chat completion.
   * @param {Array<{role,content}>} messages
   * @param {object} [opts]
   * @returns {Promise<string>}
   */
  async chat (messages, opts = {}) {
    const res  = await this._post({
      model       : opts.model       || (opts.fast ? this.fastModel : this.model),
      messages,
      max_tokens  : opts.maxTokens   || this.maxTokens,
      temperature : opts.temperature ?? this.temperature,
      stream      : false,
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  /**
   * Streaming chat completion.
   * @param {Array<{role,content}>} messages
   * @param {function(delta:string, full:string):void} onChunk — called per token delta
   * @param {object} [opts]
   * @returns {Promise<string>} — full accumulated response
   */
  async chatStream (messages, onChunk, opts = {}) {
    const res = await this._post({
      model       : opts.model       || this.model,
      messages,
      max_tokens  : opts.maxTokens   || this.maxTokens,
      temperature : opts.temperature ?? this.temperature,
      stream      : true,
    });

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   full    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value, { stream: true }).split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const delta  = parsed.choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; onChunk(delta, full); }
        } catch { /* skip malformed */ }
      }
    }
    return full;
  }

  /**
   * Agentic tool-calling loop. Runs until the model stops requesting tools
   * or maxIterations is reached.
   *
   * @param {Array<{role,content}>} messages
   * @param {Array}   tools     — OpenAI-format tool definitions
   * @param {object}  handlers  — { toolName: async (args) => string }
   * @param {object}  [opts]
   * @param {number}  [opts.maxIterations=6]
   * @returns {Promise<string>} — final text response
   */
  async chatWithTools (messages, tools, handlers, opts = {}) {
    const maxIter = opts.maxIterations || 6;
    const msgs    = [...messages];

    for (let i = 0; i < maxIter; i++) {
      const res = await this._post({
        model      : opts.model || this.model,
        messages   : msgs,
        tools,
        max_tokens : opts.maxTokens || this.maxTokens,
        temperature: this.temperature,
        stream     : false,
      });
      const data   = await res.json();
      const choice = data.choices?.[0];
      const msg    = choice?.message;

      if (!msg) break;

      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // No more tool calls — return the final answer
        return msg.content || '';
      }

      // Append assistant message with tool_calls
      msgs.push({ role: 'assistant', content: msg.content || null, tool_calls: toolCalls });

      // Execute each tool call and append results
      for (const tc of toolCalls) {
        const handler = handlers[tc.function.name];
        let result    = `Unknown tool: ${tc.function.name}`;
        if (handler) {
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            result     = await handler(args);
          } catch (e) {
            result = `Tool error: ${e.message}`;
          }
        }
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
      }
    }

    return '(max tool iterations reached)';
  }

  // ── Opinionated wrappers ────────────────────────────────────────────────────

  /**
   * Full proactive analysis call — used by the main dialogue window.
   *
   * @param {string} baseSystemPrompt   — contents of prompts/base-system.txt
   * @param {string} sessionContext     — session-manager.buildSystemContext()
   * @param {string} transcriptContext  — context-manager-v3.buildContext()
   * @param {string} userQuery          — explicit user question, or empty string for proactive
   * @param {object} [opts]
   * @param {function} [opts.onChunk]   — if provided, streams the response
   * @returns {Promise<string>}
   */
  async analyzeTranscript (baseSystemPrompt, sessionContext, transcriptContext, userQuery, opts = {}) {
    const system = [baseSystemPrompt, sessionContext].filter(Boolean).join('\n\n---\n\n');

    const userContent = [
      transcriptContext ? `## Current Transcript\n${transcriptContext}` : null,
      userQuery         ? `## Query\n${userQuery}` : null,
    ].filter(Boolean).join('\n\n');

    const messages = [
      { role: 'system', content: system },
      { role: 'user',   content: userContent || 'Please provide a proactive analysis of the conference so far.' },
    ];

    if (opts.onChunk) {
      return this.chatStream(messages, opts.onChunk, opts);
    }
    return this.chat(messages, opts);
  }

  /**
   * Compact an old transcript block into a concise summary.
   * Called by context-manager-v3 when the context window fills up.
   *
   * @param {string} text — raw transcript block to compress
   * @returns {Promise<string>} bullet-point summary
   */
  async summarizeForCompaction (text) {
    const messages = [
      {
        role   : 'system',
        content: `You are a precise meeting summarizer. Compress the following transcript into 4-6 concise bullet points. Preserve:
- Key decisions made
- Action items and owners
- Important facts, numbers, and names
- Unresolved questions
Return ONLY the bullet points, no preamble.`,
      },
      { role: 'user', content: text },
    ];
    return this.chat(messages, { maxTokens: 500, temperature: 0.1, fast: true });
  }

  /**
   * Proactive analysis of recent segments for the ProactiveAnalyzerV3.
   * Returns parsed JSON.
   *
   * @param {string} recentText       — recent transcript text
   * @param {string[]} unansweredQs   — list of unanswered question strings
   * @param {string} sessionGoals     — session goals string
   * @returns {Promise<object|null>}  — { insights, coverage }
   */
  async analyzeProactive (recentText, unansweredQs = [], sessionGoals = '') {
    const unansweredStr = unansweredQs.length > 0
      ? `\nUnanswered session questions:\n${unansweredQs.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '';

    const goalsStr = sessionGoals
      ? `\nSession goals: ${sessionGoals}`
      : '';

    const messages = [
      {
        role   : 'system',
        content: `You are a real-time conference assistant performing proactive analysis. Return ONLY valid JSON.${goalsStr}`,
      },
      {
        role   : 'user',
        content: `Analyze this recent transcript.${unansweredStr}

Transcript:
${recentText}

Return JSON:
{
  "insights": [
    {
      "type": "action_item" | "decision" | "open_question" | "deadline" | "confusion" | "risk",
      "text": "concise description",
      "priority": "high" | "medium" | "low",
      "speaker": "name or null"
    }
  ],
  "addressed_question_indices": [0, 2],
  "new_topics": ["topic not in questionnaire"]
}

Only return JSON.`,
      },
    ];

    try {
      const raw    = await this.chat(messages, { maxTokens: 700, temperature: 0.15, fast: true });
      const match  = raw.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get a brief 1-2 sentence introduction for an unfamiliar concept.
   *
   * @param {string} concept — term or acronym
   * @returns {Promise<string|null>} — null if concept is too common / not a specific term
   */
  async getConceptIntro (concept) {
    const messages = [
      {
        role   : 'system',
        content: `You are a concise reference assistant. When given a technical term, acronym, or concept, provide a 1-2 sentence factual introduction. If the input is a generic common word (not a specific concept, technology, or proper noun), respond with exactly: NULL`,
      },
      { role: 'user', content: `Introduce: "${concept}"` },
    ];

    try {
      const response = await this.chat(messages, { maxTokens: 120, temperature: 0.1, fast: true });
      if (!response || response.trim() === 'NULL' || response.length < 15) return null;
      return response.trim();
    } catch {
      return null;
    }
  }

  getInfo () {
    return {
      provider : this.baseUrl.includes('moonshot') ? 'kimi' : 'openai-compatible',
      baseUrl  : this.baseUrl,
      model    : this.model,
    };
  }
}

module.exports = { AgentOpenRouter };

/**
 * context-manager-v3.js
 * Sliding context window + automatic compaction for long (60-min) conference calls.
 *
 * Strategy:
 *  - Maintain a rolling buffer of recent transcript segments.
 *  - Track cumulative token count (character-estimate, ~4 chars/token).
 *  - When the buffer exceeds COMPACT_THRESHOLD, take the oldest ~40% of
 *    segments, summarise them via the agent, and replace with a compact
 *    "SUMMARY BLOCK". The recent tail is always kept verbatim.
 *  - buildContext() returns: [SUMMARY BLOCKS...] + [RECENT SEGMENTS]
 *    which is injected into every analysis call as the transcript context.
 *
 * For a 60-min call at ~150 wpm (≈750 words/min × 60 = 45 000 words):
 *  With MAX_TOKENS=6000 and COMPACT_THRESHOLD=5000 we compact every ~20 min,
 *  keeping the window manageable for any model context limit.
 */

'use strict';

class ContextManagerV3 {
  /**
   * @param {object} [config]
   * @param {number} [config.maxTokens]           hard ceiling  (default: 6000)
   * @param {number} [config.compactThreshold]    trigger compaction (default: 5000)
   * @param {number} [config.summaryTargetTokens] target tokens for summary (default: 600)
   * @param {function} [config.summarizer]        async (text: string) => string
   *   Should be agent.summarizeForCompaction — wired in from index-v3.js
   * @param {function} [config.onCompaction]      optional hook after each compaction
   */
  constructor (config = {}) {
    this.maxTokens           = config.maxTokens           ?? parseInt(process.env.CONTEXT_MAX_TOKENS     || '6000');
    this.compactThreshold    = config.compactThreshold    ?? parseInt(process.env.CONTEXT_COMPACT_THRESH || '5000');
    this.summaryTargetTokens = config.summaryTargetTokens ?? parseInt(process.env.CONTEXT_SUMMARY_TOKENS || '600');
    this.summarizer          = config.summarizer          || null;
    this.onCompaction        = config.onCompaction        || null;

    /** @type {Segment[]}  live window */
    this.segments = [];

    /** @type {Summary[]}  compacted history */
    this.summaries = [];

    this._totalTokens    = 0;
    this._compacting     = false;
    this.compactionCount = 0;
  }

  // ── Token estimation ───────────────────────────────────────────────────────

  /** Fast char-based token estimate.  Good enough; avoids heavy tokenizer dep. */
  _estimate (text) { return Math.ceil((text || '').length / 4); }

  // ── Adding transcript segments ─────────────────────────────────────────────

  /**
   * Add one transcribed segment to the context window.
   *
   * @param {object} segment
   * @param {string}  segment.text      — transcript text
   * @param {string}  [segment.time]    — HH:MM:SS timestamp
   * @param {string}  [segment.language]— 'en' | 'zh' | …
   * @param {string}  [segment.speaker] — speaker label
   */
  addSegment (segment) {
    const tokens = this._estimate(segment.text);
    const entry  = {
      text    : segment.text,
      time    : segment.time     || _timestamp(),
      language: segment.language || null,
      speaker : segment.speaker  || null,
      addedAt : Date.now(),
      tokens,
    };

    this.segments.push(entry);
    this._totalTokens += tokens;

    if (this._totalTokens > this.compactThreshold && !this._compacting) {
      this._compact(); // fire-and-forget async
    }
  }

  // ── Compaction ─────────────────────────────────────────────────────────────

  async _compact () {
    if (this._compacting || this.segments.length < 4) return;
    this._compacting = true;

    try {
      // Determine how many segments to compress: enough to drop below threshold
      let tokensToRemove = this._totalTokens - this.compactThreshold + this.summaryTargetTokens;
      let cutoff         = 0;
      let accum          = 0;

      while (cutoff < this.segments.length && accum < tokensToRemove) {
        accum += this.segments[cutoff].tokens;
        cutoff++;
      }

      // Always keep at least the last 5 segments verbatim for immediate context
      cutoff = Math.min(cutoff, this.segments.length - 5);
      if (cutoff < 2) { this._compacting = false; return; }

      const toCompress = this.segments.splice(0, cutoff);
      const tokensOut  = toCompress.reduce((s, seg) => s + seg.tokens, 0);
      this._totalTokens -= tokensOut;

      // Build plain text of the block to summarise
      const block = toCompress.map(formatSegment).join('\n');

      let summaryText;
      if (this.summarizer) {
        try { summaryText = await this.summarizer(block); }
        catch { summaryText = _fallbackSummary(toCompress); }
      } else {
        summaryText = _fallbackSummary(toCompress);
      }

      const summaryTokens = this._estimate(summaryText);
      const entry = {
        from      : toCompress[0].time,
        to        : toCompress[toCompress.length - 1].time,
        segCount  : toCompress.length,
        summary   : summaryText,
        tokens    : summaryTokens,
      };

      this.summaries.push(entry);
      this._totalTokens += summaryTokens;
      this.compactionCount++;

      if (this.onCompaction) this.onCompaction(entry, this.getStats());

    } finally {
      this._compacting = false;
    }
  }

  // ── Context building ───────────────────────────────────────────────────────

  /**
   * Build the full transcript context string to inject into the analysis prompt.
   * Format:
   *   [Earlier transcript, summarised]
   *   ───────────────────────────────
   *   [Recent transcript, verbatim]
   *
   * @param {object} [opts]
   * @param {number} [opts.maxSegments]  cap recent segments (default: all)
   * @returns {string}
   */
  buildContext (opts = {}) {
    const parts = [];

    if (this.summaries.length > 0) {
      parts.push('╔══ EARLIER TRANSCRIPT (summarised) ══╗');
      this.summaries.forEach(s => {
        parts.push(`┃ [${s.from} → ${s.to}] ${s.summary}`);
      });
      parts.push('╚══════════════════════════════════════╝');
      parts.push('');
    }

    if (this.segments.length > 0) {
      parts.push('╔══ RECENT TRANSCRIPT ══╗');
      const segs = opts.maxSegments
        ? this.segments.slice(-opts.maxSegments)
        : this.segments;
      segs.forEach(s => parts.push(formatSegment(s)));
      parts.push('╚════════════════════════╝');
    }

    return parts.join('\n');
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  getStats () {
    return {
      segments     : this.segments.length,
      summaries    : this.summaries.length,
      totalTokens  : this._totalTokens,
      compactions  : this.compactionCount,
      utilizationPct: Math.round(this._totalTokens / this.maxTokens * 100),
    };
  }

  /** Last N segment texts, useful for proactive analysis. */
  getRecentTexts (n = 10) {
    return this.segments.slice(-n).map(s => s.text);
  }

  /** Last N segments as full objects. */
  getRecentSegments (n = 10) {
    return this.segments.slice(-n);
  }

  clear () {
    this.segments     = [];
    this.summaries    = [];
    this._totalTokens = 0;
    this.compactionCount = 0;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSegment (s) {
  const parts = [`[${s.time}]`];
  if (s.language) parts.push(`[${s.language.toUpperCase()}]`);
  if (s.speaker)  parts.push(`${s.speaker}:`);
  parts.push(s.text);
  return parts.join(' ');
}

function _timestamp () {
  const now = new Date();
  return [
    now.getHours().toString().padStart(2, '0'),
    now.getMinutes().toString().padStart(2, '0'),
    now.getSeconds().toString().padStart(2, '0'),
  ].join(':');
}

function _fallbackSummary (segments) {
  // Simple first-sentence extraction when no summarizer available
  const texts = segments.map(s => s.text).join(' ');
  const firstSentences = texts.split(/[.!?]/).slice(0, 4).join('. ').trim();
  return `[${segments.length} segments, ~${segments.reduce((a, s) => a + s.tokens, 0)} tokens] ${firstSentences}…`;
}

module.exports = { ContextManagerV3 };

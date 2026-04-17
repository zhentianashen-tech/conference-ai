'use strict';

/**
 * ContextManager
 *
 * Maintains a rolling window of transcript segments and user-pinned notes.
 * The agent reads from this to answer questions about the call.
 *
 * Design:
 *  - segments: ring buffer of the last N transcribed chunks
 *  - notes:    user-pinned items (persistent for the session)
 */

class ContextManager {
  /**
   * @param {object} options
   * @param {number} options.maxSegments - how many chunks to retain (default 15 ≈ 60s)
   */
  constructor(options = {}) {
    this.maxSegments = options.maxSegments || 15;
    this._segments   = [];  // { text: string, ts: Date }
    this._notes      = [];  // { text: string, ts: Date }
  }

  // ── Segments (live transcript) ──────────────────────────────────

  addSegment(text) {
    this._segments.push({ text, ts: new Date() });
    if (this._segments.length > this.maxSegments * 2) {
      // Keep the last maxSegments — trim silently
      this._segments = this._segments.slice(-this.maxSegments);
    }
  }

  getLastSegment() {
    if (this._segments.length === 0) return null;
    return this._segments[this._segments.length - 1].text;
  }

  segmentCount() {
    return this._segments.length;
  }

  // ── Notes (user-pinned) ─────────────────────────────────────────

  addNote(text) {
    this._notes.push({ text, ts: new Date() });
  }

  // ── Context string for LLM ──────────────────────────────────────

  /**
   * Returns a formatted string ready to inject into the LLM system prompt.
   * @param {number} [limit] - override maxSegments for this call
   */
  getFormattedContext(limit) {
    const n       = limit || this.maxSegments;
    const recent  = this._segments.slice(-n);
    const parts   = [];

    if (this._notes.length > 0) {
      parts.push('📌 User-pinned notes:');
      parts.push(this._notes.map((note) => `  • ${note.text}`).join('\n'));
      parts.push('');
    }

    if (recent.length === 0) {
      parts.push('(No transcript yet — call may have just started or audio is silent.)');
    } else {
      parts.push('🎙 Transcript (oldest → newest):');
      parts.push(
        recent
          .map((s) => {
            const t = _fmt(s.ts);
            return `  [${t}] ${s.text}`;
          })
          .join('\n')
      );
    }

    return parts.join('\n');
  }

  clear() {
    this._segments = [];
    this._notes    = [];
  }
}

// ── helper ───────────────────────────────────────────────────────────────────

function _fmt(date) {
  return date.toLocaleTimeString('en-US', {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

module.exports = { ContextManager };

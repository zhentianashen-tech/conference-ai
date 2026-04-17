/**
 * proactive-v3.js
 * Questionnaire-aware proactive conference assistant.
 *
 * Every PROACTIVE_INTERVAL seconds (default: 30s) this analyzer:
 *  1. Takes the latest transcript segments from the context manager.
 *  2. Asks the OpenRouter agent to detect insights AND check questionnaire coverage.
 *  3. Emits events that index-v3.js surfaces in the UI.
 *  4. Tracks which questionnaire questions have been addressed and notifies
 *     the session manager to mark them answered.
 *
 * Emitted events:
 *   'insight'            — { type, text, priority, speaker }
 *   'question_answered'  — { questionId, question, evidence }
 *   'question_reminder'  — { questionId, question, priority }  (unanswered, high-priority)
 *   'coverage_update'    — { total, answered, pct }
 *   'error'              — Error
 */

'use strict';

const EventEmitter = require('events');

// Minimum recent segments before we bother analysing
const MIN_SEGMENTS = 3;

// Priority → how often we surface a reminder (in intervals)
const REMINDER_EVERY = { high: 3, medium: 6, low: 12 };

class ProactiveAnalyzerV3 extends EventEmitter {
  /**
   * @param {object} config
   * @param {import('./agent-openrouter').AgentOpenRouter}  config.agent
   * @param {import('./session-manager').SessionManager}    config.sessionManager
   * @param {import('./context-manager-v3').ContextManagerV3} config.contextManager
   * @param {number}  [config.intervalMs]   — polling interval in ms (default: 30 000)
   * @param {string}  [config.level]        — 'low'|'medium'|'high' proactivity
   * @param {boolean} [config.enabled]
   */
  constructor (config = {}) {
    super();
    this.agent          = config.agent;
    this.sessionManager = config.sessionManager;
    this.contextManager = config.contextManager;

    this.intervalMs = config.intervalMs
      ?? parseInt(process.env.PROACTIVE_INTERVAL_SEC || '30') * 1000;
    this.level   = config.level   || process.env.PROACTIVE_LEVEL   || 'medium';
    this.enabled = config.enabled ?? (process.env.PROACTIVE_ENABLED !== 'false');

    this._timer          = null;
    this._intervalCount  = 0;
    /** track how many intervals each question has been unanswered (for reminder pacing) */
    this._reminderCounts = {};
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start () {
    if (!this.enabled) return;
    if (this._timer) return;
    this._timer = setInterval(() => this._run(), this.intervalMs);
    console.log(`[ProactiveV3] Started (interval: ${this.intervalMs / 1000}s, level: ${this.level})`);
  }

  stop () {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  /** Trigger one analysis cycle immediately (e.g. on user command). */
  async runNow () {
    return this._run();
  }

  // ── Core analysis cycle ────────────────────────────────────────────────────

  async _run () {
    if (!this.agent) return;
    this._intervalCount++;

    // Get recent segments from context manager
    const recent = this.contextManager
      ? this.contextManager.getRecentSegments(15)
      : [];

    if (recent.length < MIN_SEGMENTS) return;

    const recentText = recent.map(s => {
      const lang    = s.language ? `[${s.language.toUpperCase()}]` : '';
      const speaker = s.speaker  ? `${s.speaker}: ` : '';
      return `${lang} ${speaker}${s.text}`;
    }).join('\n');

    // Build unanswered questions list for the prompt
    const unanswered = this.sessionManager
      ? this.sessionManager.getUnansweredQuestions()
      : [];
    const unansweredStrings = unanswered.map(q => q.question);

    // Session goals summary
    const goals = this.sessionManager?.getGoals().join('; ') || '';

    try {
      const result = await this.agent.analyzeProactive(recentText, unansweredStrings, goals);
      if (result) this._processResult(result, recentText, unanswered);
    } catch (err) {
      this.emit('error', err);
    }

    // Separately: surface reminders for high-priority unanswered questions
    this._emitReminders(unanswered, recentText);
  }

  _processResult (result, recentText, unanswered) {
    // 1. Surface insights
    const minPriority = { low: 0, medium: 1, high: 2 }[this.level] ?? 1;
    const priorityRank = { low: 0, medium: 1, high: 2 };

    for (const insight of result.insights || []) {
      if ((priorityRank[insight.priority] ?? 0) >= minPriority) {
        this.emit('insight', {
          type    : insight.type     || 'general',
          text    : insight.text     || '',
          priority: insight.priority || 'medium',
          speaker : insight.speaker  || null,
        });
      }
    }

    // 2. Check questionnaire coverage using the agent's addressed_question_indices
    const addressed = result.addressed_question_indices || [];
    addressed.forEach(idx => {
      const q = unanswered[idx];
      if (!q) return;
      const evidence = recentText.substring(0, 150);
      this.sessionManager?.markAnswered(q.id, evidence);
      this.emit('question_answered', { questionId: q.id, question: q.question, evidence });
    });

    // Fallback: keyword heuristic for any question the agent missed
    if (this.sessionManager) {
      const keywordMatches = this.sessionManager.findAddressedBy(recentText);
      keywordMatches.forEach(q => {
        if (!this.sessionManager.questionnaireStatus[q.id]?.answered) {
          this.sessionManager.markAnswered(q.id, recentText.substring(0, 150));
          this.emit('question_answered', { questionId: q.id, question: q.question });
        }
      });
    }

    // 3. Emit updated coverage
    const cov = this.sessionManager?.getCoverage();
    if (cov) this.emit('coverage_update', cov);
  }

  _emitReminders (unanswered, recentText) {
    const recentLower = recentText.toLowerCase();

    unanswered.forEach(q => {
      const priority = q.priority || 'medium';
      const every    = REMINDER_EVERY[priority] ?? 6;

      if (this._intervalCount % every !== 0) return;

      // Don't remind if it's clearly being discussed right now
      const activelyDiscussed = q.keywords.some(kw => recentLower.includes(kw.toLowerCase()));
      if (activelyDiscussed) return;

      this.emit('question_reminder', {
        questionId: q.id,
        question  : q.question,
        priority,
      });
    });
  }
}

module.exports = { ProactiveAnalyzerV3 };

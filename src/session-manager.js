/**
 * session-manager.js
 * Loads per-conference session files (YAML or JSON) and tracks questionnaire state.
 *
 * Session file schema (YAML):
 *
 *   title: "Session Name"
 *   date:  "2026-04-15"
 *   participants: [Alan, Guest]
 *   background: |
 *     Multi-line background text.
 *   goals:
 *     - Understand X
 *     - Clarify Y
 *   questionnaire:
 *     - id: q1
 *       question: "What is the budget range?"
 *       keywords: [budget, cost, price, investment]
 *       priority: high    # high | medium | low
 *   notes: |
 *     Additional free-form notes injected into the system context.
 *
 * Usage:
 *   const sm = new SessionManager();
 *   sm.load('./sessions/my-call.yaml');
 *   const ctx = sm.buildSystemContext();
 *   sm.markAnswered('q1', 'Speaker mentioned $2M budget');
 *   const missing = sm.getUnansweredQuestions('high');
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// js-yaml is a small, zero-dep YAML parser. If not installed, falls back to JSON.
let yaml;
try { yaml = require('js-yaml'); } catch { yaml = null; }

class SessionManager {
  constructor () {
    /** @type {object|null} raw parsed session data */
    this.session = null;

    /** @type {Record<string, QuestionState>} question tracking by id */
    this.questionnaireStatus = {};

    /** @type {string|null} path of the loaded file */
    this.loadedFrom = null;
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  /**
   * Load a session file. Supports .yaml / .yml / .json.
   * @param {string} filePath — absolute or relative path
   * @returns {object} parsed session object
   */
  load (filePath) {
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Session file not found: ${fullPath}`);
    }

    const raw = fs.readFileSync(fullPath, 'utf8');
    const ext = path.extname(fullPath).toLowerCase();

    if (ext === '.json') {
      this.session = JSON.parse(raw);
    } else if (ext === '.yaml' || ext === '.yml') {
      if (!yaml) throw new Error('js-yaml not installed. Run: npm install js-yaml');
      this.session = yaml.load(raw);
    } else {
      // Try YAML first, fall back to JSON
      try {
        this.session = yaml ? yaml.load(raw) : JSON.parse(raw);
      } catch {
        this.session = JSON.parse(raw);
      }
    }

    this.loadedFrom = fullPath;
    this._initQuestionnaireStatus();

    console.log(`[SessionManager] Loaded: ${this.session.title || path.basename(fullPath)}`);
    console.log(`[SessionManager] ${Object.keys(this.questionnaireStatus).length} questionnaire items`);

    return this.session;
  }

  /**
   * Load session data directly from an object (useful for testing).
   * @param {object} data
   */
  loadObject (data) {
    this.session    = data;
    this.loadedFrom = null;
    this._initQuestionnaireStatus();
    return this.session;
  }

  _initQuestionnaireStatus () {
    this.questionnaireStatus = {};
    const items = this.session?.questionnaire || [];
    items.forEach(item => {
      if (!item.id) item.id = `q${Math.random().toString(36).slice(2, 7)}`;
      this.questionnaireStatus[item.id] = {
        id         : item.id,
        question   : item.question,
        keywords   : item.keywords || [],
        priority   : (item.priority || 'medium').toLowerCase(),
        answered   : false,
        answeredAt : null,
        evidence   : null,
      };
    });
  }

  // ── Context building ───────────────────────────────────────────────────────

  /**
   * Build the session section of the system prompt.
   * Returns a markdown-formatted string injected after the base system prompt.
   * @returns {string}
   */
  buildSystemContext () {
    if (!this.session) return '';

    const lines = [];

    lines.push('## ═══ SESSION CONTEXT ═══');
    lines.push(`**Session:** ${this.session.title || 'Conference Call'}`);

    if (this.session.date)                lines.push(`**Date:** ${this.session.date}`);
    if (this.session.participants?.length) {
      lines.push(`**Participants:** ${this.session.participants.join(', ')}`);
    }

    if (this.session.background) {
      lines.push('');
      lines.push('### Background');
      lines.push(this.session.background.trim());
    }

    if (this.session.goals?.length) {
      lines.push('');
      lines.push('### Session Goals');
      this.session.goals.forEach((g, i) => lines.push(`${i + 1}. ${g}`));
    }

    const items = Object.values(this.questionnaireStatus);
    if (items.length > 0) {
      lines.push('');
      lines.push('### Questionnaire (track coverage during the call)');
      lines.push('Items marked ✅ have been addressed; ❓ are still open.');
      lines.push('');

      // Group by priority
      ['high', 'medium', 'low'].forEach(priority => {
        const group = items.filter(q => q.priority === priority);
        if (group.length === 0) return;
        lines.push(`**${priority.toUpperCase()} PRIORITY**`);
        group.forEach(q => {
          const mark = q.answered ? '✅' : '❓';
          lines.push(`${mark} \`${q.id}\` — ${q.question}`);
        });
        lines.push('');
      });
    }

    if (this.session.notes) {
      lines.push('### Additional Notes');
      lines.push(this.session.notes.trim());
    }

    lines.push('## ═══════════════════════');
    return lines.join('\n');
  }

  // ── Questionnaire tracking ─────────────────────────────────────────────────

  /**
   * Return all questions that haven't been answered yet.
   * @param {'high'|'medium'|'low'|null} priority — filter by priority, or null for all
   * @returns {QuestionState[]}
   */
  getUnansweredQuestions (priority = null) {
    return Object.values(this.questionnaireStatus).filter(q => {
      if (q.answered) return false;
      if (priority   && q.priority !== priority) return false;
      return true;
    });
  }

  /**
   * Return questions most likely addressed by a given text (keyword heuristic).
   * @param {string} text
   * @returns {QuestionState[]}
   */
  findAddressedBy (text) {
    const lower = text.toLowerCase();
    return Object.values(this.questionnaireStatus).filter(q => {
      if (q.answered) return false;
      return q.keywords.some(kw => lower.includes(kw.toLowerCase()));
    });
  }

  /**
   * Mark a question as answered.
   * @param {string} questionId
   * @param {string|null} evidence — short excerpt from transcript
   */
  markAnswered (questionId, evidence = null) {
    const q = this.questionnaireStatus[questionId];
    if (!q) return;
    q.answered   = true;
    q.answeredAt = new Date().toISOString();
    q.evidence   = evidence || null;
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  /** Flat list of all keyword strings across the questionnaire. */
  getKeywords () {
    return Object.values(this.questionnaireStatus).flatMap(q => q.keywords);
  }

  /** Coverage summary: { total, answered, pct } */
  getCoverage () {
    const total    = Object.keys(this.questionnaireStatus).length;
    const answered = Object.values(this.questionnaireStatus).filter(q => q.answered).length;
    return { total, answered, pct: total ? Math.round(answered / total * 100) : 0 };
  }

  /** List of goal strings, or [] */
  getGoals () {
    return this.session?.goals || [];
  }

  /** Human-readable progress report */
  getProgressReport () {
    const cov   = this.getCoverage();
    const open  = this.getUnansweredQuestions();
    const lines = [
      `Coverage: ${cov.answered}/${cov.total} (${cov.pct}%)`,
    ];
    if (open.length > 0) {
      lines.push('Open questions:');
      open.forEach(q => lines.push(`  ❓ [${q.priority}] ${q.question}`));
    }
    return lines.join('\n');
  }

  isLoaded () { return this.session !== null; }
}

module.exports = { SessionManager };

/**
 * @typedef {object} QuestionState
 * @property {string}      id
 * @property {string}      question
 * @property {string[]}    keywords
 * @property {string}      priority
 * @property {boolean}     answered
 * @property {string|null} answeredAt
 * @property {string|null} evidence
 */

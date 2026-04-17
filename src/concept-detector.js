/**
 * concept-detector.js
 * Detects concepts, acronyms, and technical terms mentioned in the transcript
 * that are NOT covered by the session questionnaire, and proactively generates
 * a brief 1-2 sentence introduction for each in the dialogue window.
 *
 * Emitted events:
 *   'concept'  — { concept: string, intro: string, language: 'en'|'zh' }
 *
 * Design choices:
 *  - Regex-based extraction keeps latency near-zero on the hot path.
 *  - Agent calls happen async in a throttled queue (one at a time, with
 *    MIN_DELAY between calls) to avoid overwhelming the API.
 *  - knownConcepts set prevents re-processing already-seen terms.
 *  - Session keywords are pre-seeded so covered topics are ignored.
 *  - Chinese concept detection uses a CJK character block heuristic to catch
 *    Chinese acronyms / proper-noun phrases alongside English ones.
 */

'use strict';

const EventEmitter = require('events');

// ── Heuristics ────────────────────────────────────────────────────────────────

/** English patterns worth investigating */
const EN_PATTERNS = [
  // ALL-CAPS acronyms 2-6 letters (exclude common words)
  /\b([A-Z]{2,6})\b/g,
  // CamelCase compound terms (TensorFlow, OpenRouter, etc.)
  /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g,
  // Hyphenated technical terms > 8 chars (fine-tuning, retrieval-augmented, etc.)
  /\b([a-z]+-[a-z]+(?:-[a-z]+)?)\b/g,
];

/** Common English words that look like acronyms — skip these */
const EN_STOPWORDS = new Set([
  'A','I','OK','US','UK','EU','CEO','CFO','CTO','AI','ML','IP',
  'IT','HR','PR','UI','UX','API','SDK','URL','HTTP','JSON','CSV',
  'PDF','HTML','CSS','JS','SQL','DB','ID','AM','PM','ET','PT','EST',
]);

/** CJK range for Chinese character detection */
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]{2,8}/g;

// ─────────────────────────────────────────────────────────────────────────────

class ConceptDetector extends EventEmitter {
  /**
   * @param {object} config
   * @param {import('./agent-openrouter').AgentOpenRouter} config.agent
   * @param {import('./session-manager').SessionManager}  [config.sessionManager]
   * @param {number} [config.minDelayMs]   min ms between API calls (default: 4000)
   * @param {number} [config.maxQueueSize] cap the queue (default: 20)
   */
  constructor (config = {}) {
    super();
    this.agent          = config.agent;
    this.sessionManager = config.sessionManager;
    this.minDelayMs     = config.minDelayMs     ?? parseInt(process.env.CONCEPT_DELAY_MS   || '4000');
    this.maxQueueSize   = config.maxQueueSize    ?? parseInt(process.env.CONCEPT_QUEUE_MAX  || '20');

    /** Terms we've already processed (or chose to ignore) */
    this.knownConcepts = new Set();

    /** Async processing queue */
    this._queue          = [];
    this._processing     = false;
    this._lastProcessed  = 0;

    // Pre-seed from session keywords so we don't look up covered topics
    this._seedFromSession();
  }

  _seedFromSession () {
    const keywords = this.sessionManager?.getKeywords() || [];
    keywords.forEach(kw => this.knownConcepts.add(kw.toLowerCase()));

    // Also seed with the stop-words list
    EN_STOPWORDS.forEach(w => this.knownConcepts.add(w.toLowerCase()));
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  /**
   * Analyse a transcript segment for unknown concepts.
   * Call this every time a new transcript segment arrives.
   *
   * @param {string} text
   * @param {string} [language]  'en' | 'zh' | …
   */
  analyze (text, language = 'en') {
    const candidates = this._extract(text, language);

    candidates.forEach(concept => {
      const key = concept.toLowerCase();
      if (this.knownConcepts.has(key)) return;
      if (this._queue.length >= this.maxQueueSize) return;

      // Mark as seen immediately so parallel segments don't double-queue it
      this.knownConcepts.add(key);
      this._queue.push({ concept, language });
    });

    this._processQueue();
  }

  // ── Extraction heuristics ─────────────────────────────────────────────────

  _extract (text, language) {
    const results = new Set();

    // English heuristics always run
    for (const pattern of EN_PATTERNS) {
      let m;
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      while ((m = pattern.exec(text)) !== null) {
        const term = m[1];
        if (term.length < 2 || EN_STOPWORDS.has(term)) continue;
        if (_isCommonWord(term)) continue;
        results.add(term);
      }
    }

    // Chinese: extract CJK noun phrases (≥2 characters)
    // We only add them to the queue if they look like proper nouns or
    // technical terms — we'll let the LLM decide via getConceptIntro.
    if (language === 'zh' || _hasChinese(text)) {
      let m;
      CJK_RE.lastIndex = 0;
      while ((m = CJK_RE.exec(text)) !== null) {
        const phrase = m[0];
        // Crude filter: skip very common Chinese filler phrases
        if (_isCommonChinese(phrase)) continue;
        results.add(phrase);
      }
    }

    return [...results];
  }

  // ── Queue processing ───────────────────────────────────────────────────────

  async _processQueue () {
    if (this._processing || this._queue.length === 0) return;
    this._processing = true;

    while (this._queue.length > 0) {
      // Throttle
      const elapsed = Date.now() - this._lastProcessed;
      if (elapsed < this.minDelayMs) {
        await _sleep(this.minDelayMs - elapsed);
      }

      const { concept, language } = this._queue.shift();
      this._lastProcessed = Date.now();

      try {
        const intro = await this.agent.getConceptIntro(concept);
        if (intro) {
          this.emit('concept', { concept, intro, language });
        }
      } catch (err) {
        // Silent fail — this is background work, don't disrupt the call
      }
    }

    this._processing = false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A very rough check: is this just a plain English word in common use? */
function _isCommonWord (term) {
  // If it's all lowercase and short, likely a regular word not a tech term
  if (term === term.toLowerCase() && term.length <= 5) return true;
  // Skip common English words even if they appear uppercase mid-sentence
  const COMMON = new Set([
    'the','and','for','are','but','not','you','all','can','had',
    'her','was','one','our','out','day','get','has','him','his',
    'how','man','new','now','old','see','two','way','who','boy',
    'did','its','let','put','say','she','too','use',
  ]);
  return COMMON.has(term.toLowerCase());
}

/** Does the string contain any CJK characters? */
function _hasChinese (text) {
  return /[\u4e00-\u9fff]/.test(text);
}

/** Very rough filter for common Mandarin filler/function words */
function _isCommonChinese (phrase) {
  const COMMON_ZH = new Set([
    '然后','因为','所以','但是','还是','如果','可以','这个','那个',
    '我们','你们','他们','她们','什么','怎么','为什么','谢谢','对不',
    '没有','一下','这样','那样','好的','是的','可能','应该','需要',
  ]);
  return COMMON_ZH.has(phrase);
}

function _sleep (ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { ConceptDetector };

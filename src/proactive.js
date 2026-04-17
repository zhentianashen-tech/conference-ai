'use strict';

/**
 * ProactiveAnalyzer
 *
 * Background analysis of conversation to provide intelligent suggestions.
 * Detects: decisions, action items, questions, deadlines, confusion, topics
 */

const { EventEmitter } = require('events');
const nlp = require('compromise');

const PATTERNS = {
  decision: [
    /let's go with|we'll go with|decided to|agreed to|settled on|chose|opted for/i,
    /we're going with|the decision is|final answer is/i,
    /let's (do|use|pick|choose)|we should (do|use)/i,
  ],
  actionItem: [
    /I will|you need to|we need to|someone should/i,
    /follow up on|get back to|send me|schedule a|set up a/i,
    /take care of|handle the|work on the|prepare the/i,
  ],
  question: [
    /what about|how do we|can you|could you|would you/i,
    /what's the|where is|when is|who is|why are/i,
    /do we|does it|is there|are we|have you/i,
  ],
  deadline: [
    /by (Monday|Tuesday|Wednesday|Thursday|Friday|tomorrow|next week)/i,
    /this (week|month|quarter)|end of (day|week|month)/i,
    /due date|deadline is|need it by/i,
  ],
  confusion: [
    /I don't understand|confused about|not sure|unclear/i,
    /can you repeat|say that again|what do you mean/i,
    /didn't catch that|missed that|didn't hear/i,
  ],
};

const SEARCH_TRIGGERS = [
  /who is|what is/i,
  /latest|recent|news about|update on/i,
  /price of|cost of|stock price/i,
  /definition of|meaning of/i,
];

class ProactiveAnalyzer extends EventEmitter {
  constructor(contextManager) {
    super();
    this.context = contextManager;
    this.enabled = process.env.PROACTIVE_ENABLED !== 'false';
    this.level = process.env.PROACTIVE_LEVEL || 'medium';
    this.interval = parseInt(process.env.PROACTIVE_INTERVAL || '10', 10) * 1000;
    this.cooldown = parseInt(process.env.PROACTIVE_COOLDOWN || '30', 10) * 1000;
    
    this._timer = null;
    this._lastSuggestion = 0;
    this._analyzedSegments = new Set();
    this._entities = new Set();
    
    console.log(`[Proactive] Enabled: ${this.enabled}, Level: ${this.level}`);
  }

  start() {
    if (!this.enabled) return;
    this._timer = setInterval(() => this._analyze(), this.interval);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _analyze() {
    const segments = this.context._segments || [];
    if (segments.length === 0) return;
    
    const recent = segments.slice(-5);
    const newSegments = recent.filter(s => !this._analyzedSegments.has(String(s.ts)));
    
    if (newSegments.length === 0) return;
    
    newSegments.forEach(s => this._analyzedSegments.add(String(s.ts)));
    
    const fullText = recent.map(s => s.text).join(' ');
    
    try {
      const doc = nlp(fullText);
      const people = doc.people().out('array');
      const orgs = doc.organizations().out('array');
      [...people, ...orgs].forEach(e => { if (e.length > 2) this._entities.add(e); });
    } catch (e) {}
    
    const now = Date.now();
    if (now - this._lastSuggestion < this.cooldown) return;
    
    const suggestion = this._detectSuggestion(fullText);
    if (suggestion) {
      this._lastSuggestion = now;
      this.emit('suggestion', suggestion);
    }
  }

  _detectSuggestion(text) {
    if (PATTERNS.actionItem.some(p => p.test(text))) {
      return {
        type: 'action_item',
        priority: 'high',
        icon: '5449',
        title: 'Action Item Detected',
        message: 'Possible action item detected in conversation',
        actions: ['pin', 'search', 'ignore'],
      };
    }
    
    if (PATTERNS.decision.some(p => p.test(text))) {
      return {
        type: 'decision',
        priority: 'high',
        icon: '127919',
        title: 'Decision Made',
        message: 'A decision appears to have been reached',
        actions: ['summarize', 'pin', 'ignore'],
      };
    }
    
    if (this.level !== 'low') {
      if (PATTERNS.question.some(p => p.test(text))) {
        return {
          type: 'question',
          priority: 'medium',
          icon: '10067',
          title: 'Question Raised',
          message: 'A question was detected - search for answer?',
          actions: ['search', 'note', 'ignore'],
        };
      }
      
      if (PATTERNS.deadline.some(p => p.test(text))) {
        return {
          type: 'deadline',
          priority: 'medium',
          icon: '9200',
          title: 'Deadline Mentioned',
          message: 'A deadline or timeline was discussed',
          actions: ['pin', 'ignore'],
        };
      }
      
      if (PATTERNS.confusion.some(p => p.test(text))) {
        return {
          type: 'confusion',
          priority: 'medium',
          icon: '129300',
          title: 'Clarification Needed',
          message: 'Someone may need clarification',
          actions: ['help', 'ignore'],
        };
      }
    }
    
    if (this.level === 'high') {
      if (SEARCH_TRIGGERS.some(p => p.test(text))) {
        return {
          type: 'search_suggestion',
          priority: 'low',
          icon: '128269',
          title: 'Search Suggested',
          message: 'Search for mentioned topic?',
          actions: ['search', 'ignore'],
        };
      }
    }
    
    return null;
  }

  getEntities() {
    return Array.from(this._entities);
  }
}

module.exports = { ProactiveAnalyzer };

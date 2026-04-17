'use strict';

/**
 * Agent V2 with Two-Layer System Prompts
 *
 * Architecture:
 *   Layer 1 (Base): Persistent system prompt - core identity & behavior
 *   Layer 2 (Session): Dynamic session context - meeting-specific instructions
 *   Context: Live transcript
 *   History: Recent conversation
 *   User Query: Current question
 *
 * Tools:
 *   - Web search integration
 *   - Gemini API for enhanced analysis
 */

const { OpenAI } = require('openai');
const { SearchTool } = require('./tools/search');
const { GeminiTool } = require('./tools/gemini');
const { PromptManager } = require('./prompt-manager');

const SUMMARY_PROMPT = `Produce a structured call summary:
1. Key topics discussed
2. Decisions or agreements made
3. Action items (who needs to do what)
4. Names/companies/numbers mentioned
5. Open questions

Use short bullet points.`;

class AgentV2 {
  constructor(context) {
    this.context = context;
    this.history = [];
    
    // Initialize two-layer prompt manager
    this.promptManager = new PromptManager();
    
    this.client = new OpenAI({
      apiKey: process.env.AGENT_API_KEY || process.env.OPENAI_API_KEY || 'none',
      baseURL: process.env.AGENT_BASE_URL || undefined,
    });
    this.model = process.env.AGENT_MODEL || 'gemma3:12b';
    
    this.searchTool = new SearchTool();
    this.geminiTool = new GeminiTool();
    
    this.useGeminiPrimary = process.env.USE_GEMINI_PRIMARY === 'true' && this.geminiTool.enabled;
    
    console.log(`[AgentV2] Model: ${this.useGeminiPrimary ? 'Gemini' : this.model}`);
    console.log(`[AgentV2] Two-layer prompts: Layer 1 (Base) + Layer 2 (Session)`);
  }

  /**
   * Set up a new session with specific context (Layer 2)
   */
  setSessionContext(sessionConfig) {
    return this.promptManager.setSessionContext(sessionConfig);
  }

  /**
   * Update current session context
   */
  updateSessionContext(updates) {
    return this.promptManager.updateSessionContext(updates);
  }

  /**
   * Add a goal to current session
   */
  addSessionGoal(goal) {
    return this.promptManager.addSessionGoal(goal);
  }

  /**
   * Get current session info
   */
  getSessionInfo() {
    return this.promptManager.getSessionInfo();
  }

  /**
   * End current session
   */
  endSession() {
    this.promptManager.clearSession();
    this.resetHistory();
  }

  async query(userMessage) {
    const shouldSearch = this._shouldSearch(userMessage);
    
    if (shouldSearch) {
      return this._queryWithSearch(userMessage);
    }
    
    return this._queryStandard(userMessage);
  }

  _shouldSearch(message) {
    const triggers = [
      'who is', 'what is', 'where is', 'when did', 'why does',
      'how to', 'latest', 'recent news', 'price', 'stock',
      'definition', 'meaning of', 'search for'
    ];
    const lower = message.toLowerCase();
    return triggers.some(t => lower.includes(t));
  }

  /**
   * Build complete system prompt with both layers
   */
  _buildSystemPrompt() {
    const ctx = this.context.getFormattedContext();
    const twoLayerPrompt = this.promptManager.getCompleteSystemPrompt();
    
    return `${twoLayerPrompt}

=== LIVE TRANSCRIPT ===
${ctx}

Remember: Follow your core guidelines while prioritizing session-specific goals.`;
  }

  async _queryStandard(userMessage) {
    const systemPrompt = this._buildSystemPrompt();
    
    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.history.slice(-8),
      { role: 'user', content: userMessage },
    ];

    let reply;
    
    if (this.useGeminiPrimary) {
      const prompt = this._messagesToPrompt(messages);
      reply = await this.geminiTool.generate(prompt, { maxTokens: 350 });
    } else {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: 350,
        temperature: 0.3,
      });
      reply = response.choices[0].message.content.trim();
    }

    this._updateHistory(userMessage, reply);
    return reply;
  }

  async _queryWithSearch(userMessage) {
    const searchResults = await this.searchTool.search(userMessage, 5);
    const systemPrompt = this._buildSystemPrompt();
    
    const searchContext = searchResults.map((r, i) => 
      `[${i + 1}] ${r.title}\n${r.snippet}`
    ).join('\n\n');

    const prompt = `${systemPrompt}

=== WEB SEARCH RESULTS ===
${searchContext}

=== USER QUESTION ===
${userMessage}

Provide a concise answer (2-4 sentences) based on the transcript and search results. Cite sources if relevant.`;

    let reply;
    
    if (this.geminiTool.enabled) {
      reply = await this.geminiTool.generate(prompt, { maxTokens: 400 });
    } else {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Web search results:\n\n${searchContext}\n\nQuestion: ${userMessage}` },
        ],
        max_tokens: 400,
        temperature: 0.3,
      });
      reply = response.choices[0].message.content.trim();
    }

    const sources = searchResults.slice(0, 3).map(r => r.url).filter(Boolean);
    if (sources.length > 0) {
      reply += `\n\nSources: ${sources.slice(0, 2).join(', ')}`;
    }

    this._updateHistory(userMessage, reply);
    return reply;
  }

  async summarize() {
    const systemPrompt = this._buildSystemPrompt();
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${SUMMARY_PROMPT}\n\nProduce a comprehensive summary focusing on the session goals.` },
    ];

    let summary;
    
    if (this.useGeminiPrimary) {
      const prompt = this._messagesToPrompt(messages);
      summary = await this.geminiTool.generate(prompt, { maxTokens: 700 });
    } else {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: 700,
        temperature: 0.2,
      });
      summary = response.choices[0].message.content.trim();
    }

    return summary;
  }

  async search(query) {
    const results = await this.searchTool.search(query, 5);
    
    if (this.geminiTool.enabled) {
      return this.geminiTool.summarizeSearchResults(query, results);
    }
    
    return results.map((r, i) => 
      `${i + 1}. ${r.title}\n   ${r.snippet.substring(0, 100)}...`
    ).join('\n\n');
  }

  async lookup(entity) {
    const results = await this.searchTool.searchEntity(entity, 'general');
    
    if (results.length === 0) {
      return `No results found for "${entity}"`;
    }

    if (this.geminiTool.enabled) {
      const summary = await this.geminiTool.summarizeSearchResults(entity, results);
      return `${entity}:\n${summary}\n\nMore: ${results[0].url}`;
    }

    const r = results[0];
    return `${entity}: ${r.snippet}\n\nMore: ${r.url}`;
  }

  /**
   * Get example session templates
   */
  getExampleSessions() {
    return this.promptManager.getExampleSessions();
  }

  /**
   * Quick setup for technical expert interview mode
   */
  setupTechnicalInterview(topic) {
    return this.promptManager.setupTechnicalInterview(topic);
  }

  _messagesToPrompt(messages) {
    return messages.map(m => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'user') return `User: ${m.content}`;
      return `Assistant: ${m.content}`;
    }).join('\n\n') + '\n\nAssistant:';
  }

  _updateHistory(user, assistant) {
    this.history.push({ role: 'user', content: user });
    this.history.push({ role: 'assistant', content: assistant });
    if (this.history.length > 20) this.history = this.history.slice(-20);
  }

  resetHistory() {
    this.history = [];
  }
}

module.exports = { AgentV2 };

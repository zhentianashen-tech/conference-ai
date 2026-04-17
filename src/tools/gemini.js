'use strict';

/**
 * Gemini Tool
 *
 * Google Gemini API integration for enhanced AI capabilities.
 * Supports both Gemini 2.0 Flash (fast) and Gemini 2.0 Pro (powerful).
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiTool {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    this.enabled = !!this.apiKey;
    
    if (this.enabled) {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      this.model = this.genAI.getGenerativeModel({ model: this.modelName });
      console.log(`[Gemini] Initialized with model: ${this.modelName}`);
    } else {
      console.log('[Gemini] Disabled - no API key provided');
    }
  }

  /**
   * Generate content using Gemini
   * @param {string} prompt - The prompt
   * @param {object} options - Generation options
   * @returns {Promise<string>} - Generated text
   */
  async generate(prompt, options = {}) {
    if (!this.enabled) {
      throw new Error('Gemini API not configured');
    }

    const generationConfig = {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxTokens ?? 500,
      topP: 0.95,
      topK: 40,
    };

    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      });

      const response = result.response;
      return response.text();
    } catch (err) {
      console.error('[Gemini] Generation error:', err.message);
      throw err;
    }
  }

  /**
   * Analyze conversation context and suggest actions
   */
  async analyzeContext(transcript, notes = []) {
    if (!this.enabled) return null;

    const prompt = `You are a conference call assistant. Analyze this conversation transcript and provide brief insights:

Transcript:
${transcript}

${notes.length > 0 ? `User Notes:\n${notes.join('\n')}` : ''}

Provide a brief analysis (2-3 bullet points max):
1. Key topics being discussed
2. Any decisions or action items mentioned
3. Suggested follow-up questions or actions

Keep it concise and actionable.`;

    try {
      const result = await this.generate(prompt, { maxTokens: 300 });
      return result;
    } catch (err) {
      return null;
    }
  }

  /**
   * Answer a question using search results as context
   */
  async answerWithContext(question, searchResults) {
    if (!this.enabled) return null;

    const context = searchResults.map(r => `${r.title}: ${r.snippet}`).join('\n\n');
    
    const prompt = `Based on the following search results, answer the question concisely:

Search Results:
${context}

Question: ${question}

Provide a brief, accurate answer based on the search results. If the results don't contain the answer, say so.`;

    try {
      const result = await this.generate(prompt, { maxTokens: 400 });
      return result;
    } catch (err) {
      return null;
    }
  }

  /**
   * Summarize web search results
   */
  async summarizeSearchResults(query, results) {
    if (!this.enabled) {
      // Return simple concatenation if Gemini not available
      return results.map(r => `• ${r.title}: ${r.snippet.substring(0, 100)}...`).join('\n');
    }

    const resultsText = results.map((r, i) => 
      `[${i + 1}] ${r.title}\n${r.snippet}`
    ).join('\n\n');

    const prompt = `Summarize these search results about "${query}" into 2-3 concise bullet points:

${resultsText}

Focus on key facts and actionable information.`;

    try {
      const result = await this.generate(prompt, { maxTokens: 300 });
      return result;
    } catch (err) {
      return results.map(r => `• ${r.title}: ${r.snippet.substring(0, 80)}...`).join('\n');
    }
  }

  /**
   * Detect if a search would be helpful for this query
   */
  async shouldSearch(query, transcript) {
    if (!this.enabled) return false;

    const triggerWords = [
      'who is', 'what is', 'where is', 'when did', 'why does',
      'how to', 'latest', 'recent', 'news', 'price', 'stock',
      'definition', 'meaning of', 'explained'
    ];

    const lowerQuery = query.toLowerCase();
    return triggerWords.some(trigger => lowerQuery.includes(trigger));
  }

  /**
   * Get model info
   */
  getInfo() {
    return {
      enabled: this.enabled,
      model: this.modelName,
      provider: 'Google Gemini',
    };
  }
}

module.exports = { GeminiTool };

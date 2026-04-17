'use strict';

/**
 * Agent
 *
 * LLM-powered assistant that answers questions about the live call.
 * Reads AGENT_BASE_URL / AGENT_API_KEY / AGENT_MODEL from the environment so
 * it works with Ollama (local) or any OpenAI-compatible cloud API.
 *
 * Two main operations:
 *   query(message)  — answer a specific question from the user
 *   summarize()     — produce a structured summary of the call so far
 */

const { OpenAI } = require('openai');

const SYSTEM_PROMPT = `You are a real-time conference call assistant embedded in the user's laptop.
You have access to a live rolling transcript of the phone call they are currently on.

Your job:
- Answer questions about what was said (names, numbers, decisions, action items)
- Help the user recall or clarify things said during the call
- Be CONCISE — 2-4 sentences unless the user explicitly asks for more
- Say "I didn't catch that in the transcript" if something isn't there
- Be conversational and direct; no fluff

Transcript accuracy: Whisper transcription may have minor errors for names or technical terms.
Flag obvious transcription errors when you notice them.`;

const SUMMARY_PROMPT = `Produce a clean, structured call summary with:

1. **Key topics discussed**
2. **Decisions or agreements made**
3. **Action items** (who needs to do what)
4. **Names / companies / numbers mentioned**
5. **Open questions** (anything unresolved)

Keep it scannable. Use short bullet points.`;

class Agent {
  /**
   * @param {ContextManager} context - shared context manager
   */
  constructor(context) {
    this.client  = new OpenAI({
      apiKey:  process.env.AGENT_API_KEY  || process.env.OPENAI_API_KEY || 'none',
      baseURL: process.env.AGENT_BASE_URL || undefined,   // undefined = OpenAI cloud
    });
    this.model   = (process.env.AGENT_MODEL || this.model).trim();
    this.context = context;
    this._history = []; // { role, content }[]
  }

  /**
   * Answer a user question about the call.
   * @param {string} userMessage
   * @returns {Promise<string>}
   */
  async query(userMessage) {
    const ctx = this.context.getFormattedContext();

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: `Current call transcript:\n\n${ctx}`,
      },
      // Keep last 4 exchanges (8 messages) for conversational flow
      ...this._history.slice(-8),
      { role: 'user', content: userMessage },
    ];

    const response = await this.client.chat.completions.create({
      model:      this.model,
      messages,
      max_tokens: 350,
      temperature: 0.3,
    });

    const reply = response.choices[0].message.content.trim();

    // Append to rolling history
    this._history.push({ role: 'user',      content: userMessage });
    this._history.push({ role: 'assistant', content: reply });

    return reply;
  }

  /**
   * Generate a structured call summary using more context.
   * @returns {Promise<string>}
   */
  async summarize() {
    // Use a larger context window for summaries
    const ctx = this.context.getFormattedContext(50);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${SUMMARY_PROMPT}\n\nTranscript:\n\n${ctx || '(No transcript captured yet.)'}`,
      },
    ];

    const response = await this.client.chat.completions.create({
      model:       this.model,
      messages,
      max_tokens:  700,
      temperature: 0.2,
    });

    return response.choices[0].message.content.trim();
  }

  /** Clear conversation history (keeps transcript context). */
  resetHistory() {
    this._history = [];
  }
}

module.exports = { Agent };

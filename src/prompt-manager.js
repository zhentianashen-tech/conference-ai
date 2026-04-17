'use strict';

/**
 * PromptManager
 *
 * Manages a two-layer system prompt architecture:
 * 
 * Layer 1: Persistent/Base System Prompt
 *   - Core identity and behavior
 *   - General guidelines for all responses
 *   - Loaded from environment/config file
 * 
 * Layer 2: Session-Specific Context
 *   - Call/meeting specific instructions
 *   - Topics, goals, participants to track
 *   - Set at the start of each session
 * 
 * Final prompt = Layer 1 + Layer 2 + User Query
 */

const fs = require('fs');
const path = require('path');

// Default Layer 1: Base system prompt
const DEFAULT_BASE_PROMPT = `You are a real-time conference call assistant embedded in the user's laptop.

YOUR CORE IDENTITY:
- You have access to a live rolling transcript of the phone call
- You can search the web for external information when needed
- You provide concise, actionable insights (2-4 sentences max)
- You are helpful, professional, and direct

RESPONSE GUIDELINES (Always follow these):
- Be CONCISE - 2-4 sentences unless explicitly asked for more
- Answer questions about what was said (names, numbers, decisions, action items)
- Say "I didn't catch that in the transcript" if something isn't there
- Flag obvious transcription errors when you notice them (names, technical terms)
- When using web search, cite sources briefly
- Use bullet points for multiple items
- Be conversational but professional

WHEN TO SEARCH:
- "Who is [person]?" → Search
- "What is [company/technology]?" → Search  
- "Latest news on..." → Search
- Questions about current events or external facts → Search

TRANSCRIPT ACCURACY NOTES:
- Whisper transcription may have minor errors for names or technical terms
- Numbers and dates may occasionally be misheard
- Context usually clarifies ambiguous transcriptions`;

// Default Layer 2 template (empty by default)
const DEFAULT_SESSION_TEMPLATE = ``;

class PromptManager {
  constructor(options = {}) {
    this.basePromptPath = options.basePromptPath || this._getBasePromptPath();
    this.sessionPromptPath = options.sessionPromptPath || this._getSessionPromptPath();
    
    // Load or create base prompt (Layer 1)
    this.basePrompt = this._loadBasePrompt();
    
    // Initialize session prompt (Layer 2) - starts empty
    this.sessionPrompt = '';
    this.sessionMetadata = {
      title: '',
      startedAt: null,
      goals: [],
      participants: [],
      topics: []
    };
    
    console.log('[PromptManager] Initialized with 2-layer architecture');
  }

  /**
   * Get path for base prompt file
   */
  _getBasePromptPath() {
    return path.join(process.cwd(), 'prompts', 'base-system.txt');
  }

  /**
   * Get path for session prompt file
   */
  _getSessionPromptPath() {
    return path.join(process.cwd(), 'prompts', 'session-context.txt');
  }

  /**
   * Load base prompt from file or use default
   */
  _loadBasePrompt() {
    // Check environment variable first
    if (process.env.BASE_SYSTEM_PROMPT) {
      return process.env.BASE_SYSTEM_PROMPT;
    }
    
    // Try to load from file
    if (fs.existsSync(this.basePromptPath)) {
      try {
        const content = fs.readFileSync(this.basePromptPath, 'utf-8');
        console.log(`[PromptManager] Loaded base prompt from ${this.basePromptPath}`);
        return content;
      } catch (err) {
        console.error('[PromptManager] Failed to load base prompt:', err.message);
      }
    }
    
    // Create default file if it doesn't exist
    this._ensurePromptsDir();
    this.saveBasePrompt(DEFAULT_BASE_PROMPT);
    return DEFAULT_BASE_PROMPT;
  }

  /**
   * Ensure prompts directory exists
   */
  _ensurePromptsDir() {
    const dir = path.dirname(this.basePromptPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Save base prompt to file
   */
  saveBasePrompt(prompt) {
    this._ensurePromptsDir();
    try {
      fs.writeFileSync(this.basePromptPath, prompt, 'utf-8');
      this.basePrompt = prompt;
      console.log('[PromptManager] Base prompt saved');
      return true;
    } catch (err) {
      console.error('[PromptManager] Failed to save base prompt:', err.message);
      return false;
    }
  }

  /**
   * Set session-specific context (Layer 2)
   * @param {object} sessionConfig
   * @param {string} sessionConfig.title - Call/meeting title
   * @param {string[]} sessionConfig.goals - What to track/watch for
   * @param {string[]} sessionConfig.participants - Key participants
   * @param {string[]} sessionConfig.topics - Topics to pay attention to
   * @param {string} sessionConfig.customInstructions - Additional instructions
   */
  setSessionContext(sessionConfig) {
    this.sessionMetadata = {
      title: sessionConfig.title || 'Untitled Session',
      startedAt: new Date(),
      goals: sessionConfig.goals || [],
      participants: sessionConfig.participants || [],
      topics: sessionConfig.topics || [],
      customInstructions: sessionConfig.customInstructions || ''
    };

    this.sessionPrompt = this._buildSessionPrompt(this.sessionMetadata);
    
    console.log(`[PromptManager] Session context set: "${this.sessionMetadata.title}"`);
    return this.sessionPrompt;
  }

  /**
   * Build session prompt from metadata
   */
  _buildSessionPrompt(metadata) {
    const parts = [];
    
    parts.push(`CURRENT SESSION: ${metadata.title}`);
    parts.push(`Started: ${metadata.startedAt.toLocaleString()}`);
    
    if (metadata.goals.length > 0) {
      parts.push('\nSESSION GOALS - Pay special attention to:');
      metadata.goals.forEach(g => parts.push(`  • ${g}`));
    }
    
    if (metadata.participants.length > 0) {
      parts.push('\nKEY PARTICIPANTS:');
      metadata.participants.forEach(p => parts.push(`  • ${p}`));
    }
    
    if (metadata.topics.length > 0) {
      parts.push('\nTOPICS TO TRACK:');
      metadata.topics.forEach(t => parts.push(`  • ${t}`));
    }
    
    if (metadata.customInstructions) {
      parts.push('\nADDITIONAL SESSION INSTRUCTIONS:');
      parts.push(metadata.customInstructions);
    }
    
    parts.push('\n---');
    parts.push('Remember to combine these session-specific priorities with your core guidelines.');
    
    return parts.join('\n');
  }

  /**
   * Update session context partially
   */
  updateSessionContext(updates) {
    Object.assign(this.sessionMetadata, updates);
    this.sessionPrompt = this._buildSessionPrompt(this.sessionMetadata);
    return this.sessionPrompt;
  }

  /**
   * Add a goal mid-session
   */
  addSessionGoal(goal) {
    this.sessionMetadata.goals.push(goal);
    this.sessionPrompt = this._buildSessionPrompt(this.sessionMetadata);
    return true;
  }

  /**
   * Add a participant mid-session
   */
  addSessionParticipant(participant) {
    this.sessionMetadata.participants.push(participant);
    this.sessionPrompt = this._buildSessionPrompt(this.sessionMetadata);
    return true;
  }

  /**
   * Add a topic mid-session
   */
  addSessionTopic(topic) {
    this.sessionMetadata.topics.push(topic);
    this.sessionPrompt = this._buildSessionPrompt(this.sessionMetadata);
    return true;
  }

  /**
   * Clear session context
   */
  clearSession() {
    this.sessionPrompt = '';
    this.sessionMetadata = {
      title: '',
      startedAt: null,
      goals: [],
      participants: [],
      topics: []
    };
    console.log('[PromptManager] Session context cleared');
  }

  /**
   * Get the complete system prompt (Layer 1 + Layer 2)
   */
  getCompleteSystemPrompt() {
    const parts = [];
    
    // Layer 1: Base prompt
    parts.push('=== CORE INSTRUCTIONS ===');
    parts.push(this.basePrompt);
    
    // Layer 2: Session context (if set)
    if (this.sessionPrompt) {
      parts.push('\n=== SESSION CONTEXT ===');
      parts.push(this.sessionPrompt);
    }
    
    return parts.join('\n\n');
  }

  /**
   * Get prompts separately (for debugging/UI)
   */
  getPrompts() {
    return {
      base: this.basePrompt,
      session: this.sessionPrompt,
      combined: this.getCompleteSystemPrompt()
    };
  }

  /**
   * Get session metadata for UI display
   */
  getSessionInfo() {
    return {
      ...this.sessionMetadata,
      hasSession: !!this.sessionPrompt,
      basePromptLength: this.basePrompt.length,
      sessionPromptLength: this.sessionPrompt.length
    };
  }

  /**
   * Load session from file
   */
  loadSessionFromFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error('Session file not found');
      }
      
      const content = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content);
      
      return this.setSessionContext(config);
    } catch (err) {
      console.error('[PromptManager] Failed to load session:', err.message);
      return null;
    }
  }

  /**
   * Save current session to file
   */
  saveSessionToFile(filePath) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(this.sessionMetadata, null, 2), 'utf-8');
      console.log(`[PromptManager] Session saved to ${filePath}`);
      return true;
    } catch (err) {
      console.error('[PromptManager] Failed to save session:', err.message);
      return false;
    }
  }

  /**
   * List example session templates
   */
  getExampleSessions() {
    return {
      technical_expert_interview: {
        title: 'Expert Interview - [Technical Topic]',
        goals: [
          'Detect hand-wavy or vague technical explanations',
          'Flag claims without evidence or supporting details',
          'Identify logical inconsistencies in explanations',
          'Spot overpromising or unrealistic technical claims',
          'Catch buzzword abuse without substantive meaning',
          'Note when expert contradicts themselves',
          'Alert on appeals to authority without explanation',
          'Highlight missing implementation details'
        ],
        topics: [
          'Technical Implementation',
          'Performance Claims',
          'Limitations & Trade-offs',
          'Evidence & Benchmarks',
          'Architecture Details'
        ],
        customInstructions: this._getTechnicalInterviewInstructions()
      }
    };
  }

  /**
   * Get specialized technical interview instructions
   */
  _getTechnicalInterviewInstructions() {
    return `You are my technical research assistant during expert interviews. Your job is to protect me from being misled by detecting BS, hype, or vague hand-waving.

RED FLAGS TO WATCH FOR:
- Vague terms without specifics: 'AI-powered', 'state-of-the-art', 'optimized' without numbers
- Missing methodology: No training data, evaluation metrics, or benchmarks mentioned
- Unrealistic claims: '100% accuracy', 'works for all cases', 'instant results'
- Evasion tactics: 'It's proprietary', 'trust me', 'too complex to explain'
- Contradictions: Claims that conflict with known constraints or their own statements
- Hype over substance: Buzzwords without technical detail
- Appeal to authority: 'We have PhDs' without explaining WHY it works

YOUR RESPONSES SHOULD:
1. Alert immediately with "⚠️ RED FLAG:" when you detect issues
2. Suggest specific clarifying questions I should ask
3. Provide technical context when claims seem questionable
4. Note what information is MISSING
5. Be direct but polite - this is for my understanding, not confrontation`;
  }

  /**
   * Quick setup for technical expert interview mode
   */
  setupTechnicalInterview(topic = '') {
    return this.setSessionContext({
      title: topic ? `Expert Interview - ${topic}` : 'Expert Interview',
      goals: [
        'Detect hand-wavy or vague technical explanations',
        'Flag claims without evidence',
        'Identify logical inconsistencies',
        'Spot overpromising or unrealistic claims',
        'Catch buzzword abuse',
        'Note contradictions',
        'Alert on appeals to authority',
        'Highlight missing implementation details'
      ],
      topics: ['Technical Implementation', 'Performance Claims', 'Limitations', 'Evidence'],
      customInstructions: this._getTechnicalInterviewInstructions()
    });
  }
}

module.exports = { PromptManager, DEFAULT_BASE_PROMPT };

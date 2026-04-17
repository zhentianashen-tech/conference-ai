'use strict';

/**
 * Conference AI Assistant — With Session Controls
 *
 * Features:
 *   - Start/Pause/End buttons for recording control
 *   - Better ASR (nodejs-whisper with larger models)
 *   - Proactive suggestions
 *   - Web search & Gemini API
 *   - Two-layer system prompts (Base + Session)
 *
 * Workflow:
 *   1. App starts in IDLE state (not recording)
 *   2. User clicks [Start] to begin recording
 *   3. User can [Pause] and [Resume] as needed
 *   4. User clicks [End] to stop and summarize
 */

require('dotenv').config();

const { AudioRecorder } = require('./src/audio');
const { ContextManager } = require('./src/context');
const { createUI } = require('./src/ui');

// Enhanced components
const { TranscriberEnhanced } = require('./src/transcriber-enhanced');
const { AgentV2 } = require('./src/agent-v2');
const { ProactiveAnalyzer } = require('./src/proactive');

// ── Config from .env ────────────────────────────────────────────────────────

const AUDIO_DEVICE = process.env.AUDIO_DEVICE || ':0';
const CHUNK_SEC = parseInt(process.env.CHUNK_DURATION || '4', 10);
const MAX_SEGMENTS = parseInt(process.env.MAX_CONTEXT_SEGMENTS || '15', 10);
const USE_ENHANCED = process.env.USE_ENHANCED !== 'false';

// ── Boot check ──────────────────────────────────────────────────────────────

function checkConfig() {
  const hasTranscription = process.env.WHISPER_BASE_URL || 
                           process.env.OPENAI_API_KEY || 
                           USE_ENHANCED;
  const hasAgent = process.env.AGENT_BASE_URL || 
                   process.env.OPENAI_API_KEY ||
                   process.env.GEMINI_API_KEY;

  if (!hasTranscription || !hasAgent) {
    console.error('\n❌ Missing API configuration in .env');
    if (!hasTranscription) {
      console.error('   Set WHISPER_BASE_URL (local) or OPENAI_API_KEY (cloud)');
      console.error('   Or install nodejs-whisper for local transcription');
    }
    if (!hasAgent) {
      console.error('   Set AGENT_BASE_URL (local) or OPENAI_API_KEY / GEMINI_API_KEY');
    }
    console.error('\n   Copy .env.example → .env and fill in values.\n');
    process.exit(1);
  }
}

checkConfig();

// ── Session Command Parser ──────────────────────────────────────────────────

function parseSessionCommand(query) {
  const result = { type: 'session', action: 'set', config: {} };
  const regex = /(\w+)="([^"]+)"/g;
  let match;
  while ((match = regex.exec(query)) !== null) {
    const [, key, value] = match;
    if (key === 'goals' || key === 'participants' || key === 'topics') {
      result.config[key] = value.split(',').map(s => s.trim());
    } else {
      result.config[key] = value;
    }
  }
  return result;
}

function parseAddCommand(query) {
  const result = { type: 'add' };
  if (query.includes('goal=')) {
    const match = query.match(/goal="([^"]+)"/);
    if (match) result.goal = match[1];
  }
  if (query.includes('participant=')) {
    const match = query.match(/participant="([^"]+)"/);
    if (match) result.participant = match[1];
  }
  if (query.includes('topic=')) {
    const match = query.match(/topic="([^"]+)"/);
    if (match) result.topic = match[1];
  }
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Shared context
  const context = new ContextManager({ maxSegments: MAX_SEGMENTS });
  
  // Enhanced transcriber
  const transcriber = new TranscriberEnhanced();
  
  // Enhanced agent with tools and two-layer prompts
  const agent = new AgentV2(context);
  
  // Audio recorder with pause/resume support
  const recorder = new AudioRecorder({
    device: AUDIO_DEVICE,
    chunkDuration: CHUNK_SEC,
  });

  // Proactive analyzer (will be started/stopped with recording)
  const proactive = new ProactiveAnalyzer(context);
  
  // Recording state
  let isRecording = false;

  // ── UI Callbacks ─────────────────────────────────────────────────

  function handleStart() {
    if (isRecording) {
      // Resume from pause
      recorder.resume();
      proactive.start();
      ui.setStatus('{green-fg}● Recording{/}  Press [Pause] or Space to pause');
      ui.appendAgent('system', '{green-fg}▶ Recording resumed{/}');
    } else {
      // Fresh start
      isRecording = true;
      recorder.start();
      proactive.start();
      ui.setStatus('{green-fg}● Recording{/}  Press [Pause] or Space to pause');
      ui.appendAgent('system', '{green-fg}● Recording started{/}');
    }
    ui.setRecordingState('recording');
  }

  function handlePause() {
    recorder.pause();
    proactive.stop();
    ui.setStatus('{yellow-fg}⏸ Paused{/}  Press [Start] or Space to resume');
    ui.appendAgent('system', '{yellow-fg}⏸ Recording paused{/}');
    ui.setRecordingState('paused');
  }

  async function handleEnd() {
    isRecording = false;
    recorder.stop();
    proactive.stop();
    
    ui.setStatus('{gray-fg}■ Stopped{/}  Generating summary...');
    ui.appendAgent('system', '{gray-fg}■ Recording ended{/}');
    ui.setRecordingState('idle');
    
    // Generate final summary
    try {
      ui.appendAgent('system', '📋 Generating session summary...');
      const summary = await agent.summarize();
      ui.appendAgent('assistant', `{bold}Session Summary:{/bold}\n\n${summary}`);
      ui.appendAgent('system', '{gray-fg}Session ended. Press [Start] for new session.{/}');
    } catch (err) {
      ui.appendAgent('error', `Summary error: ${err.message}`);
    }
    
    // Optionally clear session context
    // agent.endSession(); // Uncomment if you want auto-clear
  }

  // Build UI with button callbacks
  const ui = createUI({
    onStart: handleStart,
    onPause: handlePause,
    onEnd: handleEnd,
    
    onQuery: async (query) => {
      ui.setStatus('{yellow-fg}◌ Thinking...{/}');
      try {
        // Session management commands
        if (query.startsWith('/session ')) {
          const parsed = parseSessionCommand(query);
          if (parsed.config.title) {
            agent.setSessionContext(parsed.config);
            ui.appendAgent('system', `📋 Session set: "${parsed.config.title}"`);
            if (parsed.config.goals) {
              ui.appendAgent('system', `Goals: ${parsed.config.goals.join(', ')}`);
            }
          } else {
            ui.appendAgent('error', 'Usage: /session title="Meeting Name" [goals="a,b"] [participants="x,y"]');
          }
        }
        
        else if (query.startsWith('/add ')) {
          const parsed = parseAddCommand(query);
          if (parsed.goal) {
            agent.addSessionGoal(parsed.goal);
            ui.appendAgent('system', `✅ Goal added: "${parsed.goal}"`);
          } else if (parsed.participant) {
            agent.updateSessionContext({ 
              participants: [...agent.getSessionInfo().participants, parsed.participant] 
            });
            ui.appendAgent('system', `✅ Participant added: "${parsed.participant}"`);
          } else if (parsed.topic) {
            agent.updateSessionContext({ 
              topics: [...agent.getSessionInfo().topics, parsed.topic] 
            });
            ui.appendAgent('system', `✅ Topic added: "${parsed.topic}"`);
          } else {
            ui.appendAgent('error', 'Usage: /add goal="..." OR /add participant="..." OR /add topic="..."');
          }
        }
        
        else if (query === '/session' || query === '/info') {
          const info = agent.getSessionInfo();
          if (info.hasSession) {
            ui.appendAgent('system', `📋 Current Session: ${info.title}`);
            if (info.goals?.length) ui.appendAgent('system', `Goals: ${info.goals.join(', ')}`);
            if (info.participants?.length) ui.appendAgent('system', `Participants: ${info.participants.join(', ')}`);
            if (info.topics?.length) ui.appendAgent('system', `Topics: ${info.topics.join(', ')}`);
          } else {
            ui.appendAgent('system', 'No active session. Use /session to create one.');
          }
        }
        
        else if (query === '/end' || query === '/clearsession') {
          agent.endSession();
          context.clear(); // Clear transcript too
          ui.appendAgent('system', '📋 Session ended and transcript cleared. Starting fresh.');
        }
        
        else if (query === '/templates') {
          const templates = agent.getExampleSessions();
          ui.appendAgent('system', '📋 Available Session Templates:');
          Object.entries(templates).forEach(([key, template]) => {
            ui.appendAgent('system', `\n{green-fg}${key}:{/green-fg}`);
            ui.appendAgent('system', `  Title: ${template.title}`);
            if (template.goals) ui.appendAgent('system', `  Goals: ${template.goals.slice(0, 2).join(', ')}...`);
          });
          ui.appendAgent('system', '\nUse /expert [topic] for quick technical interview setup');
        }
        
        else if (query.startsWith('/expert')) {
          const topic = query.slice(7).trim();
          agent.setupTechnicalInterview(topic);
          ui.appendAgent('system', `🎯 Technical Interview Mode activated${topic ? ` for: ${topic}` : ''}`);
          ui.appendAgent('system', '{gray-fg}I will now watch for: vague claims, missing evidence, contradictions, buzzwords, and unrealistic promises{/gray-fg}');
        }
        
        // Search commands
        else if (query.startsWith('/search ')) {
          const searchQuery = query.slice(8).trim();
          ui.appendAgent('system', `🔍 Searching: "${searchQuery}"...`);
          const results = await agent.search(searchQuery);
          ui.appendAgent('assistant', results);
        } 
        
        else if (query.startsWith('/lookup ')) {
          const entity = query.slice(8).trim();
          ui.appendAgent('system', `🔍 Looking up: "${entity}"...`);
          const result = await agent.lookup(entity);
          ui.appendAgent('assistant', result);
        } 
        
        // Regular query
        else {
          const answer = await agent.query(query);
          ui.appendAgent('user', query);
          ui.appendAgent('assistant', answer);
        }
      } catch (err) {
        ui.appendAgent('error', `Error: ${err.message}`);
      }
      
      // Restore appropriate status
      if (isRecording) {
        ui.setStatus('{green-fg}● Recording{/}  Press [Pause] or Space to pause');
      } else {
        ui.setStatus('{gray-fg}■ Stopped{/}  Press [Start] to begin');
      }
    },

    onSummary: async () => {
      ui.setStatus('{yellow-fg}◌ Summarizing...{/}');
      ui.appendAgent('system', '📋 Generating summary...');
      try {
        const summary = await agent.summarize();
        ui.appendAgent('assistant', summary);
      } catch (err) {
        ui.appendAgent('error', `Summary error: ${err.message}`);
      }
      
      if (isRecording) {
        ui.setStatus('{green-fg}● Recording{/}  Press [Pause] or Space to pause');
      } else {
        ui.setStatus('{gray-fg}■ Stopped{/}  Press [Start] to begin');
      }
    },

    onNote: () => {
      const last = context.getLastSegment();
      if (last) {
        context.addNote(last);
        const preview = last.length > 70 ? last.slice(0, 70) + '...' : last;
        ui.appendAgent('system', `📌 Pinned: "${preview}"`);
      } else {
        ui.appendAgent('system', '📌 Nothing to pin yet');
      }
    },
  });

  // Handle proactive suggestions
  proactive.on('suggestion', (suggestion) => {
    const icon = String.fromCodePoint(parseInt(suggestion.icon));
    ui.appendAgent('system', `${icon} ${suggestion.title}: ${suggestion.message}`);
    const actions = suggestion.actions.map(a => `[${a.charAt(0).toUpperCase()}]${a.slice(1)}`).join(', ');
    ui.appendAgent('system', `{gray-fg}   Actions: ${actions}{/}`);
    ui._currentSuggestion = suggestion;
  });

  // Audio pipeline
  recorder.on('chunk', async (filePath) => {
    try {
      const text = await transcriber.transcribe(filePath);
      if (text && text.length > 1) {
        context.addSegment(text);
        ui.appendTranscript(text);
      }
    } catch (err) {
      ui.appendAgent('error', `Transcription error: ${err.message}`);
    }
  });

  recorder.on('error', (err) => {
    ui.setStatus(`{red-fg}Audio error: ${err.message}{/}`);
    ui.appendAgent('error', `Audio Error: ${err.message}`);
  });

  // ── Start ───────────────────────────────────────────────────────

  const modelInfo = transcriber.getModelInfo();
  ui.appendAgent('system', `🎙 Conference Assistant ready`);
  ui.appendAgent('system', `ASR: ${modelInfo.backend} (${modelInfo.model})`);
  ui.appendAgent('system', `Agent: ${agent.useGeminiPrimary ? 'Gemini' : agent.model}`);
  ui.appendAgent('system', `Proactive: ${proactive.enabled ? proactive.level : 'off'}`);
  ui.appendAgent('system', `{cyan-fg}Two-Layer Prompts:{/} Base + Session Context`);
  ui.appendAgent('system', '{gray-fg}─────────────────────────────────────{/}');
  ui.appendAgent('system', '{green-fg}Ready to start!{/} Click [Start] or press Space to begin recording');
  ui.appendAgent('system', '{gray-fg}Commands: /session, /expert [topic], /search, /lookup{/}');

  ui.setStatus('{gray-fg}● Ready{/}  Press [Start] or Space to begin recording');
  ui.setRecordingState('idle');

  // Graceful shutdown
  process.on('SIGINT', () => {
    recorder.stop();
    proactive.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    recorder.stop();
    proactive.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

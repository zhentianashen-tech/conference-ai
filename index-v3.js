#!/usr/bin/env node
/**
 * Conference AI Assistant v3.0
 * ─────────────────────────────────────────────────────────────────────────────
 * What's new vs. v2:
 *   • Session YAML ingestion  — per-conference questionnaire & goals
 *   • Questionnaire tracking  — proactive reminders for uncovered questions
 *   • Concept gap detection   — auto-intro for terms not in the questionnaire
 *   • Context compaction      — sliding window + LLM summarisation (~60 min safe)
 *   • Bilingual ASR           — Qwen/DashScope CH/EN (or Soniox / Gladia / Whisper)
 *   • OpenRouter engine       — 300+ models via one API key
 *
 * Usage:
 *   node index-v3.js [--session ./sessions/my-call.yaml] [--device :1]
 *
 * Environment: see .env.example
 */

'use strict';

require('dotenv').config();
const path          = require('path');
const fs            = require('fs');
const { parseArgs } = require('util');

const { AudioRecorder }        = require('./src/audio');
const { BilingualTranscriber } = require('./src/transcriber-bilingual');
const { AgentOpenRouter }      = require('./src/agent-openrouter');
const { SessionManager }       = require('./src/session-manager');
const { ContextManagerV3 }     = require('./src/context-manager-v3');
const { ProactiveAnalyzerV3 }  = require('./src/proactive-v3');
const { ConceptDetector }      = require('./src/concept-detector');
const { FactChecker }          = require('./src/fact-checker');
const { SearchTool }           = require('./src/tools/search');
const { createWebUI }          = require('./src/ui-web');  // web-based UI

// ── CLI args ────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    session: { type: 'string', short: 's' },
    device : { type: 'string', short: 'd' },
    model  : { type: 'string', short: 'm' },
  },
  strict: false,
});

// ── Validate env ─────────────────────────────────────────────────────────────

// Accept either MOONSHOT_API_KEY (Kimi) or OPENROUTER_API_KEY (OpenRouter)
if (!process.env.MOONSHOT_API_KEY && !process.env.OPENROUTER_API_KEY) {
  console.error('[Error] No API key set. Add MOONSHOT_API_KEY=... or OPENROUTER_API_KEY=... to your .env file.');
  process.exit(1);
}

// ── Prompt architecture ──────────────────────────────────────────────────────
// CORE IDENTITY    — always present in every API call (language, tone, conciseness)
// SESSION CONTEXT  — questionnaire + goals; ONLY injected for:
//                    user queries, proactive analysis, and final summary
// Function-specific prompts (fact-checker, compaction, concept-detector)
//   each have their own hardcoded system prompt and NEVER receive session context.

function _loadPrompt(filename) {
  const p = path.join(__dirname, 'prompts', filename);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

const coreIdentity = _loadPrompt('core-identity.txt') || `You are a real-time bilingual conference assistant. Be concise. Match the transcript language.`;

function buildUserSystemPrompt()    { return [coreIdentity, sessionManager.buildSystemContext()].filter(Boolean).join('\n\n---\n\n'); }
function buildSummarySystemPrompt() { return [coreIdentity, sessionManager.buildSystemContext()].filter(Boolean).join('\n\n---\n\n'); }

// ── Instantiate core modules ─────────────────────────────────────────────────

// 1. Analysis engine
const agent = new AgentOpenRouter({ model: args.model || undefined });

// 2. Session manager
const sessionManager = new SessionManager();

// 3. Context manager (LLM compaction wired in)
const contextManager = new ContextManagerV3({
  summarizer: text => agent.summarizeForCompaction(text),
  onCompaction: (entry, stats) => {
    log('system', `[Context] Compacted ${entry.segCount} segments → ${entry.tokens} tok (total: ${stats.totalTokens})`);
  },
});

// 4. Bilingual ASR
const asr = new BilingualTranscriber();

// 5. Proactive analyzer
const proactive = new ProactiveAnalyzerV3({ agent, sessionManager, contextManager });

// 6. Concept detector
const conceptDetector = new ConceptDetector({ agent, sessionManager });

// 7. Search tool + fact checker (gets core identity only, NOT session context)
const searchTool  = new SearchTool();
const factChecker = new FactChecker({ agent, contextManager, searchTool, coreIdentity });

// 8. Audio recorder
const recorder = new AudioRecorder({
  device: args.device || process.env.AUDIO_DEVICE || ':0',
});


// ── UI — forward-declare logging helpers so callbacks can use them ─────────────

let _ui = null;  // filled after createUI()

function log(role, text) {
  if (_ui) _ui.appendAgent(role, text);
  else console.log(`[${role}] ${text}`);
}

// ── Lifecycle actions (called from UI callbacks) ──────────────────────────────

// NOTE: The UI button handlers already update recordingState and button labels
// before calling these callbacks. Do NOT call _ui.setRecordingState() here —
// that would double-update and fight with the button handler's state.

function onStart() {
  recorder.start();
  proactive.start();
  factChecker.start();
  log('system', `Recording started — ASR: ${asr.getInfo().provider} | Agent: ${agent.model}`);
  log('system', `Fact-check: every ${Math.round(parseInt(process.env.FACT_CHECK_INTERVAL_MS || '180000') / 60000)} min`);
}

function onPause() {
  // The button handler calls this both for Pause AND Resume (it's a toggle).
  // Use recorder.getState() to know which action is actually needed.
  const state = recorder.getState();
  if (state === 'paused') {
    recorder.resume();
    proactive.start();
    factChecker.start();
    log('system', 'Recording resumed.');
  } else if (state === 'recording') {
    recorder.pause();
    proactive.stop();
    factChecker.stop();
    log('system', 'Recording paused.');
  }
}

async function onEnd() {
  recorder.stop();
  proactive.stop();
  factChecker.stop();
  log('system', 'Session ended — generating final summary…');
  await generateSummary();   // generateSummary() also saves the transcript
}

async function onSummary() {
  log('system', 'Generating summary…');
  await generateSummary();
}

function onNote() {
  const recent = contextManager.getRecentSegments(1);
  if (recent.length > 0) {
    log('system', `📌 Pinned: ${recent[0].text}`);
  }
}

async function onQuery(text) {
  if (!text.trim()) return;

  if (text.startsWith('/')) {
    await handleCommand(text.trim());
    return;
  }

  _ui.appendAgent('user', text);

  try {
    const response = await agent.analyzeTranscript(
      buildUserSystemPrompt(),     // core identity + session context
      '',                          // session context already included above
      contextManager.buildContext(),
      text,
    );
    _ui.appendAgent('assistant', response);
  } catch (err) {
    _ui.appendAgent('error', err.message);
  }
}

// ── Create UI (this starts the blessed screen) ────────────────────────────────

_ui = createWebUI({ onQuery, onSummary, onNote, onStart, onPause, onEnd });

// ── Load session if provided ──────────────────────────────────────────────────

if (args.session) {
  try {
    sessionManager.load(args.session);
    const cov = sessionManager.getCoverage();
    log('system', `Session: "${sessionManager.session.title}" — ${cov.total} questionnaire items`);
    _ui.appendAgent('system', sessionManager.buildSystemContext());
  } catch (err) {
    log('error', `Failed to load session: ${err.message}`);
  }
} else {
  _ui.appendAgent('system',
    'No session loaded. Use /session <path> to load a YAML file.\n' +
    'Example: /session ./sessions/example-conference.yaml'
  );
}

_ui.appendAgent('system', 'Press [Start] or Space to begin recording.');
_ui.setStatus(`v3.0 | ASR: ${asr.getInfo().provider} | Model: ${agent.model}`);

// Verify Kimi / analysis API connectivity
agent.chat([
  { role: 'user', content: 'reply with the single word: ready' }
], { maxTokens: 10 }).then(reply => {
  log('system', `✓ Analysis API ready (${agent.model})`);
}).catch(err => {
  log('error', `Analysis API failed: ${err.message}`);
  log('error', 'Check MOONSHOT_API_KEY and ANALYSIS_BASE_URL in your .env');
});

// For local ASR: verify the Python server is running
if (asr.getInfo().provider === 'glm-local') {
  asr.ping().then(alive => {
    if (!alive) {
      log('error',
        'GLM-ASR server not reachable at ' + (process.env.GLM_ASR_URL || 'http://127.0.0.1:8765') + '\n' +
        '  Start it first:  pip install mlx-audio fastapi uvicorn\n' +
        '                   python scripts/glm-asr-server.py'
      );
    } else {
      log('system', 'GLM-ASR server ✓ reachable');
    }
  });
}

// ── Transcript auto-save ──────────────────────────────────────────────────────

const _sessionStart = new Date();
const _transcriptLines = [];   // raw lines, appended as ASR comes in

function _transcriptFilePath() {
  const title = sessionManager.session?.title
    ? sessionManager.session.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '-').slice(0, 40)
    : 'session';
  const ts = _sessionStart.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  return path.join(__dirname, 'sessions', `${ts}_${title}.md`);
}

function saveTranscript(summaryText = null) {
  try {
    const lines = [
      `# ${sessionManager.session?.title || 'Conference Transcript'}`,
      `**Date:** ${_sessionStart.toLocaleString()}`,
      `**ASR:** ${asr.getInfo().provider} | **Model:** ${agent.model}`,
      '',
      '---',
      '',
      '## Transcript',
      '',
      ..._transcriptLines,
    ];

    if (summaryText) {
      lines.push('', '---', '', '## Summary', '', summaryText);
    }

    const cov = sessionManager.isLoaded() ? sessionManager.getCoverage() : null;
    if (cov) {
      lines.push('', '---', '', '## Questionnaire Coverage',
        `${cov.answered}/${cov.total} items covered (${cov.pct}%)`, '');
      Object.values(sessionManager.questionnaireStatus).forEach(q => {
        const mark = q.answered ? '✅' : '❌';
        lines.push(`- ${mark} **[${q.priority}]** ${q.question}`);
        if (q.answered && q.evidence) lines.push(`  > *${q.evidence.slice(0, 100)}*`);
      });
    }

    const outPath = _transcriptFilePath();
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    return outPath;
  } catch (e) {
    log('error', `Transcript save failed: ${e.message}`);
    return null;
  }
}

// ── Audio → ASR wiring ────────────────────────────────────────────────────────
// AudioRecorder emits 'chunk' events with WAV file paths.
// We pass each file to asr.transcribe() and feed the result into the pipeline.

recorder.on('chunk', async filePath => {
  try {
    const segment = await asr.transcribe(filePath);
    if (!segment.text) return;

    const lang = segment.language && segment.language !== 'auto'
      ? `[${segment.language.toUpperCase()}] ` : '';
    const displayLine = `${lang}${segment.text}`;
    _ui.appendTranscript(displayLine);

    // Append to transcript log with timestamp
    const ts = new Date().toLocaleTimeString();
    _transcriptLines.push(`**[${ts}]** ${displayLine}`);

    // Auto-save every 10 segments
    if (_transcriptLines.length % 10 === 0) saveTranscript();

    contextManager.addSegment(segment);
    conceptDetector.analyze(segment.text, segment.language);
  } catch (err) {
    log('error', `ASR: ${err.message}`);
  }
});

recorder.on('error', err => log('error', `Recorder: ${err.message}`));

// ── Proactive events ──────────────────────────────────────────────────────────

proactive.on('insight', insight => {
  const icon = { action_item:'📋', decision:'🎯', open_question:'❓',
                 deadline:'⏰', confusion:'🤔', risk:'⚠️' }[insight.type] || '💬';
  _ui.appendAgent('assistant', `${icon} ${insight.text}`);
});

proactive.on('question_answered', ev => {
  _ui.appendAgent('system', `✅ Covered: "${ev.question}"`);
  const cov = sessionManager.getCoverage();
  _ui.setStatus(`Coverage: ${cov.answered}/${cov.total} (${cov.pct}%) | ASR: ${asr.getInfo().provider}`);
});

proactive.on('question_reminder', ev => {
  const dot = ev.priority === 'high' ? '🔴' : ev.priority === 'medium' ? '🟡' : '⚪';
  _ui.appendAgent('system', `${dot} Still uncovered: "${ev.question}"`);
});

// ── Concept events ────────────────────────────────────────────────────────────

conceptDetector.on('concept', ev => {
  _ui.appendAgent('system', `💡 [${ev.concept}] ${ev.intro}`);
});

// ── Fact-checker events ───────────────────────────────────────────────────────

factChecker.on('findings', ev => {
  const label = ev.searchCount > 0
    ? `🔍 Fact-check (${ev.searchCount} search${ev.searchCount > 1 ? 'es' : ''})`
    : '🔍 Fact-check';
  _ui.appendAgent('assistant', `${label}:\n${ev.text}`);
});

factChecker.on('error', err => {
  log('error', `Fact-check: ${err.message}`);
});

// ── Commands ──────────────────────────────────────────────────────────────────

async function handleCommand(cmd) {
  const [name, ...rest] = cmd.slice(1).split(' ');
  const arg = rest.join(' ').trim();

  switch (name.toLowerCase()) {
    case 'session':
    case 'load':
      if (!arg) { log('system', 'Usage: /session <path-to-yaml>'); return; }
      try {
        sessionManager.load(arg);
        conceptDetector._seedFromSession();
        log('system', `✅ Session loaded: "${sessionManager.session.title}"`);
        _ui.appendAgent('system', sessionManager.buildSystemContext());
      } catch (e) { log('error', e.message); }
      break;

    case 'progress':
    case 'status':
      log('system', sessionManager.isLoaded()
        ? sessionManager.getProgressReport()
        : 'No session loaded.');
      break;

    case 'context':
      const s = contextManager.getStats();
      log('system',
        `Context: ${s.segments} segments, ${s.summaries} summaries, ` +
        `~${s.totalTokens} tokens (${s.utilizationPct}% of limit)`);
      break;

    case 'compact':
      await contextManager._compact();
      log('system', 'Context compacted.');
      break;

    case 'analyze':
      await proactive.runNow();
      break;

    case 'factcheck':
    case 'fc':
      log('system', 'Running fact-check now…');
      await factChecker.runNow();
      break;

    case 'summary':
    case 's':
      await generateSummary();
      break;

    case 'help':
    case '?':
      _ui.appendAgent('system', HELP_TEXT);
      break;

    default:
      log('system', `Unknown command: /${name}. Type /help for commands.`);
  }
}

async function generateSummary() {
  let summaryText = null;
  try {
    const ctx = contextManager.buildContext();
    summaryText = await agent.chat([
      { role: 'system', content: buildSummarySystemPrompt() },   // core + session context
      { role: 'user',   content: `Transcript:\n${ctx}\n\n${sessionManager.getProgressReport()}\n\nGenerate a structured meeting summary: key decisions, action items, open questions, questionnaire coverage.` },
    ], { maxTokens: 1500 });
    _ui.appendAgent('assistant', '══ SUMMARY ══\n' + summaryText);
  } catch (e) {
    log('error', `Summary failed: ${e.message}`);
  }

  // Save transcript (with summary if we got one)
  const outPath = saveTranscript(summaryText);
  if (outPath) log('system', `📄 Transcript saved → ${path.basename(outPath)}`);
}

// ── Save transcript on unexpected exit ───────────────────────────────────────

process.on('exit', () => {
  if (_transcriptLines.length > 0) saveTranscript();
});

const HELP_TEXT = `Commands:
  /session <path> — load a session YAML file
  /progress       — show questionnaire coverage
  /context        — show context window stats
  /compact        — manually trigger context compaction
  /analyze        — trigger proactive analysis now
  /factcheck      — run fact-check now (also: /fc)
  /summary        — generate meeting summary
  /help           — this message`;

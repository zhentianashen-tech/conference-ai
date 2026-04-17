'use strict';

/**
 * Terminal UI with Session Controls
 *
 * Layout:
 * ┌────────────────────────────────────────────────────────────────┐
 * │  🎙 Conference AI Assistant  |  [Start][Pause][End] | ? Help   │  ← header
 * ├──────────────────────────────────┬─────────────────────────────┤
 * │                                  │                             │
 * │   📜 Live Transcript             │   🤖 AI Assistant           │
 * │   (auto-scrolling)               │   (your Q&A)                │
 * │                                  │                             │
 * ├──────────────────────────────────┴─────────────────────────────┤
 * │  ● Ready  (status bar)                                          │
 * ├────────────────────────────────────────────────────────────────┤
 * │  Ask: [_____________________________________________]           │  ← input
 * └────────────────────────────────────────────────────────────────┘
 *
 * Key bindings (when NOT typing):
 *   ?  or  /  — focus input box to ask a question
 *   Enter      — same
 *   S          — trigger summary
 *   N          — pin last transcript segment as a note
 *   Q / Ctrl-C — quit
 *   Space      — toggle Start/Pause
 */

const blessed = require('blessed');

/**
 * @param {object} callbacks
 * @param {function} callbacks.onQuery     (text: string) => Promise<void>
 * @param {function} callbacks.onSummary   ()            => Promise<void>
 * @param {function} callbacks.onNote      ()            => void
 * @param {function} callbacks.onStart     ()            => void
 * @param {function} callbacks.onPause     ()            => void
 * @param {function} callbacks.onEnd       ()            => void
 * @returns {{ appendTranscript, appendAgent, setStatus, setRecordingState }}
 */
function createUI({ onQuery, onSummary, onNote, onStart, onPause, onEnd }) {

  // ── Recording State ─────────────────────────────────────────────────
  let recordingState = 'idle'; // 'idle' | 'recording' | 'paused'

  // ── Screen ────────────────────────────────────────────────────────
  const screen = blessed.screen({
    smartCSR:    true,
    title:       'Conference AI Assistant',
    fullUnicode: true,
    dockBorders: true,
  });

  // ── Header bar with buttons ──────────────────────────────────────
  const header = blessed.box({
    top:    0,
    left:   0,
    width:  '100%',
    height: 1,
    tags:   true,
    style: { bg: '#001833', fg: 'white' },
  });

  // Title part of header
  const headerTitle = blessed.box({
    parent: header,
    top:    0,
    left:   0,
    width:  30,
    height: 1,
    tags:   true,
    content: '{bold}{white-fg}  🎙 Conference AI{/bold}',
    style: { bg: '#001833', fg: 'white' },
  });

  // Start button
  const startBtn = blessed.button({
    parent: header,
    top:    0,
    left:   30,
    width:  8,
    height: 1,
    content: ' {green-fg}[Start]{/} ',
    tags:    true,
    style: {
      bg: '#001833',
      focus: { bg: '#003300' },
      hover: { bg: '#003300' },
    },
    mouse: true,
    keys:  true,
  });

  // Pause button (initially disabled look)
  const pauseBtn = blessed.button({
    parent: header,
    top:    0,
    left:   38,
    width:  8,
    height: 1,
    content: ' {gray-fg}[Pause]{/} ',
    tags:    true,
    style: {
      bg: '#001833',
      focus: { bg: '#333300' },
      hover: { bg: '#333300' },
    },
    mouse: true,
    keys:  true,
  });

  // End button (initially disabled look)
  const endBtn = blessed.button({
    parent: header,
    top:    0,
    left:   46,
    width:  7,
    height: 1,
    content: ' {gray-fg}[End]{/} ',
    tags:    true,
    style: {
      bg: '#001833',
      focus: { bg: '#330000' },
      hover: { bg: '#330000' },
    },
    mouse: true,
    keys:  true,
  });

  // Help text
  const headerHelp = blessed.box({
    parent: header,
    top:    0,
    left:   54,
    width:  'shrink',
    height: 1,
    tags:   true,
    content: '   {gray-fg}|{/}   {cyan-fg}?{/} Ask   {cyan-fg}S{/} Summary   {cyan-fg}N{/} Note   {cyan-fg}Q{/} Quit',
    style: { bg: '#001833', fg: 'white' },
  });

  // ── Left pane: Live Transcript ────────────────────────────────────
  const transcriptBox = blessed.box({
    top:        1,
    left:       0,
    width:      '60%',
    bottom:     2,
    label:      ' Live Transcript ',
    border:     { type: 'line' },
    tags:       true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch:    ' ',
      style: { bg: 'cyan' },
    },
    style: {
      border: { fg: 'cyan' },
      label:  { fg: 'cyan', bold: true },
      scrollbar: { bg: 'cyan' },
    },
    padding: { left: 1, right: 1 },
    wrap:    true,
    mouse:   true,
  });

  // ── Right pane: AI Chat ───────────────────────────────────────────
  const agentBox = blessed.box({
    top:        1,
    right:      0,
    width:      '40%',
    bottom:     2,
    label:      ' AI Assistant ',
    border:     { type: 'line' },
    tags:       true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch:    ' ',
      style: { bg: 'green' },
    },
    style: {
      border: { fg: 'green' },
      label:  { fg: 'green', bold: true },
      scrollbar: { bg: 'green' },
    },
    padding: { left: 1, right: 1 },
    wrap:    true,
    mouse:   true,
  });

  // ── Status bar ────────────────────────────────────────────────────
  const statusBar = blessed.box({
    bottom:  1,
    left:    0,
    width:   '100%',
    height:  1,
    tags:    true,
    content: '  {gray-fg}● Ready{/}  Press [Start] to begin recording',
    style:   { bg: '#0a0a0a', fg: 'white' },
  });

  // ── Input row ─────────────────────────────────────────────────────
  const inputPrompt = blessed.box({
    bottom: 0,
    left:   0,
    width:  7,
    height: 1,
    tags:   true,
    content: ' {cyan-fg}Ask:{/} ',
    style:  { bg: '#0d1117', fg: 'cyan' },
  });

  const inputBox = blessed.textbox({
    bottom:       0,
    left:         7,
    right:        0,
    height:       1,
    inputOnFocus: true,
    style: {
      fg: 'white',
      bg: '#0d1117',
      focus: { fg: 'white', bg: '#001a3d' },
    },
  });

  // ── Assemble ──────────────────────────────────────────────────────
  screen.append(header);
  screen.append(transcriptBox);
  screen.append(agentBox);
  screen.append(statusBar);
  screen.append(inputPrompt);
  screen.append(inputBox);

  // ── State ─────────────────────────────────────────────────────────
  let transcriptLines = [];
  let agentLines      = [];
  let inputFocused    = false;

  // ── Button Actions ────────────────────────────────────────────────
  function updateButtonStates() {
    switch (recordingState) {
      case 'idle':
        startBtn.setContent(' {green-fg}[Start]{/} ');
        pauseBtn.setContent(' {gray-fg}[Pause]{/} ');
        endBtn.setContent(' {gray-fg}[End]{/} ');
        break;
      case 'recording':
        startBtn.setContent(' {gray-fg}[Start]{/} ');
        pauseBtn.setContent(' {yellow-fg}[Pause]{/} ');
        endBtn.setContent(' {red-fg}[End]{/} ');
        break;
      case 'paused':
        startBtn.setContent(' {green-fg}[Resume]{/} ');
        pauseBtn.setContent(' {gray-fg}[Pause]{/} ');
        endBtn.setContent(' {red-fg}[End]{/} ');
        break;
    }
    screen.render();
  }

  function setRecordingState(state) {
    recordingState = state;
    updateButtonStates();
  }

  startBtn.on('press', () => {
    if (recordingState === 'idle') {
      recordingState = 'recording';
      updateButtonStates();
      onStart();
    } else if (recordingState === 'paused') {
      recordingState = 'recording';
      updateButtonStates();
      onPause(); // Resume is same function toggle
    }
  });

  pauseBtn.on('press', () => {
    if (recordingState === 'recording') {
      recordingState = 'paused';
      updateButtonStates();
      onPause();
    }
  });

  endBtn.on('press', () => {
    if (recordingState !== 'idle') {
      recordingState = 'idle';
      updateButtonStates();
      onEnd();
    }
  });

  // ── Exported helpers ──────────────────────────────────────────────

  function appendTranscript(text) {
    const ts = _time();
    transcriptLines.push(`{gray-fg}[${ts}]{/} ${_esc(text)}`);
    if (transcriptLines.length > 500) transcriptLines.shift();
    transcriptBox.setContent(transcriptLines.join('\n'));
    transcriptBox.setScrollPerc(100);
    screen.render();
  }

  function appendAgent(role, text) {
    if (agentLines.length > 0) agentLines.push('');

    switch (role) {
      case 'user':
        agentLines.push(`{cyan-fg}{bold}You:{/bold}{/cyan-fg}  ${_esc(text)}`);
        break;
      case 'assistant':
        agentLines.push(
          `{green-fg}{bold}Agent:{/bold}{/green-fg} ` +
          _esc(text).replace(/\n/g, '\n       ')
        );
        break;
      case 'system':
        agentLines.push(`{yellow-fg}${_esc(text)}{/}`);
        break;
      case 'error':
        agentLines.push(`{red-fg}${_esc(text)}{/}`);
        break;
    }

    if (agentLines.length > 300) agentLines.splice(0, 2);
    agentBox.setContent(agentLines.join('\n'));
    agentBox.setScrollPerc(100);
    screen.render();
  }

  function setStatus(text) {
    statusBar.setContent(`  ${text}`);
    screen.render();
  }

  // ── Key bindings ──────────────────────────────────────────────────

  inputBox.on('focus', () => { inputFocused = true; });
  inputBox.on('blur',  () => { inputFocused = false; });

  // Helper: focus the input AND explicitly re-enter read mode.
  // blessed's inputOnFocus: true calls readInput() on the 'focus' event,
  // but screen.render() calls from async callbacks can silently drop the
  // widget out of read mode. Calling readInput() again is idempotent and safe.
  function focusInput() {
    inputBox.focus();
    inputBox.readInput();
  }

  inputBox.on('submit', (value) => {
    inputBox.clearValue();
    screen.render();
    const query = (value || '').trim();
    if (query) {
      onQuery(query).catch((err) => {
        appendAgent('error', `Error: ${err.message}`);
      });
    }
    // Re-enter read mode after submit so the box is immediately ready.
    setImmediate(focusInput);
  });

  inputBox.key('escape', () => {
    inputBox.clearValue();
    inputFocused = false;
    screen.focusPrevious();
    screen.render();
  });

  // Global shortcuts — all guard on inputFocused so typing in the box
  // never accidentally triggers a shortcut.

  // '?', '/', Enter all focus the input. The Enter guard (!inputFocused)
  // ensures it doesn't fire during normal submit (which blessed handles
  // internally via the textbox's own 'submit' event).
  screen.key(['?', '/', 'enter', 'return'], () => {
    if (!inputFocused) focusInput();
  });

  screen.key(['s', 'S'], () => {
    if (!inputFocused) {
      onSummary().catch((err) => appendAgent('error', `Error: ${err.message}`));
    }
  });

  screen.key(['n', 'N'], () => {
    if (!inputFocused) onNote();
  });

  // Space to toggle start/pause
  screen.key(['space'], () => {
    if (!inputFocused) {
      if (recordingState === 'idle') {
        startBtn.emit('press');
      } else if (recordingState === 'recording') {
        pauseBtn.emit('press');
      } else if (recordingState === 'paused') {
        startBtn.emit('press');
      }
    }
  });

  // Q quits ONLY when the input box is not focused.
  // Ctrl-C always quits (emergency exit).
  screen.key(['q', 'Q'], () => {
    if (inputFocused) return;   // let Q be typed normally in the input
    screen.destroy();
    process.exit(0);
  });

  screen.key(['C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  // Initial render — focus and explicitly enter read mode.
  screen.render();
  focusInput();

  return { appendTranscript, appendAgent, setStatus, setRecordingState };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _time() {
  return new Date().toLocaleTimeString('en-US', {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function _esc(str) {
  return String(str)
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

module.exports = { createUI };

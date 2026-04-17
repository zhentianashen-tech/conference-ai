/**
 * ui-web.js
 * Drop-in replacement for the blessed terminal UI.
 * Runs an Express + Socket.IO server and serves a browser-based UI.
 *
 * Exports the same interface as createUI():
 *   createWebUI({ onQuery, onSummary, onNote, onStart, onPause, onEnd })
 *   → { appendTranscript, appendAgent, setStatus, setRecordingState }
 */

'use strict';

const http         = require('http');
const path         = require('path');
const fs           = require('fs');
const express      = require('express');
const { Server }   = require('socket.io');

const DEFAULT_PORT = parseInt(process.env.UI_PORT || '3456');

/**
 * @param {object}   callbacks
 * @param {function} callbacks.onQuery   (text) => Promise<void>
 * @param {function} callbacks.onSummary () => Promise<void>
 * @param {function} callbacks.onNote    () => void
 * @param {function} callbacks.onStart   () => void
 * @param {function} callbacks.onPause   () => void
 * @param {function} callbacks.onEnd     () => void
 * @returns {{ appendTranscript, appendAgent, setStatus, setRecordingState }}
 */
function createWebUI ({ onQuery, onSummary, onNote, onStart, onPause, onEnd }) {
  const app    = express();
  const server = http.createServer(app);
  const io     = new Server(server);

  // Serve the single-page frontend
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ── State (mirrored to every connected client) ──────────────────────────────

  let recordingState = 'idle';

  // ── Socket.IO ───────────────────────────────────────────────────────────────

  io.on('connection', socket => {
    // Send current state on connect
    socket.emit('state', { recordingState });

    socket.on('query', async text => {
      if (!text?.trim()) return;
      try { await onQuery(text.trim()); } catch (e) {
        io.emit('agent', { role: 'error', text: e.message });
      }
    });

    socket.on('start',   () => {
      if (recordingState === 'idle') {
        recordingState = 'recording'; io.emit('state', { recordingState }); onStart();
      } else if (recordingState === 'paused') {
        recordingState = 'recording'; io.emit('state', { recordingState }); onPause();
      }
    });

    socket.on('pause',   () => {
      if (recordingState === 'recording') {
        recordingState = 'paused'; io.emit('state', { recordingState }); onPause();
      }
    });

    socket.on('end', async () => {
      if (recordingState !== 'idle') {
        recordingState = 'idle'; io.emit('state', { recordingState }); await onEnd();
      }
    });

    socket.on('summary', async () => {
      try { await onSummary(); } catch (e) {
        io.emit('agent', { role: 'error', text: e.message });
      }
    });

    socket.on('note', () => onNote());
  });

  // ── Public API (same shape as blessed createUI) ─────────────────────────────

  function appendTranscript (text) {
    io.emit('transcript', { text, time: _time() });
  }

  function appendAgent (role, text) {
    io.emit('agent', { role, text });
  }

  function setStatus (text) {
    io.emit('status', { text });
  }

  function setRecordingState (state) {
    recordingState = state;
    io.emit('state', { recordingState: state });
  }

  // ── Start HTTP server ───────────────────────────────────────────────────────

  server.listen(DEFAULT_PORT, () => {
    console.log(`\n  🌐  Conference Assistant UI → http://localhost:${DEFAULT_PORT}\n`);
  });

  return { appendTranscript, appendAgent, setStatus, setRecordingState };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _time () {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

module.exports = { createWebUI };

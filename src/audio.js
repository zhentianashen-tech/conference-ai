'use strict';

/**
 * AudioRecorder with Pause/Resume Support
 *
 * Recording states: idle → recording → paused → recording → idle
 *
 * Continuously records audio from the specified input device in short chunks
 * using ffmpeg's avfoundation driver (macOS). Each completed chunk is emitted
 * as a 'chunk' event with the path to a temporary WAV file.
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { tmpdir } = require('os');
const path = require('path');
const fs = require('fs');

class AudioRecorder extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.device       - avfoundation audio device, e.g. ":0"
   * @param {number} options.chunkDuration - seconds per recording chunk (default 4)
   * @param {number} options.sampleRate   - Hz, default 16000 (best for Whisper)
   */
  constructor(options = {}) {
    super();
    this.device        = options.device        || ':0';
    this.chunkDuration = options.chunkDuration || 4;
    this.sampleRate    = options.sampleRate    || 16000;
    this.state         = 'idle'; // 'idle' | 'recording' | 'paused'
    this._chunkIdx     = 0;
    this._proc         = null;
    this._pauseTime    = null;
  }

  /**
   * Get current recording state
   */
  getState() {
    return this.state;
  }

  /**
   * Start recording (from idle state)
   */
  start() {
    if (this.state === 'recording') {
      console.log('[Audio] Already recording');
      return;
    }
    
    this.state = 'recording';
    this._chunkIdx = 0;
    this.emit('stateChange', 'recording');
    this._recordNext();
    console.log('[Audio] Recording started');
  }

  /**
   * Pause recording
   */
  pause() {
    if (this.state !== 'recording') {
      console.log('[Audio] Cannot pause - not recording');
      return;
    }
    
    this.state = 'paused';
    this._pauseTime = Date.now();
    
    // Kill current ffmpeg process but keep state as paused
    if (this._proc) {
      this._proc.kill('SIGTERM');
      this._proc = null;
    }
    
    this.emit('stateChange', 'paused');
    console.log('[Audio] Recording paused');
  }

  /**
   * Resume recording (from paused state)
   */
  resume() {
    if (this.state !== 'paused') {
      console.log('[Audio] Cannot resume - not paused');
      return;
    }
    
    this.state = 'recording';
    const pausedDuration = Date.now() - this._pauseTime;
    console.log(`[Audio] Resuming after ${Math.round(pausedDuration / 1000)}s pause`);
    
    this.emit('stateChange', 'recording');
    this._recordNext();
  }

  /**
   * Stop recording completely (goes to idle)
   */
  stop() {
    const wasRecording = this.state === 'recording';
    this.state = 'idle';
    this._pauseTime = null;
    
    if (this._proc) {
      this._proc.kill('SIGTERM');
      this._proc = null;
    }
    
    this.emit('stateChange', 'idle');
    console.log('[Audio] Recording stopped');
  }

  /**
   * Toggle between recording and paused
   */
  togglePause() {
    if (this.state === 'recording') {
      this.pause();
    } else if (this.state === 'paused') {
      this.resume();
    }
  }

  // ── private ────────────────────────────────────────────────────────

  _recordNext() {
    if (this.state !== 'recording') return;

    const filePath = path.join(
      tmpdir(),
      `conf_${Date.now()}_${this._chunkIdx++}.wav`
    );

    // ffmpeg avfoundation: audio-only, short fixed-duration WAV
    const args = [
      '-loglevel', 'error',
      '-f',        'avfoundation',
      '-i',        this.device,
      '-t',        String(this.chunkDuration),
      '-ar',       String(this.sampleRate),
      '-ac',       '1',                    // mono
      '-y',                                // overwrite if exists
      filePath,
    ];

    const proc = spawn('ffmpeg', args);
    this._proc = proc;

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      this._proc = null;

      // If we're no longer recording, don't continue
      if (this.state !== 'recording') return;

      if (code === 0 && fs.existsSync(filePath)) {
        this.emit('chunk', filePath);

        // Auto-delete after 30 s
        setTimeout(() => {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }, 30_000);
      } else if (code !== 0) {
        // Don't emit error if we intentionally stopped
        if (this.state === 'recording') {
          const msg = stderr.slice(-300).trim();
          this.emit('error', new Error(`ffmpeg exited ${code}: ${msg}`));
        }
      }

      // Continue to next chunk only if still recording
      if (this.state === 'recording') {
        setImmediate(() => this._recordNext());
      }
    });

    proc.on('error', (err) => {
      this._proc = null;
      if (err.code === 'ENOENT') {
        this.emit('error', new Error(
          'ffmpeg not found — install it with: brew install ffmpeg'
        ));
        this.state = 'idle';
      } else {
        this.emit('error', err);
        if (this.state === 'recording') {
          setImmediate(() => this._recordNext());
        }
      }
    });
  }
}

module.exports = { AudioRecorder };

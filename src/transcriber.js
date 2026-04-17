'use strict';

/**
 * Transcriber
 *
 * Handles two cases automatically:
 *
 *  1. Local whisper.cpp server (WHISPER_BASE_URL set to localhost/127.0.0.1)
 *     → calls POST /inference  (the native whisper.cpp endpoint)
 *     → uses Node 18+ built-in fetch + FormData, no extra deps
 *
 *  2. OpenAI cloud (no WHISPER_BASE_URL, or a non-local URL)
 *     → uses the OpenAI SDK with /v1/audio/transcriptions
 */

const { OpenAI } = require('openai');
const fs         = require('fs');
const path       = require('path');

class Transcriber {
  constructor() {
    const rawBase = (process.env.WHISPER_BASE_URL || '').trim();

    // Detect local whisper.cpp: any localhost / 127.0.0.1 URL
    const isLocal = rawBase && /localhost|127\.0\.0\.1/.test(rawBase);

    if (isLocal) {
      // Strip trailing /v1 if the user accidentally included it —
      // whisper.cpp native server uses /inference, not /v1/audio/transcriptions
      const base = rawBase.replace(/\/v1\/?$/, '').replace(/\/$/, '');
      this._mode         = 'whisper-cpp';
      this._inferenceUrl = `${base}/inference`;
    } else {
      this._mode  = 'openai';
      this._client = new OpenAI({
        apiKey:  process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY || 'none',
        baseURL: rawBase || undefined,
      });
      this._model = process.env.WHISPER_MODEL || 'whisper-1';
    }
  }

  /**
   * Transcribe a WAV file.
   * @param {string} filePath - absolute path to WAV file
   * @returns {Promise<string>} - transcript text, or '' if silent/empty
   */
  async transcribe(filePath) {
    return this._mode === 'whisper-cpp'
      ? this._transcribeLocal(filePath)
      : this._transcribeOpenAI(filePath);
  }

  // ── whisper.cpp native POST /inference ───────────────────────────

  async _transcribeLocal(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName   = path.basename(filePath);

    // FormData and Blob are global in Node 18+
    const form = new FormData();
    form.append('file',            new Blob([fileBuffer], { type: 'audio/wav' }), fileName);
    form.append('temperature',     '0');
    form.append('temperature_inc', '0.2');
    form.append('response_format', 'json');
    form.append('language',        'en');

    const res = await fetch(this._inferenceUrl, { method: 'POST', body: form });

    if (!res.ok) {
      throw new Error(`whisper.cpp ${res.status}: ${res.statusText} (${this._inferenceUrl})`);
    }

    const data = await res.json();
    // whisper.cpp returns { text: "..." }
    return (data.text || '').trim();
  }

  // ── OpenAI cloud (or OpenAI-compatible) ──────────────────────────

  async _transcribeOpenAI(filePath) {
    const response = await this._client.audio.transcriptions.create({
      file:            fs.createReadStream(filePath),
      model:           this._model,
      response_format: 'text',
      language:        'en',
    });

    const text = typeof response === 'string' ? response : (response.text || '');
    return text.trim();
  }
}

module.exports = { Transcriber };

/**
 * transcriber-bilingual.js
 * Bilingual (Chinese + English) ASR with automatic language detection.
 *
 * Each backend exposes ONE method:
 *   transcribe(filePath) → Promise<{ text, language, isFinal }>
 *
 * The AudioRecorder emits 'chunk' events with WAV file paths.
 * index-v3.js wires them together:
 *   recorder.on('chunk', async filePath => {
 *     const result = await asr.transcribe(filePath);
 *     ...
 *   });
 *
 * Providers:
 *   glm-local  — GLM-ASR-Nano via local Python server (default, zero API cost)
 *   openai     — OpenAI Whisper API (cloud fallback)
 *   qwen       — Alibaba DashScope Qwen-ASR REST (cloud)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// GLM-ASR Local Backend
// Talks to scripts/glm-asr-server.py which keeps the model hot in memory.
// ─────────────────────────────────────────────────────────────────────────────

class GLMLocalBackend {
  /**
   * @param {object} config
   * @param {string} [config.serverUrl]  default http://127.0.0.1:8765
   * @param {number} [config.timeoutMs]  per-request timeout, default 15 000
   */
  constructor (config = {}) {
    const port     = config.port || parseInt(process.env.GLM_ASR_PORT || '8765');
    this.serverUrl = config.serverUrl || process.env.GLM_ASR_URL || `http://127.0.0.1:${port}`;
    this.timeoutMs = config.timeoutMs || parseInt(process.env.GLM_ASR_TIMEOUT_MS || '15000');
  }

  getInfo () {
    return {
      provider : 'glm-local',
      model    : process.env.GLM_ASR_MODEL || 'GLM-ASR-Nano-2512-4bit',
      streaming: false,
    };
  }

  /** Check if the Python server is alive. */
  async ping () {
    try {
      const res = await fetch(`${this.serverUrl}/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Transcribe a WAV file by POSTing its bytes to the local server.
   * @param {string} filePath  — absolute path to a WAV file
   * @returns {Promise<{text:string, language:string, isFinal:boolean}>}
   */
  async transcribe (filePath) {
    const audioBytes = fs.readFileSync(filePath);

    const res = await fetch(`${this.serverUrl}/transcribe`, {
      method  : 'POST',
      headers : { 'Content-Type': 'audio/wav' },
      body    : audioBytes,
      signal  : AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`GLM-ASR server ${res.status}: ${detail}`);
    }

    const data = await res.json();
    if (data.error) throw new Error(`GLM-ASR: ${data.error}`);

    return {
      text    : (data.text || '').trim(),
      language: data.language || 'auto',
      isFinal : true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Whisper Backend (cloud fallback)
// ─────────────────────────────────────────────────────────────────────────────

class OpenAIWhisperBackend {
  constructor (config = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  }

  getInfo () {
    return { provider: 'openai-whisper', model: 'whisper-1', streaming: false };
  }

  async transcribe (filePath) {
    const { FormData, File } = globalThis;
    const audioBytes = fs.readFileSync(filePath);

    const form = new FormData();
    form.append('file',            new File([audioBytes], path.basename(filePath), { type: 'audio/wav' }));
    form.append('model',           'whisper-1');
    form.append('response_format', 'verbose_json');
    // Omit language → Whisper auto-detects (handles CH/EN naturally)

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method  : 'POST',
      headers : { 'Authorization': `Bearer ${this.apiKey}` },
      body    : form,
    });

    if (!res.ok) throw new Error(`Whisper API ${res.status}: ${await res.text()}`);
    const data = await res.json();

    return {
      text    : (data.text || '').trim(),
      language: data.language || 'unknown',
      isFinal : true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Alibaba DashScope Qwen-ASR Backend
// ─────────────────────────────────────────────────────────────────────────────

class QwenASRBackend {
  constructor (config = {}) {
    this.apiKey    = config.apiKey || process.env.DASHSCOPE_API_KEY;
    this.model     = config.model  || process.env.QWEN_ASR_MODEL || 'qwen3-asr-flash-realtime';
    this.languages = config.languages || (process.env.LANGUAGES || 'zh,en').split(',');

    const region = config.region || process.env.DASHSCOPE_REGION || 'cn';
    const host   = region === 'intl' ? 'dashscope-intl.aliyuncs.com' : 'dashscope.aliyuncs.com';
    this.apiUrl  = `https://${host}/api/v1/services/audio/asr/transcription`;
  }

  getInfo () {
    return { provider: 'qwen-asr', model: this.model, streaming: false };
  }

  async transcribe (filePath) {
    const { FormData, File } = globalThis;
    const audioBytes = fs.readFileSync(filePath);

    const form = new FormData();
    form.append('file',   new File([audioBytes], path.basename(filePath), { type: 'audio/wav' }));
    form.append('model',  this.model);
    form.append('format', 'wav');
    if (this.languages.length) {
      form.append('language_hints', this.languages.join(','));
    }

    const res = await fetch(this.apiUrl, {
      method  : 'POST',
      headers : { 'Authorization': `Bearer ${this.apiKey}` },
      body    : form,
    });

    if (!res.ok) throw new Error(`Qwen-ASR ${res.status}: ${await res.text()}`);
    const data = await res.json();

    const text     = data?.output?.sentence?.text || data?.output?.text || '';
    const language = data?.output?.sentence?.language || 'auto';

    return { text: text.trim(), language, isFinal: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BilingualTranscriber — public façade
// ─────────────────────────────────────────────────────────────────────────────

class BilingualTranscriber {
  /**
   * @param {object} [config]
   * @param {string} [config.provider]  'glm-local' | 'openai' | 'qwen'
   */
  constructor (config = {}) {
    const provider = config.provider || process.env.ASR_PROVIDER || 'glm-local';

    switch (provider) {
      case 'glm-local':
      case 'glm':
        this._backend = new GLMLocalBackend(config);
        break;
      case 'openai':
      case 'whisper':
        this._backend = new OpenAIWhisperBackend(config);
        break;
      case 'qwen':
      case 'qwen-asr':
      case 'dashscope':
        this._backend = new QwenASRBackend(config);
        break;
      default:
        throw new Error(`Unknown ASR provider: "${provider}". Use glm-local | openai | qwen`);
    }
  }

  getInfo () { return this._backend.getInfo(); }

  /**
   * Transcribe a single WAV chunk file.
   * @param {string} filePath
   * @returns {Promise<{text:string, language:string, isFinal:boolean}>}
   */
  async transcribe (filePath) {
    return this._backend.transcribe(filePath);
  }

  /** GLM-local only: check if Python server is reachable. */
  async ping () {
    return this._backend.ping?.() ?? true;
  }
}

module.exports = { BilingualTranscriber, GLMLocalBackend, OpenAIWhisperBackend, QwenASRBackend };

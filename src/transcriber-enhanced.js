'use strict';

/**
 * TranscriberEnhanced
 *
 * Enhanced transcription with multiple backend support:
 *   1. nodejs-whisper (local, larger models) - RECOMMENDED for 18GB RAM
 *   2. whisper.cpp server (local)
 *   3. OpenAI cloud API
 *
 * Supports model selection: tiny, base, small, medium, large-v1/v2/v3
 * Auto-downloads models on first use.
 */

const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class TranscriberEnhanced {
  constructor() {
    this.backend = this._detectBackend();
    this.model = process.env.WHISPER_MODEL_SIZE || 'base';
    this.device = process.env.WHISPER_DEVICE || 'cpu';
    this.vadEnabled = process.env.WHISPER_VAD === 'true';
    
    console.log(`[Transcriber] Using backend: ${this.backend}, model: ${this.model}`);
    
    if (this.backend === 'openai') {
      const rawBase = (process.env.WHISPER_BASE_URL || '').trim();
      this._client = new OpenAI({
        apiKey: process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY || 'none',
        baseURL: rawBase || undefined,
      });
      this._openaiModel = process.env.WHISPER_MODEL || 'whisper-1';
    }
  }

  /**
   * Detect the best available backend
   */
  _detectBackend() {
    const preferred = process.env.WHISPER_BACKEND;
    
    if (preferred === 'openai') return 'openai';
    if (preferred === 'whisper-cpp') return 'whisper-cpp';
    
    // Check if nodejs-whisper is available (preferred for local)
    try {
      require.resolve('nodejs-whisper');
      return 'nodejs-whisper';
    } catch {
      // Fall through
    }
    
    // Check if whisper.cpp server is configured
    const rawBase = (process.env.WHISPER_BASE_URL || '').trim();
    if (rawBase && /localhost|127\.0\.0\.1/.test(rawBase)) {
      return 'whisper-cpp';
    }
    
    return 'openai';
  }

  /**
   * Transcribe a WAV file.
   * @param {string} filePath - absolute path to WAV file
   * @returns {Promise<string>} - transcript text
   */
  async transcribe(filePath) {
    switch (this.backend) {
      case 'nodejs-whisper':
        return this._transcribeNodejsWhisper(filePath);
      case 'whisper-cpp':
        return this._transcribeWhisperCpp(filePath);
      case 'openai':
      default:
        return this._transcribeOpenAI(filePath);
    }
  }

  /**
   * nodejs-whisper backend - Local transcription with larger models
   */
  async _transcribeNodejsWhisper(filePath) {
    const { nodewhisper } = require('nodejs-whisper');
    
    const options = {
      modelName: this.model, // e.g., 'large-v3', 'medium', 'small', 'base', 'tiny'
      whisperOptions: {
        language: 'en',
      }
    };
    
    try {
      const result = await nodewhisper(filePath, options);
      
      // Parse result - nodejs-whisper returns object with text property
      if (result && typeof result === 'object') {
        // Return the full text from the result
        return (result.text || '').trim();
      }
      
      // Fallback: result might be string
      if (typeof result === 'string') {
        return result.trim();
      }
      
      return '';
    } catch (err) {
      console.error('[Transcriber] nodejs-whisper error:', err.message);
      // Fallback to whisper-cpp if available
      if (process.env.WHISPER_BASE_URL) {
        console.log('[Transcriber] Falling back to whisper-cpp');
        return this._transcribeWhisperCpp(filePath);
      }
      throw err;
    }
  }

  /**
   * whisper.cpp server backend
   */
  async _transcribeWhisperCpp(filePath) {
    const rawBase = (process.env.WHISPER_BASE_URL || '').trim();
    const base = rawBase.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    const inferenceUrl = `${base}/inference`;
    
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    
    const form = new FormData();
    form.append('file', new Blob([fileBuffer], { type: 'audio/wav' }), fileName);
    form.append('temperature', '0');
    form.append('temperature_inc', '0.2');
    form.append('response_format', 'json');
    form.append('language', 'en');
    
    const res = await fetch(inferenceUrl, { method: 'POST', body: form });
    
    if (!res.ok) {
      throw new Error(`whisper.cpp ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    return (data.text || '').trim();
  }

  /**
   * OpenAI cloud API backend
   */
  async _transcribeOpenAI(filePath) {
    const response = await this._client.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: this._openaiModel,
      response_format: 'text',
      language: 'en',
    });
    
    const text = typeof response === 'string' ? response : (response.text || '');
    return text.trim();
  }

  /**
   * Check if a model is downloaded locally
   */
  async isModelAvailable() {
    if (this.backend !== 'nodejs-whisper') return true;
    
    try {
      const { MODELS, MODELS_LIST } = require('nodejs-whisper');
      const modelInfo = MODELS_LIST[this.model];
      if (!modelInfo) return false;
      
      const modelPath = path.join(__dirname, '..', 'node_modules', 'nodejs-whisper', 'models', modelInfo.name);
      return fs.existsSync(modelPath);
    } catch {
      return false;
    }
  }

  /**
   * Get model download status/info
   */
  getModelInfo() {
    return {
      backend: this.backend,
      model: this.model,
      device: this.device,
      vadEnabled: this.vadEnabled,
    };
  }
}

module.exports = { TranscriberEnhanced };

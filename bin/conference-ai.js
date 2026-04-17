#!/usr/bin/env node
'use strict';

const path   = require('path');
const { spawn } = require('child_process');

// Ensure relative paths (sessions/, prompts/, public/) resolve from project root
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

require('dotenv').config({ path: path.join(ROOT, '.env') });

// Inject default session if none specified
if (!process.argv.some(a => a === '--session' || a === '-s')) {
  process.argv.push('--session', './sessions/generic.yaml');
}

// Auto-start the GLM ASR server if that provider is configured
if (process.env.ASR_PROVIDER === 'glm-local') {
  const asrUrl  = process.env.GLM_ASR_URL  || 'http://127.0.0.1:8765';
  const asrPort = process.env.GLM_ASR_PORT || '8765';

  console.log(`[conference-ai] Starting GLM ASR server on port ${asrPort}…`);

  const asr = spawn('python3', [path.join(ROOT, 'scripts/glm-asr-server.py')], {
    env    : { ...process.env },
    stdio  : ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  asr.stdout.on('data', d => process.stdout.write(`[asr] ${d}`));
  asr.stderr.on('data', d => process.stderr.write(`[asr] ${d}`));

  asr.on('error', err => {
    console.error(`[conference-ai] Failed to start ASR server: ${err.message}`);
    console.error('  Run manually:  python3 scripts/glm-asr-server.py');
  });

  asr.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[conference-ai] ASR server exited with code ${code}`);
    }
  });

  // Give the ASR server 3 s to load the model before starting the main app
  setTimeout(() => require('../index-v3.js'), 3000);

  // Kill ASR server when main process exits
  process.on('exit',    () => asr.kill());
  process.on('SIGINT',  () => { asr.kill(); process.exit(0); });
  process.on('SIGTERM', () => { asr.kill(); process.exit(0); });

} else {
  require('../index-v3.js');
}

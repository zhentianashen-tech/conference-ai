#!/usr/bin/env node
'use strict';

/**
 * setup.js — Audio device finder
 *
 * Run this AFTER plugging your phone into the 3.5mm jack to find the
 * correct AUDIO_DEVICE value to put in your .env file.
 *
 * Usage:  npm run devices
 */

const { spawn } = require('child_process');

console.log('\n🎙  Conference Assistant — Audio Device Setup\n');
console.log('Scanning for audio input devices via ffmpeg...\n');

const proc = spawn(
  'ffmpeg',
  ['-f', 'avfoundation', '-list_devices', 'true', '-i', '""'],
  { shell: true, stdio: ['ignore', 'ignore', 'pipe'] }
);

let output = '';
proc.stderr.on('data', (d) => { output += d.toString(); });

proc.on('close', () => {
  const lines = output.split('\n');

  let inAudioSection = false;
  const audioDevices = [];

  for (const line of lines) {
    // avfoundation groups devices into video / audio sections
    if (/AVFoundation audio devices/i.test(line)) {
      inAudioSection = true;
      continue;
    }
    if (inAudioSection) {
      // Each device line looks like:  [AVFoundation indev @ ...] [N] Device Name
      const match = line.match(/\[(\d+)\]\s+(.+)/);
      if (match) {
        audioDevices.push({ index: match[1].trim(), name: match[2].trim() });
      }
    }
  }

  if (audioDevices.length === 0) {
    // Fallback: print raw output so the user can find device manually
    console.log('Could not auto-parse device list. Raw ffmpeg output:\n');
    console.log(output);
    console.log('\nLook for lines with [N] after "AVFoundation audio devices".');
  } else {
    console.log('Found audio input devices:\n');
    for (const d of audioDevices) {
      console.log(`  [:${d.index}]  ${d.name}`);
    }
    console.log();
    console.log('Tips:');
    console.log('  • Default (built-in mic) is usually :0');
    console.log('  • Plug your phone into the 3.5mm jack and re-run this script');
    console.log('    — a new device should appear (often "External Microphone")');
    console.log('  • Also check System Settings → Sound → Input to confirm the');
    console.log('    3.5mm port is selected as the active input');
    console.log();
    console.log('Once you know the right index, add it to your .env:');
    console.log('  AUDIO_DEVICE=:1    (replace 1 with your device index)\n');
  }
});

proc.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('❌  ffmpeg not found.\n');
    console.error('Install it with Homebrew:');
    console.error('  brew install ffmpeg\n');
    console.error('Then re-run:  npm run devices\n');
  } else {
    console.error('Error:', err.message);
  }
  process.exit(1);
});

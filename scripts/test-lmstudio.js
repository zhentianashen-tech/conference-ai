#!/usr/bin/env node
'use strict';

/**
 * Test LM Studio connection and model availability
 * Usage: node scripts/test-lmstudio.js
 */

const http = require('http');

const LMSTUDIO_URL = process.env.AGENT_BASE_URL || 'http://localhost:1234';
const MODEL = process.env.AGENT_MODEL || 'local-model';

console.log('🔍 Testing LM Studio Connection\n');
console.log(`URL: ${LMSTUDIO_URL}`);
console.log(`Model: ${MODEL}\n`);

// Test 1: Check if server is running
function testConnection() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${LMSTUDIO_URL}/v1/models`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const models = JSON.parse(data);
            resolve(models);
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', (err) => {
      reject(new Error(`Connection failed: ${err.message}`));
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Connection timeout'));
    });
  });
}

// Test 2: Try a simple completion
function testCompletion() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say "LM Studio is working!" in 5 words or less.' }
      ],
      max_tokens: 50,
      temperature: 0.7
    });

    const url = new URL(LMSTUDIO_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 1234,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer lm-studio'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(data);
            const content = response.choices?.[0]?.message?.content;
            resolve(content || 'No content in response');
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Request failed: ${err.message}`));
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout (30s)'));
    });

    req.write(postData);
    req.end();
  });
}

// Run tests
async function runTests() {
  try {
    // Test 1: Connection
    console.log('Test 1: Checking server connection...');
    const models = await testConnection();
    console.log('✅ Server is running!');
    console.log(`   Loaded models: ${models.data?.length || 0}`);
    
    if (models.data && models.data.length > 0) {
      console.log('   Available models:');
      models.data.forEach(m => {
        console.log(`     - ${m.id}`);
      });
    }
    console.log('');

    // Test 2: Completion
    console.log('Test 2: Testing chat completion...');
    console.log('   (This may take 10-30 seconds for first response)');
    const response = await testCompletion();
    console.log('✅ Completion successful!');
    console.log(`   Response: "${response}"`);
    console.log('');

    console.log('🎉 All tests passed! LM Studio is ready to use.');
    console.log('   Run "npm start" to launch the conference assistant.');

  } catch (err) {
    console.log('❌ Test failed!\n');
    console.log(`Error: ${err.message}\n`);
    
    if (err.message.includes('Connection failed') || err.message.includes('ECONNREFUSED')) {
      console.log('Troubleshooting:');
      console.log('  1. Open LM Studio');
      console.log('  2. Load a model (e.g., Qwen3.5-4B)');
      console.log('  3. Go to Developer tab → Start Server');
      console.log('  4. Verify the server URL is http://localhost:1234');
    }
    
    if (err.message.includes('timeout')) {
      console.log('Troubleshooting:');
      console.log('  - Model might be too large for your system');
      console.log('  - Try a smaller model (1B-3B parameters)');
      console.log('  - Enable GPU acceleration in LM Studio');
    }
    
    process.exit(1);
  }
}

runTests();

# Conference Assistant - Complete Testing Guide

This guide walks you through testing every feature step by step.

---

## Pre-Flight Checklist

```bash
cd /Users/zhentianshen/Projects/conference-assistant-all/conference-assistant

# 1. Verify dependencies installed
npm list  # Should show blessed, openai, etc.

# 2. Check ffmpeg
which ffmpeg
ffmpeg -version | head -1

# 3. Check Node version
node --version  # Should be >= 18

# 4. Verify .env exists
cat .env | head -20
```

---

## Test 1: Basic Startup

### What to Test
App starts without errors, shows initial messages.

### Steps
```bash
npm start
```

### Expected Output
```
🎙 Conference Assistant started
ASR: nodejs-whisper (large-v3)
Agent: gemma3:12b  (or your configured model)
Proactive: medium
Two-Layer Prompts: Base + Session Context
Commands: /session, /expert [topic], /add, /info, /end, /search, /lookup
```

### Success Criteria
- ✅ No red error messages
- ✅ Status bar shows "● Recording"
- ✅ UI appears with transcript on left, assistant on right

---

## Test 2: Audio Device Configuration

### What to Test
App can detect and use your audio input.

### Steps
```bash
# In a separate terminal:
npm run devices
```

### Expected Output
```
🎙 Conference Assistant — Audio Device Setup

Found audio input devices:

  [:0]  MacBook Air Microphone
  [:1]  External Microphone
  [:2]  iPhone Audio

Tips:
  • Default (built-in mic) is usually :0
  • Plug your phone into the 3.5mm jack and re-run this script
    — a new device should appear (often "External Microphone")
```

### Configure Audio
```bash
# Edit .env
AUDIO_DEVICE=:1  # Use your device number
```

---

## Test 3: Transcription (Basic)

### What to Test
App transcribes audio in real-time.

### Steps
```bash
npm start

# Speak clearly into your microphone:
# "This is a test of the conference assistant transcription system."
```

### Expected Output (Left Panel - Live Transcript)
```
[10:34:52] This is a test of the conference assistant transcription system.
```

### Verify
- ✅ Text appears in left panel within 5-8 seconds of speaking
- ✅ Timestamp is correct
- ✅ Text is reasonably accurate

### Troubleshooting
```bash
# If no transcription:
# 1. Check audio device is correct in .env
# 2. Test audio recording manually:
ffmpeg -f avfoundation -i :0 -t 5 test.wav
# 3. Check if whisper model is downloaded
ls node_modules/nodejs-whisper/models/
```

---

## Test 4: Basic Q&A (Without Session Context)

### What to Test
Agent can answer questions about what was said.

### Steps
```bash
# 1. Start app
npm start

# 2. Speak into mic:
# "The deadline for the project is next Friday."

# 3. Wait for transcription to appear

# 4. Press Enter or ? to focus input, then type:
When is the deadline?
```

### Expected Output (Right Panel - AI Assistant)
```
You: When is the deadline?
Agent: According to the transcript, the deadline is next Friday.
```

### Success Criteria
- ✅ Agent correctly identifies the deadline from transcript
- ✅ Response is concise (2-4 sentences)

---

## Test 5: Two-Layer Prompts - Base Layer

### What to Test
Base system prompt (Layer 1) is always active.

### Steps
```bash
npm start

# In input box, type:
What are your core guidelines?
```

### Expected Output
```
Agent: I follow these core guidelines:
• Be concise (2-4 sentences unless asked for more)
• Answer based on transcript
• Flag transcription errors
• Search the web when you ask about external facts
```

### Verify Base Prompt File Exists
```bash
cat prompts/base-system.txt
```

---

## Test 6: Two-Layer Prompts - Session Layer

### What to Test
Setting and using session-specific context.

### Steps
```bash
npm start

# 1. Set up a session
/session title="Product Roadmap Discussion" goals="timeline,resource allocation,blockers"

# 2. Check it was set
/info
```

### Expected Output
```
📋 Current Session: Product Roadmap Discussion
Goals: timeline, resource allocation, blockers
```

### Test Session Context in Action
```bash
# Speak: "We might need to hire two more engineers for Q3."

# Ask: What resources do we need?
```

### Expected Output
```
You: What resources do we need?
Agent: According to the transcript, you might need to hire two more engineers for Q3. 
       This relates to your session goal of 'resource allocation'.
```

---

## Test 7: Technical Expert Interview Mode

### What to Test
BS detection for technical interviews.

### Steps
```bash
npm start

# Activate expert mode
/expert Training LLMs for System 2 reasoning
```

### Expected Output
```
🎯 Technical Interview Mode activated for: Training LLMs for System 2 reasoning
I will now watch for: vague claims, missing evidence, contradictions, buzzwords, and unrealistic promises
I'll alert you with "⚠️ RED FLAG:" and suggest questions to ask
```

### Test BS Detection
```bash
# Speak (simulating the expert): 
# "Our novel cognitive architecture achieves state-of-the-art reasoning 
#  with 100% accuracy using proprietary quantum-inspired optimization."

# Wait for proactive suggestion or ask:
What do you think about their claims?
```

### Expected Output
```
⚠️ RED FLAG: Multiple issues detected:
1. 'Novel cognitive architecture' - vague, no specifics given
2. 'State-of-the-art' - no benchmark mentioned
3. '100% accuracy' - unrealistic claim
4. 'Quantum-inspired' - buzzword without technical meaning

ASK: What specific architecture (transformer, graph network, etc.)? 
     What benchmark shows this performance?
     What does 'quantum-inspired' mean technically?
```

---

## Test 8: Web Search

### What to Test
Manual search and automatic search triggering.

### Manual Search
```bash
npm start

# In input:
/search Claude 3.5 Sonnet capabilities
```

### Expected Output
```
🔍 Searching: "Claude 3.5 Sonnet capabilities"...

Claude 3.5 Sonnet is Anthropic's latest model with:
• Improved coding abilities
• Better reasoning and analysis
• 200K context window
• Faster than Opus with near-Opus quality

Sources: anthropic.com,...
```

### Automatic Search
```bash
# In input (triggers auto-search):
Who is the CEO of OpenAI?
```

### Expected Output
```
You: Who is the CEO of OpenAI?
Agent: Sam Altman is the CEO of OpenAI.

Sources: wikipedia.org,...
```

### Search Triggers
These phrases automatically trigger search:
- "who is", "what is", "when did", "latest", "recent news", "price of"

---

## Test 9: Proactive Suggestions

### What to Test
App detects patterns and suggests actions.

### Steps
```bash
npm start

# Speak these phrases and wait 10-15 seconds:
"I'll send you the report by tomorrow."
"We decided to go with the Kubernetes approach."
"What about the security concerns?"
"I'm confused about the architecture."
```

### Expected Outputs

**Action Item Detected:**
```
📋 Action Item Detected: Possible task: "I'll send you the report by tomorrow"
   Actions: [Pin], [Search], [Ignore]
```

**Decision Made:**
```
🎯 Decision Made: A decision appears to have been reached
   Actions: [Summarize], [Pin], [Ignore]
```

**Question Raised:**
```
❓ Question Raised: A question was detected - search for answer?
   Actions: [Search], [Note], [Ignore]
```

**Clarification Needed:**
```
🤔 Clarification Needed: Someone may need clarification
   Actions: [Help], [Ignore]
```

### Configure Proactivity
```bash
# In .env:
PROACTIVE_LEVEL=high    # More sensitive detection
PROACTIVE_LEVEL=low     # Only critical (decisions, action items)
```

---

## Test 10: Note Pinning

### What to Test
Pinning important transcript segments.

### Steps
```bash
npm start

# 1. Speak something important:
"The budget for this project is exactly fifty thousand dollars."

# 2. Wait for transcription

# 3. Press 'N' key (or type /note)
```

### Expected Output
```
📌 Pinned: "The budget for this project is exactly fifty thousand dollars."
```

### Verify in Context
```bash
# Ask:
What was the budget again?
```

### Expected Output
```
Agent: According to your pinned notes, the budget is exactly fifty thousand dollars.
```

---

## Test 11: Summary Generation

### What to Test
Generating structured meeting summaries.

### Steps
```bash
npm start

# 1. Have a "mini meeting":
"Let's discuss the AI implementation. We decided to use LangChain for the orchestration. 
 Alice will handle the vector database setup by next Tuesday. 
 The main concern is the latency for real-time queries."

# 2. Wait for transcription

# 3. Press 'S' key (or type /summary)
```

### Expected Output
```
📋 Generating summary...

## Call Summary

**Key topics discussed:**
• AI implementation approach
• Tool selection (LangChain)
• Infrastructure concerns (latency)

**Decisions made:**
• Use LangChain for orchestration

**Action items:**
• Alice: Handle vector database setup (Due: Tuesday)

**Names/companies mentioned:**
• Alice
• LangChain

**Open questions:**
• How to address latency for real-time queries?
```

---

## Test 12: Gemini API Integration (Optional)

### Prerequisites
```bash
# In .env:
GEMINI_API_KEY=your_key_here
```

### Test Gemini Search Summarization
```bash
npm start

/search latest AI safety research
```

### Expected Enhancement
With Gemini: Results are synthesized into coherent summary.
Without Gemini: Raw search results displayed.

---

## Test 13: LM Studio Integration (Optional)

### Prerequisites
1. LM Studio installed and running
2. Model loaded (Qwen3.5-4B or your choice)
3. Server started on localhost:1234

### Test Connection
```bash
npm run test:lmstudio
```

### Expected Output
```
🔍 Testing LM Studio Connection

URL: http://localhost:1234/v1
Model: Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled

Test 1: Checking server connection...
✅ Server is running!
   Loaded models: 1
   Available models:
     - Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled

Test 2: Testing chat completion...
✅ Completion successful!
   Response: "LM Studio is working!"

🎉 All tests passed! LM Studio is ready to use.
```

### Use LM Studio
```bash
# In .env:
AGENT_BASE_URL=http://localhost:1234/v1
AGENT_API_KEY=lm-studio
AGENT_MODEL=Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled

npm start
```

---

## Test 14: Session Persistence Commands

### What to Test
Adding goals/participants mid-session.

### Steps
```bash
npm start

# 1. Start session
/session title="Architecture Review" goals="scalability,cost"

# 2. Mid-call, add new goal
/add goal="security audit"

# 3. Add participant
/add participant="CTO Sarah"

# 4. Check updated session
/info
```

### Expected Output
```
✅ Goal added: "security audit"
✅ Participant added: "CTO Sarah"

📋 Current Session: Architecture Review
Goals: scalability, cost, security audit
Participants: CTO Sarah
```

---

## Test 15: Edge Cases & Error Handling

### Test Empty Transcript Query
```bash
npm start

# Immediately ask (before any audio):
What did they say about the budget?
```

### Expected Output
```
Agent: I didn't catch that in the transcript - no transcript has been captured yet.
```

### Test Invalid Command
```bash
/invalidcommand
```

### Expected Output
```
Unknown command. Type /help for available commands.
```

### Test Search with No Results
```bash
/search xyzabc123nonsense
```

### Expected Output
```
No results found for "xyzabc123nonsense"
```

---

## Full Integration Test Script

Run this complete workflow:

```bash
# 1. Start app
npm start

# 2. Set up technical interview
/expert LLM Training Methods

# 3. Simulate expert speaking (you speak):
"We use a proprietary reinforcement learning approach that achieves 
 100% accuracy on all benchmarks."

# 4. Wait for BS detection alert

# 5. Ask for clarification
What should I ask about their accuracy claims?

# 6. Pin important info (press N after speaking)
"The training took 3 months on 1000 GPUs."

# 7. Web search for context
/search How long does LLM training typically take

# 8. Generate summary
Press 'S'

# 9. End session
/end

# 10. Quit
Press 'Q'
```

---

## Debugging Checklist

If something doesn't work:

### No Audio/Transcription
```bash
# 1. Check device
npm run devices

# 2. Test recording manually
ffmpeg -f avfoundation -i :0 -t 5 test.wav

# 3. Check model exists
ls node_modules/nodejs-whisper/models/ggml-large-v3.bin

# 4. Check .env
AUDIO_DEVICE=:0  # Or your correct device
```

### LLM Not Responding
```bash
# 1. Test LLM connection
curl http://localhost:11434/v1/models  # For Ollama
curl http://localhost:1234/v1/models   # For LM Studio

# 2. Check .env
AGENT_BASE_URL=http://localhost:11434/v1
AGENT_MODEL=gemma3:12b
```

### Search Not Working
```bash
# DuckDuckGo should work without API key
# If rate limited, wait a few minutes and retry
# Or set up SerpAPI:
SERPAPI_KEY=your_key_here
```

### Proactive Not Triggering
```bash
# Check it's enabled in .env
PROACTIVE_ENABLED=true
PROACTIVE_LEVEL=medium

# Speak clearly and wait 10-15 seconds
# Try PROACTIVE_LEVEL=high for more sensitivity
```

---

## Performance Benchmarks

Measure these on your system:

| Metric | Target | How to Test |
|--------|--------|-------------|
| Transcription latency | < 5s | Time from speech to text appearing |
| LLM response time | < 3s | Time from question to answer |
| Web search time | < 5s | Time for /search command |
| Memory usage | < 8GB | Activity Monitor / htop |

---

## Success Criteria Summary

✅ **Basic**: App starts, transcribes audio, answers questions  
✅ **Prompts**: Two-layer system works, session context applied  
✅ **Expert Mode**: BS detection triggers on vague claims  
✅ **Search**: Manual and automatic search work  
✅ **Proactive**: Suggestions appear for action items/decisions  
✅ **Notes**: Pinning and recall work  
✅ **Summary**: Structured summary generated  
✅ **Integration**: LM Studio or Ollama responds correctly  

---

*Test each feature in order. If one fails, fix it before moving to the next.*

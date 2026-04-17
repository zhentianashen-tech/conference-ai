# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A real-time conference call assistant that captures audio, transcribes it locally via Whisper, and uses an LLM to answer questions about the conversation. The terminal UI (blessed) shows a live transcript on the left and an AI chat panel on the right.

## Commands

```bash
npm start                          # Run the assistant
npm run devices                    # List audio input devices
npm run download-model large-v3    # Download Whisper model (also: medium, small, base, tiny)
npm run test:lmstudio              # Test LM Studio connection
```

**No automated test suite** — `npm test` just echoes a placeholder. Manual testing is documented in `TESTING_GUIDE.md`.

## Required Setup

Copy `.env.example` → `.env`. At minimum you need either:
- **Local LLM**: `AGENT_BASE_URL` (Ollama: `http://localhost:11434/v1` or LM Studio: `http://localhost:1234/v1`) + `AGENT_MODEL`
- **Cloud**: `OPENAI_API_KEY` or `GEMINI_API_KEY`

ffmpeg must be installed (`brew install ffmpeg`). Node ≥ 18 required.

## Architecture

```
index.js                  ← entry point, wires everything together
src/
  audio.js                ← ffmpeg-based audio capture, emits chunks
  transcriber-enhanced.js ← multi-backend ASR (nodejs-whisper / whisper-cpp / OpenAI)
  context.js              ← rolling transcript window (MAX_CONTEXT_SEGMENTS)
  context-manager-v3.js   ← extended context with session metadata
  agent-v2.js             ← main agent: two-layer prompts + tool use
  agent-openrouter.js     ← OpenRouter variant
  proactive.js / proactive-v3.js  ← background analyzer, detects action items/decisions
  prompt-manager.js       ← loads base-system.txt + builds session context
  session-manager.js      ← /session, /add, /end commands
  concept-detector.js     ← pattern matching for proactive triggers
  fact-checker.js         ← cross-checks claims in transcript
  ui.js                   ← blessed terminal UI
  ui-web.js               ← web UI variant (Express + Socket.io)
  tools/
    search.js             ← DuckDuckGo (default) or SerpAPI
    gemini.js             ← Google Gemini client for search summarization
prompts/
  base-system.txt         ← Layer 1: persistent agent identity
  technical-interview-mode.txt  ← activated by /expert command
  core-identity.txt       ← supplementary identity doc
  example-sessions.json   ← session templates (/templates command)
scripts/
  glm-asr-server.py       ← Python ASR server using GLM model
  start-asr-server.sh     ← launches the GLM ASR server
  start-conference-assistant.sh  ← convenience launcher
sessions/                 ← saved session transcripts/summaries
```

## Key Design Decisions

**Two-layer prompt system**: `prompts/base-system.txt` is always injected as the system prompt (Layer 1). Session context set via `/session title="..." goals="..."` is prepended dynamically (Layer 2). `prompt-manager.js` assembles both layers.

**ASR backends** (`WHISPER_BACKEND` env var):
- `nodejs-whisper` — default, runs locally via Node bindings; models live in `node_modules/nodejs-whisper/models/`
- `whisper-cpp` — requires a running whisper-server (`WHISPER_BASE_URL`)
- `openai` — cloud fallback

**Agent is OpenAI-compatible**: `agent-v2.js` uses the `openai` npm package pointed at `AGENT_BASE_URL`, so it works with Ollama, LM Studio, or real OpenAI transparently.

**Proactive analyzer** runs on a background interval, scanning the last N transcript segments for patterns (action items, decisions, deadlines, confusion signals) and emitting suggestions to the UI.

## In-App Commands (typed in the input box)

```
/session title="..." goals="..." participants="..."   # set session context
/add goal="..." / participant="..." / topic="..."      # add to session mid-call
/info  or  /session                                   # show current session
/end   or  /clearsession                              # end session
/expert <topic>                                       # activate BS-detection interview mode
/search <query>                                       # manual web search
/lookup <entity>                                      # quick entity lookup
/summary  or  S key                                   # generate meeting summary
/templates                                            # show session templates
```

## Troubleshooting Quick Reference

```bash
# Verify audio device index
npm run devices
ffmpeg -f avfoundation -i :0 -t 5 test.wav

# Verify LLM connectivity
curl http://localhost:11434/v1/models   # Ollama
curl http://localhost:1234/v1/models    # LM Studio

# Verify Whisper model exists
ls node_modules/nodejs-whisper/models/
```

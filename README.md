# Conference AI Assistant v3

A real-time bilingual (Chinese + English) conference assistant with local ASR, proactive analysis, and a web UI.

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  AudioRecorder  │────▶│  BilingualTranscriber │────▶│  ContextManagerV3   │
│  (ffmpeg)       │     │  (GLM-ASR-Nano / mlx) │     │  (sliding window +  │
└─────────────────┘     └──────────────────────┘     │   LLM compaction)   │
                                                       └──────────┬──────────┘
                                                                  │
                              ┌───────────────────────────────────┼──────────────────────┐
                              ▼                                   ▼                      ▼
                   ┌─────────────────────┐            ┌─────────────────────┐  ┌─────────────────┐
                   │  ProactiveAnalyzerV3│            │   ConceptDetector   │  │   FactChecker   │
                   │  (questionnaire +   │            │   (term intro)      │  │  (search-backed)│
                   │   insight detection)│            └─────────────────────┘  └─────────────────┘
                   └──────────┬──────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │   AgentOpenRouter   │
                   │  (Kimi k2.5 via     │
                   │   Moonshot API)     │
                   └──────────┬──────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │     Web UI          │
                   │  (Express +         │
                   │   Socket.io)        │
                   └─────────────────────┘
```

## Quick Start

### Prerequisites

```bash
brew install ffmpeg
# Python deps for local ASR
pip install mlx-audio fastapi uvicorn soundfile numpy
```

### Install & configure

```bash
npm install
cp .env.example .env
# Edit .env — at minimum set MOONSHOT_API_KEY
```

### Run

```bash
conference-ai                  # after npm link (see below)
# or
npm start
```

Open **http://localhost:3456** in your browser.

The `conference-ai` command auto-starts the GLM-ASR server when `ASR_PROVIDER=glm-local`.

## Configuration (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `MOONSHOT_API_KEY` | — | **Required.** Kimi API key from platform.moonshot.cn |
| `ANALYSIS_MODEL` | `kimi-k2.5` | Model for analysis and proactive suggestions |
| `ANALYSIS_BASE_URL` | `https://api.moonshot.cn/v1` | Override for other OpenAI-compatible providers |
| `ASR_PROVIDER` | `glm-local` | ASR backend: `glm-local` \| `qwen` \| `openai` |
| `GLM_ASR_MODEL` | `mlx-community/GLM-ASR-Nano-2512-4bit` | Local ASR model (Apple Silicon via mlx) |
| `GLM_ASR_PORT` | `8765` | Port for the local ASR server |
| `LANGUAGES` | `zh,en` | Comma-separated language codes for recognition |
| `AUDIO_DEVICE` | `:0` | ffmpeg audio device index (`npm run devices` to list) |
| `CHUNK_DURATION` | `4` | Seconds per audio chunk |
| `PROACTIVE_ENABLED` | `true` | Enable background proactive analysis |
| `PROACTIVE_LEVEL` | `medium` | `low` \| `medium` \| `high` |
| `PROACTIVE_INTERVAL_SEC` | `30` | Seconds between proactive analysis cycles |
| `UI_PORT` | `3456` | Web UI port |

## Global CLI (`conference-ai`)

```bash
cd conference-assistant
npm link

conference-ai                                        # generic session (default)
conference-ai --session ./sessions/my-interview.yaml # load a session file
conference-ai --device :1                            # different audio device
conference-ai --model kimi-k2.5                      # override model
```

## Session Files

Session YAML files inject context into the system prompt. Pass one via `--session` or load mid-call with `/session <path>`.

```yaml
title: "My Meeting"
participants: [Alice, Bob]
background: |
  Optional free-form context injected into the system prompt.
goals:
  - Track action items and owners
  - Note key decisions
questionnaire:            # optional — tracked in real-time
  - id: q1
    question: "What is the budget?"
    keywords: [budget, cost, price]
    priority: high
```

Templates in `sessions/`: `generic.yaml`, `example-conference.yaml`, `example-interview.yaml`.

## In-app Commands

```
/session <path>   load a session YAML file
/progress         show questionnaire coverage
/analyze          trigger proactive analysis now
/factcheck        run fact-check now
/summary          generate meeting summary
/compact          manually compact context window
/context          show context window stats
/help             list all commands
```

## Find Your Audio Device

```bash
npm run devices
ffmpeg -f avfoundation -list_devices true -i ""
```

## Troubleshooting

```bash
# ASR server not reachable
python3 scripts/glm-asr-server.py   # start manually

# Check analysis API
curl https://api.moonshot.cn/v1/models -H "Authorization: Bearer $MOONSHOT_API_KEY"

# Wrong audio device
npm run devices   # find correct index, set AUDIO_DEVICE in .env
```

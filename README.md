# Conference AI Assistant v2.0

An enhanced real-time conference call assistant with better speech recognition, proactive insights, web search, and Gemini API integration.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)

## ✨ What's New in v2.0

- **🎙️ Better ASR**: Support for larger Whisper models (large-v3) via nodejs-whisper
- **💡 Proactive Assistant**: Background analysis detects decisions, action items, questions, deadlines
- **🧠 Two-Layer Prompts**: Base (persistent) + Session (dynamic) context for smarter responses
- **🔍 Web Search**: DuckDuckGo integration (no API key) or SerpAPI for Google search
- **🧠 Gemini API**: Google's AI for enhanced analysis and longer context
- **🛠️ Tool Use**: Agent automatically searches when relevant
- **🔧 LM Studio Support**: Use any GGUF model via LM Studio's API

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ AudioRecorder│────▶│ Transcriber │────▶│ ContextManager  │
└─────────────┘     │  (Enhanced)  │     └────────┬────────┘
                    └──────────────┘              │
                           │                      ▼
                    ┌──────────────┐     ┌─────────────────┐
                    │ nodejs-whisper      │ ProactiveAnalyzer│
                    │ whisper-cpp  │     │ (Background)    │
                    │ OpenAI       │     └─────────────────┘
                    └──────────────┘              │
                                                  ▼
                                           ┌─────────────────┐
                                           │   AgentV2       │
                                           │  (Tool-using)   │
                                           └────────┬────────┘
                                                    │
                           ┌────────────────────────┼────────────────────────┐
                           ▼                        ▼                        ▼
                    ┌─────────────┐        ┌─────────────┐          ┌─────────────┐
                    │ SearchTool  │        │ GeminiTool  │          │   UI        │
                    │ (DuckDuckGo)│        │  (Google)   │          │  (Blessed)  │
                    └─────────────┘        └─────────────┘          └─────────────┘
```

## 🚀 Quick Start

### Prerequisites

```bash
# macOS
brew install ffmpeg

# Node.js 18+ required
node --version  # Should be >= 18.0.0
```

### Installation

```bash
# Navigate to project
cd conference-assistant

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Edit .env with your API keys (see Configuration section)
nano .env
```

### Download ASR Model (Recommended: large-v3)

With 18GB unified memory, you can run the large-v3 model (~3GB) comfortably:

```bash
# Download large-v3 model for nodejs-whisper
npm run download-model large-v3

# Or use smaller models if needed
npm run download-model medium
npm run download-model small
npm run download-model base
npm run download-model tiny
```

### Find Audio Device

```bash
npm run devices
```

Plug your phone into the 3.5mm jack and re-run to find the new device index.

### Run

```bash
npm start
```

## ⚙️ Configuration

### Essential Settings (`.env`)

#### Option A: Ollama (Local)
```bash
# ASR Backend: nodejs-whisper | whisper-cpp | openai
WHISPER_BACKEND=nodejs-whisper
WHISPER_MODEL_SIZE=large-v3

# Agent: Ollama
AGENT_BASE_URL=http://localhost:11434/v1
AGENT_MODEL=gemma3:12b

# Gemini API (optional but recommended)
GEMINI_API_KEY=your_gemini_key_here

# Web Search (DuckDuckGo works without API key)
DDG_SEARCH_ENABLED=true
```

#### Option B: LM Studio (Local GGUF models)
```bash
# ASR Backend
WHISPER_BACKEND=nodejs-whisper
WHISPER_MODEL_SIZE=large-v3

# Agent: LM Studio
AGENT_BASE_URL=http://localhost:1234/v1
AGENT_API_KEY=lm-studio
AGENT_MODEL=Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled

# Web Search
DDG_SEARCH_ENABLED=true
```
See [LM Studio Setup Guide](LMSTUDIO_SETUP.md) for detailed instructions.

### Full Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_BACKEND` | `nodejs-whisper` | ASR backend: nodejs-whisper, whisper-cpp, openai |
| `WHISPER_MODEL_SIZE` | `large-v3` | Model size for nodejs-whisper |
| `WHISPER_DEVICE` | `cpu` | Device: cpu, cuda, mps (Apple Silicon) |
| `WHISPER_VAD` | `true` | Enable voice activity detection |
| `AGENT_BASE_URL` | - | Ollama or OpenAI-compatible API URL |
| `AGENT_MODEL` | `gemma3:12b` | Model name for agent |
| `GEMINI_API_KEY` | - | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model variant |
| `USE_GEMINI_PRIMARY` | `false` | Use Gemini as primary agent |
| `SERPAPI_KEY` | - | SerpAPI key for Google search |
| `DDG_SEARCH_ENABLED` | `true` | Enable DuckDuckGo search (no key) |
| `PROACTIVE_ENABLED` | `true` | Enable proactive suggestions |
| `PROACTIVE_LEVEL` | `medium` | low/medium/high proactivity |
| `AUDIO_DEVICE` | `:0` | Audio input device index |
| `CHUNK_DURATION` | `4` | Seconds per audio chunk |

## 🎮 Usage

### Session Controls (Buttons)

The app features three control buttons in the header:

| Button | State | Action | Shortcut |
|--------|-------|--------|----------|
| **[Start]** | Green | Begin recording / Resume from pause | `Space` |
| **[Pause]** | Yellow | Temporarily stop recording | `Space` |
| **[End]** | Red | End session & generate summary | - |

**Workflow:**
1. Click **[Start]** to begin recording
2. Click **[Pause]** for breaks (preserves session)
3. Click **[End]** when finished (auto-generates summary)

See [Button Controls Guide](BUTTON_CONTROLS.md) for details.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `?` or `/` or `Enter` | Focus input box |
| `Space` | Toggle Start/Pause (when not typing) |
| `S` | Generate summary |
| `N` | Pin last transcript segment |
| `Q` or `Ctrl+C` | Quit |
| `Esc` | Clear input, unfocus |

### Commands

In the input box, type:

```
/search <query>      # Manual web search
/lookup <entity>     # Quick entity lookup
```

Examples:
```
/search Apple stock price today
/lookup OpenAI
/search latest news on AI regulation
```

### Two-Layer System Prompts 🆕

The assistant uses a sophisticated two-layer prompt architecture:

#### Layer 1: Base System Prompt (Persistent)
- **Location**: `prompts/base-system.txt`
- **Purpose**: Core identity and behavior guidelines
- **Applies to**: ALL sessions
- **Content**: Response guidelines, when to search, transcript accuracy notes

#### Layer 2: Session Context (Dynamic)
- **Set per call/meeting** using `/session` command
- **Purpose**: Meeting-specific instructions and priorities
- **Content**: Goals, participants, topics to track

**Session Commands:**
```
# Start a new session with context
/session title="Sales Call - Acme Corp" goals="pricing, timeline" participants="John, Sarah"

# Add items mid-session
/add goal="Follow up on security requirements"
/add participant="CTO joining late"
/add topic="Integration concerns"

# Check current session
/session       or    /info

# End session
/end           or    /clearsession

# View example templates
/templates
```

**Example Session Templates:**
- `sales_call` - Track pricing objections, decision makers, timeline
- `interview` - Note candidate skills, red flags, salary expectations
- `team_sync` - Capture blockers, action items with owners
- `investor_pitch` - Track concerns, traction metrics, follow-ups

### Proactive Suggestions

The assistant automatically detects:

- **📋 Action Items**: "I'll send you the report", "You need to follow up"
- **🎯 Decisions**: "Let's go with option A", "We decided to..."
- **❓ Questions**: "What about the budget?", "How do we proceed?"
- **⏰ Deadlines**: "By Friday", "Next week", "End of month"
- **🤔 Confusion**: "I don't understand", "Can you repeat?"

When detected, a suggestion appears with available actions like `[Pin]`, `[Search]`, `[Summarize]`, `[Ignore]`.

## 🔧 Backends

### ASR Options

1. **nodejs-whisper** (Recommended)
   - Local execution, no cloud dependency
   - Supports large-v3 model with 18GB RAM
   - Auto-downloads models on first use

2. **whisper.cpp**
   - Requires running whisper-server
   - Very fast, C++ implementation
   - Good for lower resource usage

3. **OpenAI Cloud**
   - Requires API key
   - No local compute needed
   - Pay-per-use

### Agent Options

1. **Ollama** (Recommended for local)
   - `ollama pull gemma3:12b` for good quality
   - `ollama pull llama3` for alternative
   - Completely private

2. **LM Studio** (Great for GGUF models)
   - Easy GUI for model management
   - Supports any GGUF model
   - Metal GPU acceleration on macOS
   - See [LM Studio Setup Guide](LMSTUDIO_SETUP.md)

3. **Gemini API**
   - Fast, cost-effective
   - 1M+ token context
   - Good for search summarization

4. **OpenAI**
   - GPT-4o, GPT-3.5-turbo
   - Standard API

## 🧪 Testing Components

```bash
# Test transcriber
node -e "const {TranscriberEnhanced} = require('./src/transcriber-enhanced'); const t = new TranscriberEnhanced(); console.log(t.getModelInfo());"

# Test search
node -e "const {SearchTool} = require('./src/tools/search'); const s = new SearchTool(); s.search('test query').then(r => console.log(r.length, 'results'));"

# Test Gemini
node -e "const {GeminiTool} = require('./src/tools/gemini'); const g = new GeminiTool(); console.log(g.getInfo());"
```

## 📁 Project Structure

```
conference-assistant/
├── index.js                    # Main entry point
├── package.json
├── .env.example               # Configuration template
├── setup.js                   # Audio device finder
├── README.md
└── src/
    ├── audio.js               # Audio recording (ffmpeg)
    ├── transcriber.js         # Original transcriber
    ├── transcriber-enhanced.js # Enhanced with multiple backends
    ├── context.js             # Context management
    ├── agent.js               # Original agent
    ├── agent-v2.js            # Enhanced tool-using agent
    ├── proactive.js           # Background analyzer
    ├── ui.js                  # Terminal UI
    └── tools/
        ├── index.js           # Tools export
        ├── search.js          # Web search (DDG/SerpAPI)
        └── gemini.js          # Gemini API client
```

## 🐛 Troubleshooting

### ASR Issues

```bash
# Check model is downloaded
ls node_modules/nodejs-whisper/models/

# Switch to smaller model if OOM
WHISPER_MODEL_SIZE=medium

# Use whisper.cpp as fallback
WHISPER_BACKEND=whisper-cpp
WHISPER_BASE_URL=http://localhost:8080
```

### Audio Issues

```bash
# List devices manually
ffmpeg -f avfoundation -list_devices true -i ""

# Test recording
ffmpeg -f avfoundation -i :0 -t 5 test.wav
```

### Search Issues

DuckDuckGo search may occasionally rate-limit. If this happens:
- Wait a moment and retry
- Or set up SerpAPI for more reliable search

## 📜 License

MIT

## 🙏 Acknowledgments

- [OpenAI Whisper](https://github.com/openai/whisper) - Speech recognition
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) - C++ implementation
- [nodejs-whisper](https://github.com/ChetanXpro/nodejs-whisper) - Node.js bindings
- [Ollama](https://ollama.com/) - Local LLMs
- [Gemini](https://deepmind.google/technologies/gemini/) - Google's AI
- [Blessed](https://github.com/chjj/blessed) - Terminal UI

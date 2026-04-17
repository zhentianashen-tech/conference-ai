# LM Studio Integration Guide

This guide explains how to use LM Studio as the inference engine for the Conference AI Assistant.

## Why LM Studio?

- **No Ollama needed** - Direct GGUF model loading
- **Better model management** - Easy to switch between models
- **GPU acceleration** - Metal (MPS) support on macOS
- **OpenAI-compatible API** - Works seamlessly with existing code
- **Great UI** - Visual model management and chat interface

## Quick Start

### 1. Install LM Studio

```bash
# macOS (with Homebrew)
brew install --cask lm-studio

# Or download from:
# https://lmstudio.ai/
```

### 2. Download Your Model

Your model is already at:
```
/Users/zhentianshen/.lmstudio/models/Jackrong/Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-GGUF
```

**If you need to download it:**
1. Open LM Studio
2. Go to "Search" tab
3. Search for: `Jackrong/Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled`
4. Download the GGUF version

### 3. Configure LM Studio Server

1. **Load the model:**
   - Click "Select a model to load"
   - Choose: `Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-GGUF`
   - Wait for it to load (status shows green checkmark)

2. **Start the API server:**
   - Go to "Developer" tab (left sidebar)
   - Click "Start Server"
   - Default endpoint: `http://localhost:1234/v1`
   - Verify it's running (green indicator)

3. **Server settings (optional):**
   - Context Length: 4096 (or higher if you have RAM)
   - Batch Size: 512
   - GPU Acceleration: Enable if available (Metal on Mac)

### 4. Configure Conference Assistant

```bash
# Use the LM Studio configuration
cd conference-assistant
cp .env.lmstudio .env

# Or manually set these in .env:
echo "AGENT_BASE_URL=http://localhost:1234/v1" >> .env
echo "AGENT_API_KEY=lm-studio" >> .env
echo "AGENT_MODEL=Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled" >> .env
```

### 5. Run

```bash
npm start
```

You should see:
```
[AgentV2] Model: Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled
```

## About Your Model

**Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled**

| Attribute | Value |
|-----------|-------|
| **Base Model** | Qwen 3.5 4B |
| **Distilled From** | Claude 4.6 Opus |
| **Parameters** | 4B |
| **Format** | GGUF |
| **Strengths** | Reasoning, following instructions, conciseness |
| **Memory** | ~2-3GB RAM |
| **Speed** | Very fast on CPU, blazing on GPU |

**Why this model is great for conference assistant:**
- ✅ Small (4B) but capable - fast responses
- ✅ Distilled from Claude Opus - high quality reasoning
- ✅ Good at following system prompts
- ✅ Concise output (perfect for real-time assistance)
- ✅ Qwen architecture - excellent multilingual support

## Performance Tips

### On macOS (Apple Silicon)

```bash
# Enable Metal GPU acceleration in LM Studio:
# Developer tab → Hardware Settings → GPU Acceleration → Metal

# This will use your M1/M2/M3 GPU for 5-10x speedup
```

### Optimize for Speed

In LM Studio server settings:
- **Context Length**: 4096 (reduce if slow)
- **Batch Size**: 512-1024
- **Temperature**: 0.3-0.7 (lower = more deterministic)
- **GPU Layers**: Max out (move all layers to GPU)

### Expected Performance

| Hardware | Tokens/Second | Latency |
|----------|--------------|---------|
| M1/M2 Mac (CPU) | 15-25 t/s | ~2s |
| M1/M2 Mac (Metal) | 50-80 t/s | ~0.5s |
| Intel Mac | 10-15 t/s | ~3s |

## Troubleshooting

### Connection Refused

```bash
# Check if LM Studio server is running
curl http://localhost:1234/v1/models

# Should return list of loaded models
# If empty, load model in LM Studio first
```

### Model Not Found

```bash
# Verify model is loaded in LM Studio
# Try with generic model name:
AGENT_MODEL=local-model
```

### Out of Memory

```bash
# Reduce context length in LM Studio
# Try smaller GGUF quantization (Q4 instead of Q8)
# Or use Qwen 1.8B variant
```

### Slow Responses

1. Enable GPU acceleration in LM Studio
2. Reduce context length
3. Use more aggressive quantization (Q4_K_M)
4. Close other applications

## Advanced: Model Switching

You can quickly switch between models in LM Studio without restarting the conference assistant:

1. In LM Studio, load a different model
2. The API will automatically use the new model
3. Conference assistant will pick it up on next request

**Recommended models to try:**
- `gemma-3-4b-it` - Google's model, very fast
- `phi-4` - Microsoft's model, good reasoning
- `llama-3.2-3b-instruct` - Meta's model, balanced
- `qwen2.5-7b-instruct` - Larger Qwen, more capable

## Integration with Other Components

Even with LM Studio for the LLM, you can still use:

| Component | Option | Status |
|-----------|--------|--------|
| ASR | nodejs-whisper (local) | ✅ Works |
| ASR | whisper.cpp (local) | ✅ Works |
| Search | DuckDuckGo (free) | ✅ Works |
| Search | SerpAPI | ✅ Works |
| Enhancement | Gemini API | ✅ Optional |

Example hybrid setup:
```bash
# Local everything except search enhancement
AGENT_BASE_URL=http://localhost:1234/v1
GEMINI_API_KEY=your_key  # Only for search summarization
USE_GEMINI_PRIMARY=false  # Use LM Studio for chat
```

## Monitoring

Watch LM Studio's performance metrics:
- **Tokens/second** - Speed indicator
- **VRAM usage** - GPU memory
- **Context length** - How much of the model's memory is used

## Next Steps

1. **Test the setup**: Run `npm start` and ask a question
2. **Tune context length**: Find the sweet spot for your use case
3. **Try other models**: Download different GGUF models and compare
4. **Enable GPU**: If you have Metal GPU, enable it for massive speedup

## Resources

- [LM Studio Documentation](https://lmstudio.ai/docs)
- [GGUF Format Info](https://github.com/ggerganov/ggml/blob/master/docs/gguf.md)
- [Qwen Model Card](https://huggingface.co/Qwen)

---

*Your 18GB unified memory can comfortably run this 4B model with large-v3 Whisper simultaneously!*

# Technical Expert Interview Mode

## The Problem

You're interviewing a technical expert about AI/ML topics (like training models with system 2 thinking), but you're not as technical as they are. You need help detecting when they're:

- **BS-ing** - Making things up or exaggerating
- **Being vague** - Using buzzwords without substance  
- **Overpromising** - Claims that sound too good to be true
- **Contradicting themselves** - Saying A then saying B
- **Hiding behind credentials** - "Trust me, I'm an expert"

## The Solution

Use the **`/expert`** command to activate **Technical BS Detection Mode**.

## Quick Start

```bash
# Start the assistant
npm start

# When ready to interview, activate expert mode
/expert How to train models for system 2 thinking

# Or without a specific topic
/expert
```

## What It Does

The assistant now becomes your **technical research assistant** with these superpowers:

### 🚩 Red Flag Detection

The assistant watches for:

| Red Flag | Example | What Assistant Does |
|----------|---------|---------------------|
| **Vague buzzwords** | "It's AI-powered and state-of-the-art" | ⚠️ Alerts: "Ask them to quantify - what does 'state-of-the-art' mean specifically?" |
| **Missing evidence** | "We get 99% accuracy" (no dataset mentioned) | ⚠️ Alerts: "Ask: What benchmark and what was the train/test split?" |
| **Unrealistic claims** | "Works perfectly for all languages" | ⚠️ Alerts: "Impossible claim. Ask: Which specific languages and what were the scores?" |
| **Evasion** | "It's too complex" / "Proprietary" | ⚠️ Alerts: "Push for at least high-level architecture overview" |
| **Contradictions** | Says no RLHF, then mentions alignment training | ⚠️ Alerts: "Contradiction detected. Ask for clarification." |
| **Appeal to authority** | "Our PhDs from MIT..." without explaining HOW | ⚠️ Alerts: "Credentials noted, but how does the technology actually work?" |

### 💡 Suggested Questions

When a red flag is detected, the assistant suggests specific questions:

**Instead of vague:**
- ❌ "Tell me more"

**Assistant suggests:**
- ✅ "You mentioned 'optimized' - can you quantify that? What's the latency improvement?"
- ✅ "What evaluation metric are you using and what's the baseline comparison?"
- ✅ "You said it works for all cases - have you tested edge cases like [specific scenario]?"

### 📚 Technical Context

The assistant provides background knowledge:

**Expert says:** "We use a novel attention mechanism"

**Assistant adds context:** 
- "Standard transformer uses multi-head self-attention. 'Novel' could mean: sparse attention, linear attention, or something else. Ask which variant."

**Expert says:** "Zero-shot performance"

**Assistant adds context:**
- "True zero-shot means no examples given. Often people mean few-shot. Ask: How many examples were in the prompt?"

## Example Session

```
You: /expert Training models for system 2 reasoning

Assistant: 🎯 Technical Interview Mode activated for: Training models for system 2 reasoning
I will now watch for: vague claims, missing evidence, contradictions, buzzwords, and unrealistic promises
I'll alert you with "⚠️ RED FLAG:" and suggest questions to ask

[Call starts...]

Expert: "Our approach achieves state-of-the-art reasoning using novel cognitive architectures."

Assistant: ⚠️ RED FLAG: 'State-of-the-art' without benchmark. 'Novel cognitive architectures' is vague.
ASK: What specific benchmark (GSM8K, MATH, etc.) and what score? What's novel about your architecture vs standard chain-of-thought?

Expert: "We don't need any training data, it just learns from the prompt."

Assistant: ⚠️ RED FLAG: Unrealistic claim. "Just learns from prompt" sounds like in-context learning, not training.
ASK: Clarify - are you doing in-context learning with examples, or actual model training? What's the compute cost?

Expert: "It has 100% accuracy on our internal tests."

Assistant: ⚠️ RED FLAG: Extraordinary claim without evidence. "Internal tests" not peer-reviewed.
ASK: What independent benchmarks have you tested on? Can you share the dataset and evaluation code?
```

## Understanding Technical Claims

### What to Expect (Realistic)

| Claim | Reality Check |
|-------|---------------|
| "Better than GPT-4 on X" | Possible if X is narrow domain, requires specific benchmark |
| "10x faster inference" | Possible with distillation/quantization, ask about accuracy trade-off |
| "Works with 1000x less data" | Possible with strong priors/transfer learning, ask about generalization |
| "No hallucinations" | **Impossible** - all LLMs hallucinate, ask about mitigation strategies |
| "100% accuracy" | **Impossible** on real-world tasks - ask about test set size |

### Valid Technical Details (Good Signs)

Experts giving legitimate technical answers will mention:
- Specific model sizes (7B, 70B parameters)
- Named architectures (Llama, Mistral, Mixtral)
- Benchmarks (MMLU, HumanEval, GSM8K)
- Training compute (A100-hours, FLOPs)
- Failure modes and limitations
- Comparison to baselines

## Commands During Interview

| Command | Use When |
|---------|----------|
| `/expert [topic]` | Start technical interview mode |
| `/add goal="..."` | Add something specific to watch for |
| `/info` | Check what's being monitored |
| `/end` | End the interview session |

## Tips for Non-Technical Interviewers

1. **Don't pretend to understand** - It's okay to say "I'm not technical, can you explain that?"

2. **Ask for specifics** - When they say something works, ask "How do you know?"

3. **Watch for discomfort** - Legitimate experts can explain their work simply. BS-ers get defensive.

4. **Check consistency** - The assistant tracks contradictions automatically

5. **Trust the assistant** - If it flags something, there's probably a reason

## Common AI/ML BS Patterns

### The "It's Proprietary" Defense
- **What it hides:** They haven't actually built it
- **What to ask:** "Can you share at least the architecture diagram or high-level approach?"

### The "Quantum/Neuro/Blockchain" Sprinkle
- **What it means:** Adding buzzwords to sound advanced
- **What to ask:** "How specifically does [buzzword] improve performance?"

### The "Industry Standard" Appeal
- **What it means:** Everyone does it this way (not a technical argument)
- **What to ask:** "Why is that the standard? What are the trade-offs?"

### The "Trust Me, I'm from [Big Company]"
- **What it means:** Using credentials instead of technical merit
- **What to ask:** "That's great, but can you walk through the technical approach?"

### The "It's Too Complex"
- **What it means:** They don't understand it themselves
- **What to ask:** "Explain it to me like I'm smart but not technical"

## After the Interview

Generate a summary with `S` key. The assistant will highlight:
- Claims that need verification
- Questions that weren't answered
- Contradictions noted
- Missing technical details

## Remember

The assistant is a **tool to help you learn**, not a weapon to confront the expert. Use the insights to:
- Ask better follow-up questions
- Do post-interview research
- Get second opinions on questionable claims

**Not all experts are BS-ing** - some are genuinely knowledgeable but bad at explaining. The assistant helps you tell the difference.

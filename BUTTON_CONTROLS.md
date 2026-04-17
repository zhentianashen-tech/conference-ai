# Button Controls Guide

The Conference Assistant now has **Start**, **Pause**, and **End** buttons for easy session control.

## UI Layout

```
┌────────────────────────────────────────────────────────────────┐
│  🎙 Conference AI  [Start] [Pause] [End]  |  ? Ask  S Sum  N Note  Q Quit  │
├──────────────────────────────────┬─────────────────────────────┤
│   📜 Live Transcript             │   🤖 AI Assistant           │
│                                  │                             │
├──────────────────────────────────┴─────────────────────────────┤
│  ● Ready  Press [Start] to begin recording                      │
├────────────────────────────────────────────────────────────────┤
│  Ask: [_____________________________________________]           │
└────────────────────────────────────────────────────────────────┘
```

## Button Functions

### [Start] Button (Green)
- **Idle state**: Begins a new recording session
- **Paused state**: Resumes recording from where you left off
- **Keyboard shortcut**: `Space` (when not typing)

### [Pause] Button (Yellow)
- **Active during recording**: Temporarily stops recording
- **Preserves session context**: Transcript and notes are kept
- **Keyboard shortcut**: `Space` (when recording)

### [End] Button (Red)
- **Stops recording completely**
- **Automatically generates a session summary**
- **Clears the session (optional)**

## State Machine

```
┌─────────┐    [Start]     ┌─────────────┐    [Pause]    ┌─────────┐
│  IDLE   │ ─────────────▶ │  RECORDING  │ ────────────▶ │ PAUSED  │
│  (gray) │                │   (green)   │               │(yellow) │
└─────────┘ ◀───────────── └─────────────┘ ◀──────────── └─────────┘
              [End]                              [Start]
```

## Typical Workflow

### 1. Setup Phase (Before the Call)
```bash
npm start

# App opens in IDLE state
# Status: "● Ready  Press [Start] to begin recording"

# Optional: Set up session context
/session title="Interview with ML Expert" goals="system 2 thinking,training methods"

# Or use expert mode
/expert LLM training for reasoning
```

### 2. Recording Phase (During the Call)
```
Click [Start] or press Space
↓
Status: "● Recording  Press [Pause] or Space to pause"
↓
[Assistant transcribes audio in real-time]
↓
Need a break? Click [Pause]
↓
Status: "⏸ Paused  Press [Start] or Space to resume"
↓
Ready again? Click [Start] to resume
↓
Status: "● Recording"
```

### 3. End Phase (After the Call)
```
Call finished? Click [End]
↓
Status: "■ Stopped  Generating summary..."
↓
[Assistant automatically generates summary]
↓
Review summary in AI Assistant panel
↓
Optionally save or export notes
↓
Start new session with [Start]
```

## Button States

| State | Start | Pause | End | Status Message |
|-------|-------|-------|-----|----------------|
| **Idle** | Green [Start] | Gray (disabled) | Gray (disabled) | "● Ready" |
| **Recording** | Gray (disabled) | Yellow [Pause] | Red [End] | "● Recording" |
| **Paused** | Green [Resume] | Gray (disabled) | Red [End] | "⏸ Paused" |

## Why Pause Instead of Stop?

**Pause is useful when:**
- You need to take a short break
- The expert asks for a moment to find information
- You want to step away briefly
- There's a distraction you want to exclude from the transcript

**End is for when:**
- The call is completely finished
- You want to generate a final summary
- You're ready to start a new session

## Keyboard Shortcuts

| Key | Function |
|-----|----------|
| `Space` | Toggle Start/Pause |
| `S` | Generate summary (while recording) |
| `N` | Pin last transcript segment |
| `Q` or `Ctrl+C` | Quit application |
| `?` or `/` | Focus input box |
| `Enter` | Submit query |
| `Esc` | Clear input |

## Visual Indicators

### Status Bar Colors
- **Gray**: Idle (not recording)
- **Green**: Recording actively
- **Yellow**: Paused
- **Red**: Error state

### Button Colors
- **Green**: Available to click
- **Yellow**: Active/Pause function
- **Red**: End/Stop function
- **Gray**: Disabled (can't click)

## Example Session

```
[10:00] You: Click [Start]
        Status: "● Recording"

[10:05] Expert: "We use a novel architecture..."
        Transcript appears in left panel

[10:15] You: Click [Pause] (bathroom break)
        Status: "⏸ Paused"

[10:20] You: Click [Start] (back from break)
        Status: "● Recording resumed"

[11:00] Expert: Call wraps up
        You: Click [End]
        
        Status: "■ Stopped  Generating summary..."
        
        [Summary appears in AI Assistant panel]

[11:05] You: Review summary, take notes
        Start new session or quit
```

## Tips

1. **Always set session context before starting** - Use `/session` or `/expert` to configure what the assistant should watch for

2. **Pause liberally** - Better to pause during breaks than have irrelevant audio transcribed

3. **End generates summary** - The summary at the end includes the full session, not just since last pause

4. **Space bar is your friend** - Quick toggle without reaching for mouse

5. **Check status bar** - Always shows current state and what you can do next

## Troubleshooting

### Buttons not responding
- Make sure you're not typing in the input box (press Esc to unfocus)
- Check if the app has frozen (status bar stops updating)

### [Pause] is grayed out
- You can only pause when actively recording
- Check status bar - if it says "● Ready", you need to [Start] first

### [End] didn't generate summary
- End only works when recording or paused (not from idle)
- Check AI Assistant panel for any error messages

### Accidentally clicked [End]
- The transcript is still there until you start a new session
- You can still use `/session` commands and ask questions about what was captured

## Migration from Old Version

**Before:**
- App started recording immediately
- No pause functionality
- Had to use `S` key for summary while recording
- `Q` to quit

**Now:**
- App starts in IDLE state
- Click [Start] to begin
- [Pause] for breaks
- [End] automatically generates summary
- Still have `S`, `N`, `Q` keyboard shortcuts

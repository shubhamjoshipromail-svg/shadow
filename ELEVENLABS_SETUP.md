# ElevenLabs setup (about 10 minutes)

Shadow uses **two ElevenAgents**. Both use a **Custom LLM** that points at Shadow Core, so Shadow decides what they say and ElevenLabs does voice, turn-taking and transcription.

## 0. Shadow Core needs a public URL
ElevenLabs calls your backend, so `localhost` won't work. Use one of:
- **Railway:** deploy `backend/`, then use the `https://…up.railway.app` URL.
- **Tunnel for local dev:** `brew install cloudflared`, then `cloudflared tunnel --url http://localhost:8000`.

Check it works: `curl https://YOUR-URL/health` should return `{"ok": true, ...}`.

## 1. Interviewer agent ("Shadow – Interviewer")
In ElevenLabs, go to **Agents** → **New agent** → **Blank**.

- **System prompt** (Shadow overrides behavior anyway; this keeps it safe if a turn bypasses Shadow):
  ```
  You are Shadow, a quiet, curious apprentice watching an expert work. SHADOW_SESSION={{shadow_session}}
  Keep every reply to one or two short sentences. Never lecture.
  ```
- **First message:** `Hi, I'm Shadow. Just work as you normally would. I'll stay quiet and only ask when something isn't obvious.`
- **LLM** → **Custom LLM**:
  - Server URL: `https://YOUR-URL/v1`. Leave the endpoint on *Chat Completions*; ElevenLabs appends `/chat/completions`.
  - Model id: `shadow`.
  - API key: anything (not checked).
- **Voice:** a calm, curious voice. Turn on **Expressive mode** if it's available for that voice.
- **Language:** English, and add **German** as an additional language for the multilingual stretch goal.
- **Advanced:**
  - Turn eagerness: *patient* / low.
  - Turn on "user can interrupt".
  - Set a long inactivity timeout (the expert is working, not talking).
- **Security** → enable overrides for **First message**, **Language** and **System prompt**, plus **Dynamic variables**. The console passes `shadow_session` as a dynamic variable and in `customLlmExtraBody`.

## 2. Tutor agent ("Shadow – Tutor")
Same steps, with these differences:
- **First message:** `Hi Lena, I'm your tutor. Work the invoice as you think is right. I'll jump in if Sabine would have done it differently.`
- **Voice:** warm and encouraging, different from the interviewer.
- **Language:** English.

## 3. Paste the agent ids
Open the Shadow console home page (`http://localhost:5173`), paste both agent ids, and pick the expert's language.

## How the voice loop works
1. Screen events go to Shadow Core over a WebSocket. Shadow predicts, finds gaps and plans questions.
2. At a natural pause (no typing, no speech, screen stable), Shadow emits `ask`.
3. The console calls `sendUserMessage("[[shadow:ask q7]]")`. ElevenLabs takes a turn and calls the Custom LLM, and Shadow returns the exact question text.
4. The expert answers. ElevenLabs transcribes it (Scribe) and calls the Custom LLM again. Shadow acknowledges briefly and compiles the answer into the Work Map in the background.
5. In the debrief, `[[shadow:debrief]]` starts the agenda. Each answer gets the next item: open questions → unseen-case probes → self-exam → teach-back.
6. In the tutor, a blocked save emits `intervene`. The console sends `[[shadow:intervene id]]`, and the tutor says *"Sabine would stop here. Why do you think?"*. The trainee's answer gets the explanation in Sabine's words, plus a replay of her screen moment.

Saying *"off the record"* pauses capture, and saying *"back on the record"* resumes it. The console button does the same.

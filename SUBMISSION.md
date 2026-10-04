# Submission: HackNation × ElevenLabs, The AI Apprentice

## Project name
Tacet

## Tagline (80 characters or fewer)
An apprentice that learns what the AI doesn't already know.

## Short description (300 characters or fewer)
Tacet predicts an expert's decision before they make it. When it can't explain what they did, it waits for a pause and asks one question by voice. The answer becomes a tested Work Map that teaches a new hire in the expert's own words and can be exported for agents.

## Long description
Recordings show what an expert clicked, not why. Tacet is an apprentice that learns the why.

While an expert works in a web app, Tacet's apprentice, Mira, writes down a prediction before every decision. Most of the time she is right and says nothing. When the expert does something she cannot explain, she waits for a natural pause and asks one short question about what is on screen: why this code, is there a limit, when would you stop and ask. A planner weighs the value of the answer against the cost of interrupting, so she asks few questions and the right ones.

The answer, spoken or typed, is compiled into rules, thresholds and guardrails that run as code. A language model only translates; the engine is plain Python with Bayesian belief over each threshold. A rule counts because its behavior holds on cases, not because a model said so. Every answer produces a learning receipt: the prediction before and after, the expert's quote, and the parameter that moved.

Tacet proves it learned. A sealed boundary test freezes predictions on fresh cases around a learned threshold, commits them with a SHA-256 hash before any label, and takes labels only from humans. Misses correct the map, and a restart from the saved map shows the learning persists. In a live run the threshold moved from 3,600 to 4,069 and the map went from 9/11 to 11/11.

The debrief asks about exceptions and unseen cases, runs a frozen self-exam, and ends with a teach-back the expert confirms. Then Mira becomes a tutor: a new hire books an invoice the expert never showed, and the tutor blocks the wrong save using the expert's words and replays the moment. A report card shows what they mastered.

Tacet is not tied to one workflow. On a Support desk it had never seen, "Learn this task" turned a goal and three demonstrations into a working task definition, asked its first question, and learned rules, verified live. The Work Map is also served over MCP so agents can look up guardrails, and exports as JSON, Markdown or an agent skill. Next: have an agent take the sealed test and earn permission rule by rule.

Honest scope: the accounts-payable workflow is the deepest; tutor blocking is enforced where the host app awaits the save hook; evaluation curves use a scripted expert and are labelled as such.

## How ElevenLabs is used
- **Two Conversational AI agents**, interviewer and tutor, both voiced as Mira on **Eleven v4 Turbo** with patient turn-taking and a 30-second timeout so the expert is never prompted for working silently.
- **Custom LLM**: both agents call our `/v1/chat/completions`. Tacet decides what is said and when; ElevenLabs does voice, turn-taking and transcription. Control tags (ask, debrief, intervene, say) become speech, and filler or idle turns return the `skip_turn` system tool so the agent stays quiet.
- **MCP**: the Work Map MCP server (`/mcp`: `list_steps`, `list_guardrails`, `check_decision`, `explain_rule`) is registered and attached to both agents so the tutor can look up guardrails.
- **In-page voice**: the ElevenLabs SDK runs inside Mira's companion in the observed app and in the console.
- **Film**: narration with ElevenLabs text to speech (v4), the music bed with ElevenLabs Music, and a German version voiced directly in Eleven v4.

## Tech stack
Python, FastAPI, numpy (engine, Bayesian thresholds, planner); SQLAlchemy with Postgres (Railway) or SQLite; Claude Sonnet 5.5 (compile, reasoning), Claude Haiku 4.5 (fast and spoken turns), GPT-6 Luna (vision); ElevenLabs Agents (Expressive mode, Scribe v2 Realtime), Custom LLM, MCP, TTS v4, Music, Speech to Text (checks), Dubbing (earlier cut); React, Vite and TypeScript (console); TanStack Start (ERP sandbox, built with Lovable); vanilla JS companion and observer; Chrome MV3 extension; Railway (us-west2).

## Links
- Product, landing and film: https://tacet.up.railway.app
- Console: https://tacet.up.railway.app/app
- Sealed test page: https://tacet.up.railway.app/app/s/<sid>/proof (a session id appears after a live session)
- Work Map MCP server: https://tacet.up.railway.app/mcp
- ERP sandbox: https://erp-production-e3b0.up.railway.app (Invoices, and `/support` for the learn-from-scratch path)
- Code: https://github.com/shubhamjoshipromail-svg/shadow (private; access on request)
- Demo video: https://tacet.up.railway.app/assets/film.mp4 (file in the repo: `site/assets/film.mp4`) — placeholder: replace with a screen-recorded walkthrough URL if one is made.

## Team
Shubham Joshi (solo).

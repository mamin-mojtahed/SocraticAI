# SocraticAI

A real-time, multi-user debate and dialogue platform that pairs people across differing or converging perspectives using Socratic warmup facilitation and semantic vector matchmaking.

**Live App:** [https://ais-pre-fs7ij7ua3eq3i7o6cnzs45-176451555110.us-west2.run.app](https://ais-pre-fs7ij7ua3eq3i7o6cnzs45-176451555110.us-west2.run.app)

---

## Quick Local Setup

### Prerequisites
- **Node.js** (v20+) or **Bun**
- A **Gemini API Key** (`GEMINI_API_KEY`)

### 1. Install Dependencies
```bash
npm install
# or
bun install
```

### 2. Configure Environment
Create a `.env` file in the project root:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Run the Development Server
```bash
npm run dev
```
The full-stack server (Express + Vite + WebSocket) starts at **[http://localhost:3000](http://localhost:3000)**.

---

## User Flow & Features

1. **Live Topic Stream & Custom Proposals**
   - Browse a continuously flowing stream of debate topics (seeded with evergreen philosophical questions and live social trends), or propose your own custom topic from the lobby.
   - Selecting the exact same topic as another waiting visitor pairs both users immediately into a live debate room.

2. **Waiting Lobby & Socratic Warmup Chat**
   - When waiting for a partner on a unique topic, users can unpack their thoughts in a private warmup chat.
   - **Natural Socratic Nudging:** The AI facilitator asks concise, conversational Socratic questions (one at a time) to help clarify core beliefs, values, and boundaries—implicitly steering toward shared themes in the lobby without coldly listing other topics or sounding clinical.
   - **Out-of-Turn Messaging & AI Toggle Switch:** Users can send multiple thoughts out of turn without waiting for the AI to finish typing, or flip the **sliding toggle switch** (`AI On / AI Off`) at any time to jot down arguments silently without AI replies.

3. **Smart Bridge Match Suggestions**
   - As soon as at least one other waiting user's unpacked stance or underlying values align above the similarity threshold, both users receive a live **Match Found** prompt featuring a synthesized bridge question.
   - Once both sides accept, they transition into a synchronized 1-on-1 debate room.

4. **Live Debate Room & Archive**
   - Real-time visitor-to-visitor messaging with typing indicators, voice dictation support, and markdown rendering.
   - Completed debates are saved to the **Archive** for later inspection.

5. **Multi-Visitor Split Screen & Match Graph**
   - **Split-Screen Simulation:** Spawn up to 4 independent visitor panes in a single browser window to test multi-user matchmaking side-by-side.
   - **Match Graph Visualizer:** Inspect live pairwise similarity scores, adjust the match threshold dynamically, view pairwise score history over time, and inspect the hidden diagnostic stances driving each match.

---

## What Happens in the Backend

The backend (`server.ts` + `services/aiMatchmaker.ts`) runs an authoritative WebSocket server (`ws` mounted on Express) that manages visitor presence, lobby queues, warmup sessions, and live rooms:

- **Conversational Chat vs. Hidden Diagnostic Intake (`gemini-3.1-flash-lite`)**
  - When a user sends a message in the warmup lobby, the backend immediately appends it to their profile and evaluates matches without blocking on AI generation.
  - If AI responses are enabled, `gemini-3.1-flash-lite` returns a structured JSON payload separating the **user-facing conversational reply** from the **backend-only diagnostic profile** (`evolvedStance` and `commonGround`), which synthesizes the user's core claim, ethical/practical axioms, and trade-offs.

- **Semantic Embedding Matchmaking (`gemini-embedding-2-preview` / `gemini-embedding-001`)**
  - Each waiting participant's topic and unpacked diagnostic stance are embedded into high-dimensional vectors (with automatic model fallback and in-memory caching).
  - Pairwise cosine similarity is computed across all waiting pairs and passed through a **calibrated non-linear normalization curve** so unrelated topics remain low (`< 35%`) while genuinely related stances or shared underlying axioms scale cleanly above the match threshold (`default 65%`).
  - Whenever two participants cross the active threshold, `gemini-3.1-flash-lite` synthesizes a neutral **Bridge Topic** that frames their shared tension for a productive debate.

- **Real-Time State & Trend Ingestion (`services/socialTrendsService.ts`)**
  - Periodically fetches and synthesizes timely debate topics from public feeds (Reddit, Hacker News, Wikipedia) using `gemini-3.1-flash-lite` and streams them to connected clients over WebSockets.

---

## Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Express + Vite + WebSocket server on port `3000` |
| `npm run build` | Builds the frontend production bundle via Vite |
| `npm start` | Runs the full-stack server (`tsx server.ts`) |
| `npm run lint` | Runs TypeScript type-checking (`tsc --noEmit`) |

# 🚀 ApplyFlow

**Agentic Job Application Assistant** — navigate modern ATS platforms (Greenhouse, Lever), evaluate job fit against your resume, draft tailored answers, and pre-fill application forms for human review.

```
[ Job URL + Resume ]
        │
        ▼
 1. EVALUATE ───► AI rates job fit (e.g., 8/10)
        │
        ▼
 2. EXPLORE ───► Agent crawls form DOM (semantic locators)
        │
        ▼
 3. DRAFT ─────► Generates custom EEO & cover letter answers
        │
        ▼
 4. PRE-FILL ──► Automates filling fields on live browser
        │
        ▼
 5. HUMAN-IN-THE-LOOP ──► Stops at "Submit" for human review
```

## ✨ Features

- **AI Job-Fit Scoring** — Gemini evaluates how well your resume matches a job posting (1–10 scale), flagging gaps honestly.
- **Semantic Form Exploration** — Discovers form fields by their *labels* (not brittle CSS classes), so it survives ATS updates.
- **Custom Answer Drafting** — Generates tailored responses to "Why do you want to work here?" and other custom questions, grounded in your actual resume and the job's keywords.
- **Live Browser Automation via webcmd** — A visible Chrome window (managed by the [webcmd](https://github.com/agentrhq/webcmd) daemon) fills the form in real time. Every browser operation runs as a sandboxed QuickJS program — session-persistent, profile-based cookies, archive-able, and restartable.
- **Human-in-the-Loop Safe-Stop** — The agent pauses right above the **Submit** button. You own the submission. No fake data, no compliance risk.
- **SQLite Tracking** — Every application's URL, score, drafted answers, and status stored for later review.

## 🛠️ Tech Stack

| Layer | Choice |
|---|---|
| Language | TypeScript / Node.js |
| Browser engine | **[webcmd](https://github.com/agentrhq/webcmd)** (daemon + QuickJS sandbox, Playwright under the hood) |
| LLM | Gemini (`@google/generative-ai`) |
| Storage | better-sqlite3 |
| HTML parsing | Cheerio |

## 📦 Installation

```bash
npm install

# Build the vendored webcmd CLI (installs deps + compiles dist/):
npm run webcmd:setup

# Verify webcmd daemon + browser are ready:
npm run webcmd:doctor
```

That's it — no separate Playwright install. webcmd manages its own browser and daemon.

## 🔑 Setup

1. Copy `.env.example` to `.env`
2. Add your Gemini API key:

```bash
cp .env.example .env
# Edit .env — set GEMINI_API_KEY=your_key_here
```

3. (Optional) Replace `data/resumes/placeholder.txt` with your own resume.
4. (Optional) Point `WEBCMD_PATH` at another webcmd install, or change `WEBCMD_PROFILE`.

## 🚀 Usage

### Apply to a job

```bash
npm run apply -- https://boards.greenhouse.io/company/jobs/12345
# or with a custom resume:
npm run apply -- https://jobs.lever.co/company/abc123 ./my-resume.txt
```

The tool will:
1. Fetch and parse the job posting
2. Score your resume against it with Gemini
3. Start the webcmd daemon, create an `applyflow` profile, and open a Chrome session on the application form
4. Map every form field using semantic locators
5. Draft answers for custom questions
6. Pre-fill the form with your resume data + drafted answers (each fill runs as a QuickJS program)
7. **Stop before Submit** so you can review and click Submit yourself — the session stays open until you're done

### View history

```bash
npm run history
```

## 🧠 How the Browser Layer Works (webcmd integration)

Playwright is no longer driven directly from ApplyFlow's Node process. Instead:

1. **Daemon** — `webcmd doctor` bootstraps a local daemon (WebSocket) that owns browser contexts.
2. **Profile** — ApplyFlow uses a persistent `applyflow` profile (cookie jar + auth scope).
3. **Session** — Each apply run creates a readable session (e.g. `applyflow-2026-09-11-14-30`).
4. **Programs** — Every browser operation (navigate, analyze form, fill field, upload resume, scroll) is emitted as a JavaScript source string and executed inside webcmd's **QuickJS sandbox**, where only `page`, `context`, `browser`, and `console` are available. Programs return structured JSON.
5. **No `Page` leaks** — ApplyFlow never imports Playwright types. The `WebcmdSession` class is the single browser abstraction.

### Why this survives ATS updates

Traditional automation uses brittle selectors like `.field-class-v2`. ApplyFlow instead:

1. **Explores once** — a sandboxed program reads every input's *associated label* (`<label for="...">`, `<label>` wrapper, `aria-label`, placeholder) to understand what the field means.
2. **Maps semantically** — stores fields as `{ label: "GitHub URL", type: "url" }`, not as CSS classes.
3. **Fills robustly** — the fill program tries `getByLabel()` → `getByPlaceholder()` → `getByRole()` → CSS selector → label-wrapper, with per-type strategies for selects and radios.

Because Greenhouse and Lever use consistent, human-readable labels ("First Name", "Email", "LinkedIn URL"), this approach is dramatically more reliable on live demos.

## 🚨 Compliance Rules

- **Rule 1 — Live Demo**: Browser runs non-headless so judges watch fields fill in real time.
- **Rule 2 — Responsible Build**: The agent **never clicks Submit**. It scrolls to just above the button and stops, printing a Safe-Stop banner. The human retains full ownership of data transmission.

## 📁 Project Structure

```
src/
  index.ts                 # CLI orchestration (apply / history / help)
  config.ts                # .env config & ATS selector defaults
  types/index.ts           # Shared TypeScript types
  evaluator/
    job-scraper.ts         # Fetch + parse job posting (Greenhouse/Lever/generic)
    resume-parser.ts       # Parse plain-text resume into structured data
    scorer.ts              # Gemini job-fit scoring (1-10)
  explorer/
    form-analyzer.ts       # Run sandboxed DOM-crawl program → semantic field map
  drafter/
    answer-generator.ts    # Gemini drafts answers for custom questions
  filler/
    webcmd-cli.ts          # Thin subprocess wrapper around the webcmd binary
    webcmd-programs.ts     # QuickJS program builders (analyze/fill/upload/scroll)
    webcmd-session.ts      # Session lifecycle — replaces browser.ts
    form-filler.ts         # Fill fields via sandboxed programs, upload resume
  tracker/
    database.ts            # SQLite schema + CRUD
webcmd/                    # Vendored agentrhq/webcmd (built via npm run webcmd:setup)
data/
  resumes/placeholder.txt  # Sample resume (swap with your own)
  applyflow.db             # Created at runtime
```

## 🗺️ Roadmap

- [x] webcmd integration (agentrhq/webcmd — daemon-managed browser, QuickJS programs, session persistence, profile cookies)
- [ ] PDF resume parsing (PDF.js extraction pipeline)
- [ ] Workday multi-step form wizard support
- [ ] Interactive mode with inquirer prompts
- [ ] "Apply to N recent matching jobs" batch mode
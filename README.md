# 12th Grade Tutor: Kavi, a CS tutor

A voice- and whiteboard-based AI tutor for **Class 12 Computer Science (Tamil Nadu State Board)**, in **English, Tamil, or Tamil + English**.

- **Teaches one page at a time.** A talking avatar explains the textbook page while points, key terms, code and diagrams are written on a whiteboard. After each page it asks a quick check question. The student can interrupt at any time with a doubt, by voice or by typing.
- **Chapter quiz.** When the chapter is finished, it builds a quiz (MCQ, short answer, predict the output) covering every important concept.
- **Re-teaches mistakes.** For every concept answered wrongly, the tutor explains it again in a new way, then gives 2 fresh practice questions. If the student still gets it wrong, it explains it once more, differently (up to 3 tries), before marking the concept for revision.
- **Progress.** Records pages studied, quiz scores and the status of each concept (mastered / needs practice).

## Run it

Requirements: Node.js 20+, Chrome or Edge (for voice).

```bash
npm install
```

```bash
cp .env.example .env
```

Put your Anthropic API key in `.env`, then:

```bash
npm start
```

Open http://localhost:3000.

To try the screens without an API key, run `npm run demo`. Demo mode uses canned responses, not AI.

## Load your textbook

The app ships with a short **sample** chapter ("Function") written for testing. To teach from the real textbook:

1. Find where each chapter starts:
   ```bash
   npm run ingest -- path/to/textbook.pdf
   ```
   This writes `content/pdf-pages.txt`, listing the first lines of every PDF page.
2. Copy `content/book.config.example.json` to `content/book.config.json` and fill in each chapter's title (English and Tamil) and its first and last PDF page.
3. Run `npm run ingest -- path/to/textbook.pdf` again. Chapters are written to `content/chapters/`, and they replace the sample.
4. Restart with `npm start`.

Lessons are cached in `data/cache/`, so each page is generated only once per language.

## How it works

| Part | Where |
|---|---|
| Lessons, answers to doubts, quizzes, grading, re-teaching (Claude API, structured JSON output) | `server/tutor.js`, `server/schemas.js` |
| HTTP API and quiz grading (MCQs checked locally, written answers graded by Claude) | `server/index.js` |
| Progress and lesson cache (JSON files in `data/`) | `server/store.js` |
| Avatar, whiteboard, quiz screens, teach → quiz → re-teach loop | `public/app.js` |
| Voice in and out (the browser's built-in Web Speech API, free) | `public/speech.js` |
| PDF import | `scripts/ingest-pdf.js` |

**Voice notes:** Tamil speech output needs a Tamil voice on the device. Microsoft Edge on Windows and Chrome on Android have one; desktop Chrome often doesn't, and then the Tamil text still shows on screen. Voice commands: "next page" / "அடுத்த பக்கம்", "repeat" / "மீண்டும்"; in quizzes, say "A", "B", "C" or "D".

The model defaults to `claude-opus-5-5`; set `TUTOR_MODEL` to change it.

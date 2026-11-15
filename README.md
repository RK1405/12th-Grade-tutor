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

Put your Anthropic API key in `.env` (one line: `ANTHROPIC_API_KEY=...`, no quotes). Check that it works with `npm run check-key`, which also tells you if your key must be set as `ANTHROPIC_AUTH_TOKEN` instead. Then:

```bash
npm start
```

Open http://localhost:3000.

To try the screens without an API key, run `npm run demo`. Demo mode uses canned responses, not AI.

## Load your textbook

The Tamil-medium textbook (360 pages, in 4 parts) is in `content/textbook/`, and `content/book.config.json` already maps its 16 chapters to their pages. Until the import has been run, the app teaches a short sample chapter.

Run the import once (it needs your API key in `.env`):

```bash
npm run ingest
```

The PDF's built-in Tamil text is garbled (old font encoding), so the import has Claude **read each page as an image** and write clean Tamil text, keeping code and English terms unchanged and describing figures. It reads about 330 pages, takes roughly 15–30 minutes, and costs roughly US$10–15 once. Each page is saved to `content/transcripts/` as soon as it's read, so if it stops, run the same command again and it continues from where it stopped. Commit `content/transcripts/` and `content/chapters/` afterwards so you never need to repeat the import.

- Test one chapter first: `npm run ingest -- --only ch01`
- Use a cheaper model for the import: `TUTOR_INGEST_MODEL=claude-sonnet-5-5 npm run ingest`
- For an English PDF with a clean text layer (no API cost): `npm run ingest -- --text`

The textbook's exercise pages are kept separately, and the tutor uses them as a guide when writing quiz questions. Lessons are cached in `data/cache/`, so each page is generated only once per language.

## How it works

| Part | Where |
|---|---|
| Lessons, answers to doubts, quizzes, grading, re-teaching (Claude API, structured JSON output) | `server/tutor.js`, `server/schemas.js` |
| HTTP API and quiz grading (MCQs checked locally, written answers graded by Claude) | `server/index.js` |
| Progress and lesson cache (JSON files in `data/`) | `server/store.js` |
| Avatar, whiteboard, quiz screens, teach → quiz → re-teach loop | `public/app.js` |
| Voice in and out (the browser's built-in Web Speech API, free) | `public/speech.js` |
| Textbook import (Claude reads each page) | `scripts/ingest-pdf.js`, `content/book.config.json` |

**Voice notes:** Tamil speech output needs a Tamil voice on the device. Microsoft Edge on Windows and Chrome on Android have one; desktop Chrome often doesn't, and then the Tamil text still shows on screen. Voice commands: "next page" / "அடுத்த பக்கம்", "repeat" / "மீண்டும்"; in quizzes, say "A", "B", "C" or "D".

The model defaults to `claude-opus-5-5`; set `TUTOR_MODEL` to change it.

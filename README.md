# 12th Grade Tutor: Guru, an offline CS tutor

A Windows app that tutors **Class 12 Computer Science (Tamil Nadu State Board)** in **English, Tamil, or Tamil + English**. It is fully **offline**: no internet, no AI and no API key while the student uses it.

- **Teaching:** Guru, a talking robot, teaches one textbook page at a time on a whiteboard (points, key terms, code, diagrams), then asks a quick check question. A wrong answer gets the correct answer and a simpler re-explanation. The **Explain again** and **Example** buttons are available on every page.
- **Chapter quiz:** after each chapter there is a quiz (multiple choice, short answer, predict the output). Questions are picked from a question bank, so every attempt is different and covers every concept.
- **Re-teaching mistakes:** for each concept answered wrongly, Guru re-teaches it and gives 2 practice questions. If the student is still wrong, a second explanation, then a third, each done differently, before the concept is marked for revision.
- **Progress:** pages studied, quiz scores and the status of each concept, saved on the computer.

## Use the app (student)

Run `Guru-CS-Tutor-<version>.exe`. There's nothing to install and no internet is needed.

- **Voice:** Guru speaks with the voices installed in Windows. For Tamil speech, add the Tamil voice once: *Settings → Time & language → Speech → Add voices → Tamil*. If no Tamil voice is installed, the Tamil text still shows on screen.
- **Answering:** type your answer. To speak instead, press **Windows key + H** (Windows voice typing) while the answer box is selected.

## Build the content (once, needs the API key)

The app teaches from content generated **once** from the textbook by Claude. After that it never needs the API again. Until this is done, the app shows a hand-written **sample chapter**.

Requirements: Node.js 22+, and an Anthropic API key from console.anthropic.com with some credit.

1. Install the tools:
   ```bash
   npm install
   ```
2. Create a file named `.env` containing one line, `ANTHROPIC_API_KEY=sk-ant-api03-...`, then test the key:
   ```bash
   npm run check-key
   ```
3. Read the textbook PDFs (in `content/textbook/`). Claude reads each page image because the PDF's Tamil text layer is garbled. Test with one chapter first, then run it for the whole book:
   ```bash
   npm run ingest -- --only ch01
   ```
   ```bash
   npm run ingest
   ```
4. Generate the lessons, question banks and re-teaching material. Test with one chapter first:
   ```bash
   npm run build-content -- --only ch01
   ```
   ```bash
   npm run build-content
   ```
   - Choose languages: `--langs ta,en` (the default is `en,ta,mix`).
   - Use a cheaper model: `TUTOR_MODEL=claude-haiku-5-5 npm run build-content`. Compare the quality on one chapter first.
   - Both steps save every piece as soon as it's made. If a run stops, run the same command again and it continues.
5. Try it with `npm start`, then build the Windows app (it's written to `dist/`):
   ```bash
   npm run dist
   ```

Commit `content/transcripts/`, `content/chapters/`, `content/generated/` and `public/content/` so the generation never has to be repeated. Future versions only need `npm run dist`.

## Project layout

| Folder | What it holds |
|---|---|
| `app/main.cjs` | Electron window (the desktop app) |
| `public/` | The app: robot, whiteboard, quiz, re-teach loop (`app.js`), offline engine (`engine.js`), voice (`speech.js`) and the generated content (`content/`) |
| `generator/` | Prompts and schemas used once to generate content with Claude |
| `scripts/` | `ingest-pdf.js` (textbook → text), `build-content.js` (text → lessons), `check-key.js` |
| `content/` | Textbook PDFs, chapter map (`book.config.json`), sample chapter, generated files |

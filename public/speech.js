// Voice in/out using the browser's built-in Web Speech API (free, no key).
// Best in Chrome or Edge. Tamil voices depend on the device: Edge (Windows) and
// Chrome on Android usually have one; otherwise the English voice is used.

const synth = window.speechSynthesis;
let voices = [];
const loadVoices = () => (voices = synth ? synth.getVoices() : []);
if (synth) {
  loadVoices();
  synth.onvoiceschanged = loadVoices;
}

function pickVoice(lang) {
  const want = lang === "en" ? ["en-IN", "en-GB", "en-US", "en"] : ["ta-IN", "ta", "en-IN", "en"];
  for (const code of want) {
    const matches = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(code.toLowerCase()));
    if (matches.length) return matches.find((v) => /natural|online|google/i.test(v.name)) || matches[0];
  }
  return null;
}
// Voices load asynchronously in Chrome/Edge: wait (briefly) until the list is available.
export function voicesReady(ms = 2500) {
  if (!synth) return Promise.resolve([]);
  loadVoices();
  if (voices.length) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(loadVoices()), ms);
    synth.addEventListener?.("voiceschanged", () => {
      clearTimeout(t);
      resolve(loadVoices());
    }, { once: true });
  });
}

// The voice Guru will use for a language, or null if the device has none for it.
export function voiceFor(lang) {
  const v = pickVoice(lang);
  if (!v) return null;
  if (lang !== "en" && !v.lang.toLowerCase().startsWith("ta")) return null; // never read Tamil with an English voice
  return v;
}

export function hasTamilVoice() {
  return !!voices.find((v) => v.lang.toLowerCase().startsWith("ta"));
}

let speakToken = 0;

// Speak text; resolves when finished or stopped. onBoundary drives the avatar's mouth.
export function speak(text, lang, { onStart, onBoundary, onEnd } = {}) {
  return new Promise((resolve) => {
    if (!synth || !text) return resolve();
    const token = ++speakToken;
    // Chrome stops long utterances after ~15 s, so speak sentence by sentence.
    const parts = text.match(/[^.!?।\n]+[.!?।]?/g)?.map((s) => s.trim()).filter(Boolean) || [text];
    const voice = pickVoice(lang);
    let i = 0;
    onStart?.();
    const next = () => {
      if (token !== speakToken || i >= parts.length) {
        onEnd?.();
        return resolve();
      }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      u.lang = voice ? voice.lang : lang === "en" ? "en-IN" : "ta-IN";
      try {
        if (voice) u.voice = voice;
      } catch {} // keep going with the language's default voice
      u.rate = 0.95;
      // Safety net: if no voice is installed, onend may never fire; move on after a reading-time delay.
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        next();
      };
      const timer = setTimeout(done, 3000 + u.text.length * 120);
      u.onboundary = () => onBoundary?.();
      u.onend = done;
      u.onerror = done;
      try {
        synth.speak(u);
      } catch {
        done(); // never let a speech error stop the lesson
      }
    };
    next();
  });
}

export function stopSpeaking() {
  speakToken++;
  synth?.cancel();
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
// Electron exposes the API but it cannot work there (it needs Google's online service), so treat it as unavailable.
export const canListen = !!Recognition && !/Electron/.test(navigator.userAgent);
let rec = null;

// Listen once; resolves with the transcript ("" if nothing was heard).
export function listen(lang, { onInterim } = {}) {
  return new Promise((resolve, reject) => {
    if (!Recognition) return reject(new Error("Speech recognition is not supported in this browser. Use Chrome or Edge, or type instead."));
    stopListening();
    rec = new Recognition();
    rec.lang = lang === "en" ? "en-IN" : "ta-IN";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      onInterim?.(finalText + interim);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") resolve(finalText.trim());
      else reject(new Error("Microphone error: " + e.error));
    };
    rec.onend = () => resolve(finalText.trim());
    rec.start();
  });
}

export function stopListening() {
  try {
    rec?.stop();
  } catch {}
  rec = null;
}

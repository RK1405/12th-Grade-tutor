// npm run check-key
// Tests the key in .env against the Claude API and says which setting to use.
// Prints only the first characters of the key, never the whole key.
import Anthropic from "@anthropic-ai/sdk";

const key = (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "").trim();
const model = process.env.TUTOR_MODEL || "claude-opus-5-5";

if (!key) {
  console.log("No key found. Put this line in .env (one line, no quotes):\n  ANTHROPIC_API_KEY=your-key");
  process.exit(1);
}
console.log(`Key found: ${key.slice(0, 12)}... (${key.length} characters; the rest is hidden)`);
if (/^["']|["']$|\s/.test(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "")) {
  console.log("Warning: the key has quotes or spaces around it in .env. Remove them.");
}

async function attempt(label, options) {
  try {
    const client = new Anthropic({ apiKey: null, authToken: null, ...options });
    const r = await client.beta.messages.create({ model, max_tokens: 20, betas: options.authToken ? ["oauth-2025-04-20"] : [], messages: [{ role: "user", content: "Say OK" }] });
    console.log(`  ${label}: WORKS (model ${r.model})`);
    return true;
  } catch (err) {
    console.log(`  ${label}: failed - ${err.status || ""} ${err.error?.error?.message || err.message}`);
    return false;
  }
}

console.log("Testing...");
if (await attempt("as ANTHROPIC_API_KEY", { apiKey: key })) {
  console.log("\nAll good. Keep this line in .env:\n  ANTHROPIC_API_KEY=" + key.slice(0, 12) + "...");
} else if (await attempt("as ANTHROPIC_AUTH_TOKEN", { authToken: key })) {
  console.log("\nThis key works as a token. In .env, change the line to:\n  ANTHROPIC_AUTH_TOKEN=" + key.slice(0, 12) + "...\n(remove the ANTHROPIC_API_KEY line), then run npm start.");
} else {
  console.log(
    "\nThis key does not work with the Claude API.\n" +
      "Create an API key at https://console.anthropic.com -> API Keys (it starts with sk-ant-api03-),\n" +
      "make sure the account has credit (Plans & Billing), and put it in .env as ANTHROPIC_API_KEY=..."
  );
  process.exit(1);
}

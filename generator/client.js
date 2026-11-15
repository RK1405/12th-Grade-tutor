// One place that decides how to authenticate with the Claude API.
// ANTHROPIC_API_KEY (sk-ant-api03-...) is the normal case; ANTHROPIC_AUTH_TOKEN
// is sent as a Bearer token and needs the OAuth beta flag.
import Anthropic from "@anthropic-ai/sdk";

export const usingToken = !process.env.ANTHROPIC_API_KEY && !!process.env.ANTHROPIC_AUTH_TOKEN;
export const client = new Anthropic();
export const BETAS = ["server-side-fallback-2026-07-01", ...(usingToken ? ["oauth-2025-04-20"] : [])];
export { Anthropic };

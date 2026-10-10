#!/usr/bin/env node
// Mock Unjailed AI API for local development and testing. No dependencies.
//
//   npm run mock                 # listens on http://localhost:8787/v1
//   PORT=9000 npm run mock
//
// Valid API key: sk-mock-test-a1b2 (or set MOCK_KEY). Anything else gets a 401.
//
// Trigger special behaviour by including a word in your chat message:
//   "ratelimit"  → 429        "servererror" → 500        "credit" → 402
//   "slow"       → slow stream (lets you test Ctrl+C)     "hang" → never responds
//   "reason"     → streams reasoning_content before the answer
//   "markdown"   → a long markdown sample with code blocks
//   "longcode"   → an 80-line code block (tests the live-area height cap)
//   "debug"      → reports the reasoning_effort and system prompt it received

import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const KEY = process.env.MOCK_KEY || "sk-mock-test-a1b2";
const MODELS = ["glm-5.3-uncensored", "glm-5.3", "deepseek-v4-pro-uncensored", "kimi-k3", "mimo-v2.6-pro"];

const MARKDOWN = `Here's a quick tour of what I can render:

**Bold text**, *italics*, and \`inline code\` all work.

1. First numbered item
2. Second item with **emphasis**
   - nested bullet
   - another one

\`\`\`ts
// TypeScript with syntax highlighting
interface User {
  id: number;
  name: string;
}

export function greet(user: User): string {
  return \`Hello, \${user.name}!\`;
}
\`\`\`

\`\`\`python
def fib(n: int) -> int:
    return n if n < 2 else fib(n - 1) + fib(n - 2)
\`\`\`

> Quotes render dimmed.

That's it — ask me anything.`;

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const apiError = (res, status, message, code, headers) => json(res, status, { error: { message, type: "invalid_request_error", code } }, headers);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authed(req, res) {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${KEY}`) {
    apiError(res, 401, "Invalid API key. Get yours at https://unjailedai.com/dashboard/api", "invalid_api_key");
    return false;
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve(null);
      }
    });
  });
}

// Split text into small chunks that look like tokens.
const tokens = (text) => text.match(/\s*\S+|\s+/g) ?? [];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const log = (msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${url.pathname} ${msg}`);

  if (req.method === "GET" && url.pathname === "/v1/models") {
    if (!authed(req, res)) return log("401");
    log("200");
    return json(res, 200, { object: "list", data: MODELS.map((id) => ({ id, object: "model", created: 1735689600, owned_by: "unjailed" })) });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    if (!authed(req, res)) return log("401");
    const body = await readBody(req);
    if (!body || !Array.isArray(body.messages)) return apiError(res, 400, "messages array is required");
    if (!MODELS.includes(body.model)) return apiError(res, 404, `The model '${body.model}' does not exist.`, "model_not_found");

    const last = String(body.messages.at(-1)?.content ?? "");
    const lower = last.toLowerCase();
    log(`model=${body.model} turns=${body.messages.length} "${last.slice(0, 40)}"`);

    if (lower.includes("ratelimit")) return apiError(res, 429, "Rate limit: 30 requests/minute on your tier. Retry in 12s.", "rate_limit", { "retry-after": "12" });
    if (lower.includes("servererror")) return apiError(res, 500, "upstream exploded");
    if (lower.includes("credit")) return apiError(res, 402, "Insufficient credit. Top up at https://unjailedai.com/dashboard.", "insufficient_credit");
    if (lower.includes("hang")) return; // never respond: exercises the client timeout / Ctrl+C

    const userTurns = body.messages.filter((m) => m.role === "user").length;
    let answer;
    if (lower.includes("markdown")) answer = MARKDOWN;
    else if (lower.includes("debug")) {
      const system = body.messages.find((m) => m.role === "system")?.content ?? "";
      const skills = [...system.matchAll(/<skill name="([^"]+)">/g)].map((m) => m[1]);
      answer = `effort: **${body.reasoning_effort ?? "(not sent)"}** · skills: **${skills.join(", ") || "(none)"}**`;
    } else if (lower.includes("history")) answer = `You've sent **${userTurns}** messages in this conversation. The first was: "${body.messages.find((m) => m.role === "user")?.content}"`;
    else answer = `You said: "${last}". I'm the **mock** server running \`${body.model}\` — this is turn ${userTurns}.`;
    if (lower.includes("longcode")) answer = "Here's a long file:\n\n```js\n" + Array.from({ length: 80 }, (_, i) => `console.log("line ${i + 1}");`).join("\n") + "\n```\n\nDone.";
    if (lower.includes("slow")) answer = Array.from({ length: 60 }, (_, i) => `Slow token ${i + 1}.`).join(" ");

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    let closed = false;
    res.on("close", () => (closed = true));
    const send = (delta, finish = null) =>
      res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);

    await sleep(400); // time-to-first-token so the spinner is visible
    if (lower.includes("reason")) {
      for (const t of tokens("Let me think about this carefully before answering.")) {
        if (closed) return log("client closed");
        send({ reasoning_content: t });
        await sleep(60);
      }
    }
    const delay = lower.includes("slow") ? 250 : lower.includes("longcode") ? 8 : 15;
    for (const t of tokens(answer)) {
      if (closed) return log("client closed (stopped)");
      send({ content: t });
      await sleep(delay);
    }
    send({}, "stop");
    if (lower.includes("usage")) {
      // OpenAI sends usage as a final choices-less chunk when stream_options.include_usage is set.
      res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", model: body.model, choices: [], usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 } })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  apiError(res, 404, `No route for ${req.method} ${url.pathname}`);
});

server.listen(PORT, () => {
  console.log(`Mock Unjailed API on http://localhost:${PORT}/v1`);
  console.log(`API key: ${KEY}`);
  console.log(`Run the CLI against it:  UNJAILED_BASE_URL=http://localhost:${PORT}/v1 unjailed`);
});

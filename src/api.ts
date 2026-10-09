import { REQUEST_TIMEOUT_MS, STREAM_IDLE_TIMEOUT_MS } from "./constants.js";

export type Role = "system" | "user" | "assistant";
export interface ChatMessage {
  role: Role;
  content: string;
}

/** An error whose message is safe and friendly to show the user as-is. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortedError";
  }
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

async function serverMessage(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    const json = JSON.parse(text);
    const msg = json?.error?.message ?? json?.message ?? json?.error;
    return typeof msg === "string" ? msg : undefined;
  } catch {
    return undefined;
  }
}

async function httpError(res: Response): Promise<ApiError> {
  const msg = await serverMessage(res);
  switch (res.status) {
    case 401:
    case 403:
      return new ApiError("Invalid or revoked API key. Type /login to enter a new one.", res.status);
    case 402:
      return new ApiError(msg ?? "Out of credit. Top up at unjailedai.com/dashboard.", res.status);
    case 404:
      return new ApiError(msg ?? "Not found. Check the model (/model) and base URL (/api).", res.status);
    case 429: {
      const retry = res.headers.get("retry-after");
      const hint = retry ? ` Try again in ${retry}s.` : " Wait a moment and try again.";
      if (msg && /rate/i.test(msg)) return new ApiError(msg, res.status);
      return new ApiError(`Rate limited.${msg ? " " + msg : hint}`, res.status);
    }
    default:
      if (res.status >= 500) return new ApiError(`The server had a problem (HTTP ${res.status}). Try again shortly.`, res.status);
      return new ApiError(msg ? `Request failed: ${msg}` : `Request failed (HTTP ${res.status}).`, res.status);
  }
}

function networkError(err: unknown, baseUrl: string, timedOut: boolean): Error {
  if (timedOut) return new ApiError(`Timed out waiting for ${hostOf(baseUrl)}. Try again.`);
  if (err instanceof ApiError || err instanceof AbortedError) return err;
  const e = err as { name?: string; cause?: { code?: string; errors?: { code?: string }[] } };
  if (e?.name === "AbortError") return new AbortedError();
  const code = e?.cause?.code ?? e?.cause?.errors?.find((x) => x?.code)?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new ApiError(`Can't reach ${hostOf(baseUrl)} — check your internet connection.`);
  if (code === "ECONNREFUSED") return new ApiError(`Connection refused by ${hostOf(baseUrl)}. Is the base URL right? (/api)`);
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return new ApiError("The connection dropped. Try again.");
  if (code && code.startsWith("CERT") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return new ApiError(`TLS certificate problem talking to ${hostOf(baseUrl)}.`);
  return new ApiError(`Network error talking to ${hostOf(baseUrl)}. Check your connection.`);
}

/** fetch with a header timeout, linked to an optional outer abort signal. */
async function request(baseUrl: string, path: string, init: RequestInit & { key: string; signal?: AbortSignal }): Promise<{ res: Response; controller: AbortController }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const res = await fetch(baseUrl + path, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${init.key}`,
        "Content-Type": "application/json",
        Accept: path.includes("chat") ? "text/event-stream" : "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    return { res, controller };
  } catch (err) {
    if (init.signal?.aborted) throw new AbortedError();
    throw networkError(err, baseUrl, timedOut);
  } finally {
    clearTimeout(timer);
  }
}

export interface ModelInfo {
  id: string;
}

export async function listModels(baseUrl: string, key: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const { res } = await request(baseUrl, "/models", { method: "GET", key, signal });
  if (!res.ok) throw await httpError(res);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError("The server sent an unexpected response to /models. Check the base URL (/api).");
  }
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new ApiError("The server sent an unexpected response to /models. Check the base URL (/api).");
  return data.filter((m) => m && typeof m.id === "string").map((m) => ({ id: m.id as string }));
}

export interface StreamHandlers {
  onToken: (text: string) => void;
  onReasoning?: (text: string) => void;
}

/** A function call the model wants made. Arguments stream in as fragments. */
export interface ToolCallAccum {
  index: number;
  id?: string;
  name?: string;
  args: string;
}

export interface AgentStreamResult {
  toolCalls: Array<{ id: string; name: string; args: string }>;
}

/**
 * POST /chat/completions with stream:true and feed tokens to the handlers.
 * Rejects with AbortedError if `signal` fires, ApiError for anything user-facing.
 * When options.tools is set, accumulates streamed tool_calls and returns them.
 */
export async function streamChat(
  baseUrl: string,
  key: string,
  model: string,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  signal: AbortSignal,
  options: { effort?: string; tools?: unknown[]; toolChoice?: unknown } = {},
): Promise<AgentStreamResult | undefined> {
  const { res, controller } = await request(baseUrl, "/chat/completions", {
    method: "POST",
    key,
    signal,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...(options.tools && options.tools.length ? { tools: options.tools } : {}),
      ...(options.toolChoice !== undefined ? { tool_choice: options.toolChoice } : {}),
      ...(options.effort && options.effort !== "auto" ? { reasoning_effort: options.effort } : {}),
    }),
  });
  if (!res.ok) throw await httpError(res);
  if (!res.body) throw new ApiError("The server returned an empty response.");

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("event-stream")) {
    // Some servers ignore stream:true; accept a plain JSON completion too.
    try {
      const json = (await res.json()) as {
        choices?: { message?: { content?: string; tool_calls?: Array<{ id?: string; index?: number; function?: { name?: string; arguments?: string } }> } }[];
      };
      const msg = json.choices?.[0]?.message;
      if (msg?.tool_calls?.length) {
        const accum = new Map<number, ToolCallAccum>();
        msg.tool_calls.forEach((tc, i) => {
          accum.set(tc.index ?? i, { index: tc.index ?? i, id: tc.id, name: tc.function?.name, args: tc.function?.arguments ?? "{}" });
        });
        return finishTools(accum);
      }
      const text = msg?.content;
      if (typeof text === "string") { handlers.onToken(text); return undefined; }
    } catch {
      /* fall through */
    }
    throw new ApiError("The server sent an unexpected response. Check the base URL (/api).");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let idleTimedOut = false;
  let idle: NodeJS.Timeout | undefined;
  const toolAccum = new Map<number, ToolCallAccum>();
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      idleTimedOut = true;
      controller.abort();
    }, STREAM_IDLE_TIMEOUT_MS);
  };

  try {
    armIdle();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") return finishTools(toolAccum);
        let evt: any;
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        if (evt?.error) {
          const m = typeof evt.error === "string" ? evt.error : evt.error.message;
          throw new ApiError(m ? `The server reported an error: ${m}` : "The server reported an error mid-response.");
        }
        const delta = evt?.choices?.[0]?.delta ?? {};
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoning === "string" && reasoning) handlers.onReasoning?.(reasoning);
        if (typeof delta.content === "string" && delta.content) handlers.onToken(delta.content);
        // OpenAI-style streamed tool calls: fragments keyed by index
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === "number" ? tc.index : 0;
            let slot = toolAccum.get(idx);
            if (!slot) { slot = { index: idx, args: "" }; toolAccum.set(idx, slot); }
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name = tc.function.name;
            if (typeof tc.function?.arguments === "string") slot.args += tc.function.arguments;
          }
        }
      }
    }
    return finishTools(toolAccum);
  } catch (err) {
    if (signal.aborted) throw new AbortedError();
    if (idleTimedOut) throw new ApiError("The response stalled and timed out. Try again.");
    throw networkError(err, baseUrl, false);
  } finally {
    clearTimeout(idle);
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/** Turn accumulated fragments into complete tool calls; undefined if none. */
function finishTools(accum: Map<number, ToolCallAccum>): AgentStreamResult | undefined {
  const calls: AgentStreamResult["toolCalls"] = [];
  for (const slot of [...accum.values()].sort((a, b) => a.index - b.index)) {
    if (!slot.name) continue;
    calls.push({ id: slot.id ?? `call_${slot.index}`, name: slot.name!, args: slot.args || "{}" });
  }
  return calls.length ? { toolCalls: calls } : undefined;
}

/* ————— agent loop: run tool calls to completion against the API ————— */

export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AgentHandlers extends StreamHandlers {
  onToolCall?: (name: string, args: string) => void;
  onToolResult?: (name: string, ok: boolean, output: string) => void;
}

/** One agent turn: stream a response, execute any tool calls, feed results
 *  back, repeat — up to maxRounds — then return the final assistant text. */
export async function agentTurn(
  baseUrl: string,
  key: string,
  model: string,
  history: AgentMessage[],
  handlers: AgentHandlers,
  signal: AbortSignal,
  options: {
    effort?: string;
    tools?: unknown[];
    maxRounds?: number;
    execute: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>;
  },
): Promise<string> {
  const maxRounds = options.maxRounds ?? 8;
  let lastText = "";
  for (let round = 0; round < maxRounds; round++) {
    if (signal.aborted) throw new AbortedError();
    trimHistory(history);
    let roundText = "";
    const res = await streamChat(baseUrl, key, model, history as ChatMessage[], {
      ...handlers,
      onToken: (t) => { roundText += t; handlers.onToken(t); },
    }, signal, { effort: options.effort, tools: options.tools });
    lastText = roundText || lastText;

    if (!res || res.toolCalls.length === 0) return lastText;

    // record the assistant's tool_calls message
    history.push({
      role: "assistant",
      content: roundText,
      tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } })),
    });

    for (const call of res.toolCalls) {
      if (signal.aborted) throw new AbortedError();
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.args || "{}"); } catch { /* model sent bad json */ }
      handlers.onToolCall?.(call.name, call.args);
      const result = await options.execute(call.name, args);
      handlers.onToolResult?.(call.name, result.ok, result.output);
      history.push({ role: "tool", tool_call_id: call.id, content: result.output });
    }
  }
  return lastText;
}


/** Keep the request payload inside upstream limits:
 *  - no single message over 28k chars (upstream rejects >32k strings)
 *  - whole history under ~400k chars (~100k tokens) by dropping oldest turns
 *    from the middle (system/user-first and the newest turns survive). */
const MAX_MSG_CHARS = 28_000;
const MAX_HISTORY_CHARS = 400_000;
function trimHistory(history: AgentMessage[]): void {
  for (const m of history) {
    if (typeof m.content === "string" && m.content.length > MAX_MSG_CHARS) {
      (m as { content: string }).content = m.content.slice(0, MAX_MSG_CHARS - 30) + "\n…(trimmed)";
    }
  }
  let total = history.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 200), 0);
  while (total > MAX_HISTORY_CHARS && history.length > 6) {
    // drop the oldest non-first, non-last-two message (keep original user ask + recent context)
    const idx = history.findIndex((m, i) => i > 0 && i < history.length - 2 && m.role === "tool");
    const drop = idx >= 0 ? idx : 1;
    total -= typeof history[drop]!.content === "string" ? (history[drop]!.content as string).length : 200;
    history.splice(drop, 1);
  }
}

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

/**
 * POST /chat/completions with stream:true and feed tokens to the handlers.
 * Rejects with AbortedError if `signal` fires, ApiError for anything user-facing.
 */
export async function streamChat(
  baseUrl: string,
  key: string,
  model: string,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  signal: AbortSignal,
  options: { effort?: string } = {},
): Promise<void> {
  const { res, controller } = await request(baseUrl, "/chat/completions", {
    method: "POST",
    key,
    signal,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...(options.effort && options.effort !== "auto" ? { reasoning_effort: options.effort } : {}),
    }),
  });
  if (!res.ok) throw await httpError(res);
  if (!res.body) throw new ApiError("The server returned an empty response.");

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("event-stream")) {
    // Some servers ignore stream:true; accept a plain JSON completion too.
    try {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content;
      if (typeof text === "string") return handlers.onToken(text);
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
        if (data === "[DONE]") return;
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
      }
    }
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

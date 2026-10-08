import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ChatMessage } from "./api.js";
import { configDir, readConfig } from "./config.js";

/** One saved conversation. Stored as ~/.unjailed/sessions/<id>.json (mode 600). */
export interface Session {
  id: string;
  title: string;
  cwd: string; // folder the session was started in, used to group sessions by project
  model: string;
  created: number;
  updated: number;
  messages: ChatMessage[];
  skills?: string[]; // skills that were switched on, restored by /resume
}

export type SessionMeta = Omit<Session, "messages"> & { count: number };

const MAX_SESSIONS = 200;

export function sessionsDir(): string {
  return path.join(configDir(), "sessions");
}

/** Saving is on unless UNJAILED_NO_HISTORY is set or config.json has "saveSessions": false. */
export function sessionsEnabled(): boolean {
  const env = process.env.UNJAILED_NO_HISTORY;
  if (env && env !== "0" && env !== "false") return false;
  return readConfig().saveSessions !== false;
}

export function newSession(cwd: string, model: string): Session {
  const now = Date.now();
  const stamp = new Date(now).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return { id: `${stamp}-${crypto.randomBytes(3).toString("hex")}`, title: "", cwd, model, created: now, updated: now, messages: [] };
}

export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "";
  const oneLine = first.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? oneLine.slice(0, 59) + "…" : oneLine || "(untitled)";
}

function fileFor(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error("bad session id");
  return path.join(sessionsDir(), `${id}.json`);
}

function parse(raw: string): Session | null {
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s.id !== "string" || !Array.isArray(s.messages)) return null;
    return {
      id: s.id,
      title: typeof s.title === "string" ? s.title : "",
      cwd: typeof s.cwd === "string" ? s.cwd : "",
      model: typeof s.model === "string" ? s.model : "",
      created: Number(s.created) || 0,
      updated: Number(s.updated) || 0,
      skills: Array.isArray(s.skills) ? s.skills.filter((x: unknown): x is string => typeof x === "string") : [],
      messages: s.messages.filter(
        (m: unknown): m is ChatMessage =>
          !!m && typeof (m as ChatMessage).content === "string" && ["user", "assistant", "system"].includes((m as ChatMessage).role),
      ),
    };
  } catch {
    return null;
  }
}

/** Write atomically (temp file + rename) so a crash never leaves a half-written session. */
export function saveSession(session: Session): void {
  const dir = sessionsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = fileFor(session.id);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best effort */
    }
  }
}

export function loadSession(id: string): Session | null {
  try {
    return parse(fs.readFileSync(fileFor(id), "utf8"));
  } catch {
    return null;
  }
}

export function deleteSession(id: string): void {
  try {
    fs.rmSync(fileFor(id));
  } catch {
    /* already gone */
  }
}

/** All saved sessions, most recently updated first. */
export function listSessions(): SessionMeta[] {
  let names: string[];
  try {
    names = fs.readdirSync(sessionsDir()).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: SessionMeta[] = [];
  for (const name of names) {
    let s: Session | null = null;
    try {
      s = parse(fs.readFileSync(path.join(sessionsDir(), name), "utf8"));
    } catch {
      /* unreadable; skip */
    }
    if (!s || s.messages.length === 0) continue;
    const { messages, ...meta } = s;
    out.push({ ...meta, count: messages.filter((m) => m.role === "user").length });
  }
  return out.sort((a, b) => b.updated - a.updated);
}

/** Keep the newest MAX_SESSIONS; delete the rest. */
export function pruneSessions(): void {
  for (const s of listSessions().slice(MAX_SESSIONS)) deleteSession(s.id);
}

/** Find a session by exact id, id prefix, or 1-based position in `list`. */
export function findSession(query: string, list: SessionMeta[]): SessionMeta | undefined {
  const q = query.trim();
  if (/^\d{1,3}$/.test(q)) return list[Number(q) - 1];
  return list.find((s) => s.id === q) ?? list.find((s) => s.id.startsWith(q));
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toISOString().slice(0, 10);
}

/** ~/projects/foo instead of /home/me/projects/foo. */
export function prettyPath(p: string, home = process.env.HOME || process.env.USERPROFILE || ""): string {
  if (home && (p === home || p.startsWith(home + path.sep))) return "~" + p.slice(home.length);
  return p;
}

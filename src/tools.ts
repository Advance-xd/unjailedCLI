import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The built-in agent tools — a coding-agent toolkit like opencode/claude-code.
 *  Mode ladder (least → most capable):
 *    read  : read-only filesystem + web fetch
 *    cmds  : + run_command (user confirms each)
 *    yolo  : + run_command (no confirm) + write tools
 *  write/edit/write_file always require cmds-or-yolo mode (they change the disk).
 */
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ToolsMode = "off" | "read" | "cmds" | "yolo";

export const MAX_READ_BYTES = 200_000;      // 200 KB per file read
export const MAX_WRITE_BYTES = 200_000;     // 200 KB per file write
export const MAX_RUN_OUTPUT = 30_000;       // chars of stdout/stderr kept
export const MAX_TOOL_OUTPUT = 28_000;      // HARD cap: upstream rejects strings > 32k — never send more
export const RUN_TIMEOUT_MS = 600_000;      // 10 min — downloads, builds, server setup
export const MAX_BG_LOG = 100_000;
export const MAX_LIST = 500;
export const MAX_GLOB_RESULTS = 200;
export const MAX_GREP_RESULTS = 100;
export const WEB_FETCH_MAX_BYTES = 200_000;
export const WEB_TIMEOUT_MS = 15_000;

export function toolDefinitions(mode: Exclude<ToolsMode, "off">): ToolDef[] {
  const defs: ToolDef[] = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a UTF-8 text file from the user's machine. Paths are relative to the current directory unless absolute.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "File path to read" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_dir",
        description: "List files and folders in a directory (one level). Defaults to the current directory.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "Directory to list (default .)" } },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "glob",
        description: "Find files whose names match a glob pattern, e.g. \"**/*.ts\" or \"src/**/*.{js,ts}\". Recursive from the current directory unless the pattern starts with a path.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Glob pattern to match" },
            path: { type: "string", description: "Directory to search in (default .)" },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "grep",
        description: "Search file CONTENTS for a regular expression. Returns matching lines with file:line. Skips node_modules, .git and binary-ish files.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regular expression to search for" },
            path: { type: "string", description: "File or directory to search (default .)" },
            glob: { type: "string", description: "Only search files matching this glob, e.g. \"*.ts\"" },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "clipboard",
          description: "Read or write the system clipboard. action: 'read' or 'write'; text required for write. Cross-platform.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", description: "'read' or 'write'" },
              text: { type: "string", description: "Text to write (for write)" },
            },
            required: ["action"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "launch_app",
          description: "Open a file, folder or application with the OS default handler. Windows: 'start', macOS: 'open', Linux: 'xdg-open'. Examples: 'notepad.exe', 'calc', a folder path to open Explorer/Finder, 'code' for VS Code.",
          parameters: {
            type: "object",
            properties: {
              target: { type: "string", description: "App name or file/folder path" },
            },
            required: ["target"],
          },
        },
      },
    {
      type: "function",
      function: {
        name: "open_url",
        description: "Open a URL (or local file) in the user's default browser.",
        parameters: {
          type: "object",
          properties: { url: { type: "string", description: "URL to open" } },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch a URL and return the response body as text (HTML stripped to text when possible). For reading docs and APIs.",
        parameters: {
          type: "object",
          properties: { url: { type: "string", description: "URL to fetch" } },
          required: ["url"],
        },
      },
    },
  ];

  if (mode === "cmds" || mode === "yolo") {
    defs.push(
      {
        type: "function",
        function: {
          name: "write_file",
          description: "Create or overwrite a text file with the given content. Parent folders are created automatically. On Windows 11 you can write to user folders directly: \"Desktop/file.txt\", \"Documents/notes.md\", \"Downloads/\", or create project folders like \"Desktop/Code/app.py\" or \"Desktop/Tools/script.ps1\". Also supports ~/ paths.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path to write" },
              content: { type: "string", description: "Full file content to write" },
            },
            required: ["path", "content"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "edit_file",
          description: "Replace exact text inside an existing file. old_text must match the file exactly (including whitespace). Fails without writing if not found or found more than once unless replace_all is true.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "File to edit" },
              old_text: { type: "string", description: "Exact text to replace" },
              new_text: { type: "string", description: "Replacement text" },
              replace_all: { type: "boolean", description: "Replace every occurrence (default false)" },
            },
            required: ["path", "old_text", "new_text"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "move_file",
          description: "Move or rename a file/folder. Accepts Desktop/Documents/Downloads shortcuts and ~ paths. Destination parent folders are created.",
          parameters: {
            type: "object",
            properties: {
              from: { type: "string", description: "Source path" },
              to: { type: "string", description: "Destination path" },
            },
            required: ["from", "to"],
          },
        },
      },
            {
        type: "function",
        function: {
          name: "delete_file",
          description: "Delete a file or folder — to the OS trash/recycle bin when the platform allows, permanent only as fallback. Requires cmds/yolo mode.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "File or folder to delete" },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "run_command",
          description: "Run a shell command in the project directory (bash on unix, cmd on Windows). Long timeout — fine for downloads, builds, installs, server setup. Use background:true for long-running processes (servers, daemons); returns immediately with the log path.",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "The command line to run" },
              background: { type: "boolean", description: "Run detached in the background (for servers/daemons). Returns immediately; output goes to a log file." },
            },
            required: ["command"],
          },
        },
      },
    );
  }
  return defs;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

/** Resolve user shortcut folders — Windows 11 friendly.
 *  "Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music" map to
 *  the real OS folders (%USERPROFILE%\Desktop on Win11, ~/Desktop elsewhere).
 *  Anything else returns null (not a shortcut). */
export function userFolder(name: string): string | null {
  const home = os.homedir();
  const map: Record<string, string> = {
    desktop: path.join(home, "Desktop"),
    documents: path.join(home, "Documents"),
    downloads: path.join(home, "Downloads"),
    pictures: path.join(home, "Pictures"),
    videos: path.join(home, "Videos"),
    music: path.join(home, "Music"),
  };
  return map[name.toLowerCase()] ?? null;
}

/** Resolve a tool path: supports "Desktop/foo.txt" style shortcuts + ~ expansion,
 *  then falls back to cwd-relative. Windows paths (C:\... or backslashes) resolve
 *  as absolute already. */
function resolveToolPath(p: string, cwd: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  const parts = p.split(/[\\\\/]/);
  const firstSeg = parts[0] ?? "";
  const uf = userFolder(firstSeg);
  if (uf && parts.length > 1) return path.join(uf, ...parts.slice(1));
  return path.resolve(cwd, p);
}

function clip(s: string, max = MAX_RUN_OUTPUT): string {
  // every tool result funnels through here — enforce the global cap too
  const m = Math.min(max, MAX_TOOL_OUTPUT);
  return s.length > m ? s.slice(0, m) + `\n…(truncated at ${m} chars)` : s;
}

/** Drop wasted tokens from command output: trailing whitespace per line and
 *  long blank runs. Used only for run_command (NOT read_file — collapsing a
 *  source file's blank lines would break edit_file's exact-match). */
function squeeze(s: string): string {
  return s.replace(/[ \t]+$/gm, "").replace(/\n{4,}/g, "\n\n\n");
}

/* ───────────── glob: tiny recursive matcher, no deps ───────────── */

function globToRe(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** — any chars including /
        re += ".*";
        i += 2;
        if (glob[i] === "/") i++; // '**/' also matches zero dirs
        continue;
      }
      re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      // simple {a,b} alternation
      let j = i + 1, depth = 1, body = "";
      while (j < glob.length && depth > 0) {
        if (glob[j] === "{") depth++;
        if (glob[j] === "}") { depth--; if (depth === 0) break; }
        body += glob[j]; j++;
      }
      re += `(?:${body.split(",").map(escapeRe).join("|")})`;
      i = j; i++;
      continue;
    } else re += escapeRe(c);
    i++;
  }
  return new RegExp(`^${re}$`);
}
function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", ".next", "target", "__pycache__", ".venv", "venv"]);

function walkFiles(root: string, out: string[], budget: { left: number }): void {
  if (budget.left <= 0) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (budget.left <= 0) return;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walkFiles(path.join(root, e.name), out, budget);
    } else if (e.isFile()) {
      out.push(path.join(root, e.name));
      budget.left--;
    }
  }
}

/* ───────────── grep ───────────── */

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8000);
  return sample.includes(0);
}

function* grepWalk(root: string): Generator<string> {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      yield* grepWalk(path.join(root, e.name));
    } else if (e.isFile()) yield path.join(root, e.name);
  }
}

/* ───────────── web ───────────── */

async function webFetch(url: string): Promise<ToolResult> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, output: `Invalid URL: ${url}` }; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, output: "Only http and https URLs are supported." };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), WEB_TIMEOUT_MS);
  try {
    const res = await fetch(parsed, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "unjailed-cli/0.6 (terminal agent)" },
    });
    const type = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > WEB_FETCH_MAX_BYTES * 2) return { ok: false, output: `Response too large (${buf.byteLength} bytes).` };
    let text = buf.toString("utf8");
    if (type.includes("html")) {
      // crude but effective html → text
      text = text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    return { ok: res.ok, output: `HTTP ${res.status} ${res.statusText}\n${clip(text, WEB_FETCH_MAX_BYTES)}` };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? `Timed out after ${WEB_TIMEOUT_MS / 1000}s` : (e as Error).message;
    return { ok: false, output: `Fetch failed: ${msg}` };
  } finally {
    clearTimeout(t);
  }
}

function openUrl(url: string): ToolResult {
  const plat = process.platform;
  try {
    if (plat === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else if (plat === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, output: `Opened ${url} in the default browser.` };
  } catch (e) {
    return { ok: false, output: `Couldn't open browser: ${(e as Error).message}` };
  }
}

/* ───────────── main dispatcher ───────────── */

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
  approve?: (command: string) => Promise<boolean>,
): Promise<ToolResult> {
  try {
    if (name === "read_file") {
      const p = String(args.path ?? "");
      if (!p) return { ok: false, output: "path is required" };
      const file = resolveToolPath(p, cwd);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) return { ok: false, output: `${p} is a directory (use list_dir)` };
      if (stat.size > MAX_READ_BYTES) return { ok: false, output: `${p} is ${stat.size} bytes — too large (limit ${MAX_READ_BYTES})` };
      const data = fs.readFileSync(file, "utf8");
      return { ok: true, output: clip(data) };
    }

    if (name === "list_dir") {
      const p = String(args.path ?? ".");
      const dir = resolveToolPath(p, cwd);
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (entries.length > MAX_LIST) return { ok: true, output: clip(entries.slice(0, MAX_LIST).map((e) => (e.isDirectory() ? e.name + "/" : e.name)).join("\n") + `\n…(${entries.length - MAX_LIST} more)`) };
      return { ok: true, output: entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name)).join("\n") || "(empty)" };
    }

    if (name === "glob") {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return { ok: false, output: "pattern is required" };
      const base = path.resolve(cwd, String(args.path ?? "."));
      // pattern may include a dir prefix; split leading literal dirs off
      const all: string[] = [];
      walkFiles(base, all, { left: 20_000 });
      const re = globToRe(pattern);
      const baseGlob = pattern.startsWith("/") || pattern.includes(path.sep) ? pattern : pattern;
      const hits = all.filter((f) => {
        const rel = path.relative(base, f).split(path.sep).join("/");
        return re.test(rel) || re.test(rel.split("/").pop() ?? "");
      }).slice(0, MAX_GLOB_RESULTS);
      return { ok: true, output: hits.length ? hits.map((f) => path.relative(cwd, f)).join("\n") : "(no matches)" };
    }

    if (name === "grep") {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return { ok: false, output: "pattern is required" };
      const root = path.resolve(cwd, String(args.path ?? "."));
      let re: RegExp;
      try { re = new RegExp(pattern); } catch (e) { return { ok: false, output: `Invalid regex: ${(e as Error).message}` }; }
      const onlyGlob = args.glob ? globToRe(String(args.glob)) : null;
      const results: string[] = [];
      const stat = fs.statSync(root);
      const files: string[] = stat.isFile() ? [root] : [...grepWalk(root)];
      for (const file of files) {
        if (results.length >= MAX_GREP_RESULTS) break;
        if (onlyGlob) {
          const rel = path.relative(cwd, file).split(path.sep).join("/");
          const base = rel.split("/").pop() ?? "";
          if (!onlyGlob.test(base) && !onlyGlob.test(rel)) continue;
        }
        let buf: Buffer;
        try { buf = fs.readFileSync(file); } catch { continue; }
        if (buf.byteLength > MAX_READ_BYTES || looksBinary(buf)) continue;
        const lines = buf.toString("utf8").split("\n");
        for (let n = 0; n < lines.length && results.length < MAX_GREP_RESULTS; n++) {
          if (re.test(lines[n]!)) results.push(`${path.relative(cwd, file)}:${n + 1}: ${lines[n]!.trim().slice(0, 200)}`);
        }
      }
      return { ok: true, output: results.length ? results.join("\n") : "(no matches)" };
    }

    if (name === "clipboard") {
      const action = String(args.action ?? "read");
      const plat = process.platform;
      if (action === "write") {
        const text = String(args.text ?? "");
        if (!text) return { ok: false, output: "text is required for write" };
        const cmd = plat === "win32"
          ? `Set-Clipboard -Value ${JSON.stringify(text)}`
          : plat === "darwin" ? "pbcopy" : null;
        if (cmd === null) {
          // linux: try wl-copy then xclip
          for (const c of [["wl-copy"], ["xclip", "-selection", "clipboard"]]) {
            try {
              const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
              const r = spawnSync(c[0]!, c.slice(1), { input: text, encoding: "utf8" });
              if (r.status === 0) return { ok: true, output: "Copied to clipboard." };
            } catch { /* try next */ }
          }
          return { ok: false, output: "No clipboard tool found (install xclip or wl-clipboard)." };
        }
        const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
        const r = plat === "win32"
          ? spawnSync("powershell.exe", ["-NoProfile", "-Command", cmd], { encoding: "utf8" })
          : spawnSync("pbcopy", [], { input: text, encoding: "utf8" });
        return r.status === 0 ? { ok: true, output: "Copied to clipboard." } : { ok: false, output: "Clipboard write failed." };
      }
      // read
      const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
      const r = plat === "win32"
        ? spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard"], { encoding: "utf8" })
        : plat === "darwin"
          ? spawnSync("pbpaste", [], { encoding: "utf8" })
          : spawnSync("sh", ["-c", "wl-paste 2>/dev/null || xclip -selection clipboard -o 2>/dev/null"], { encoding: "utf8" });
      if (r.status !== 0) return { ok: false, output: "Clipboard read failed." };
      return { ok: true, output: clip(String(r.stdout ?? ""), 5_000) || "(clipboard empty)" };
    }

    if (name === "launch_app") {
      const target = String(args.target ?? "");
      if (!target) return { ok: false, output: "target is required" };
      const plat = process.platform;
      try {
        const file = resolveToolPath(target, cwd);
        const exists = fs.existsSync(file);
        const arg = exists ? file : target;
        if (plat === "win32") spawn("cmd", ["/c", "start", "", arg], { detached: true, stdio: "ignore" }).unref();
        else if (plat === "darwin") spawn("open", [arg], { detached: true, stdio: "ignore" }).unref();
        else spawn("xdg-open", [arg], { detached: true, stdio: "ignore" }).unref();
        return { ok: true, output: `Opened ${target}.` };
      } catch (e) {
        return { ok: false, output: `Couldn't launch: ${(e as Error).message}` };
      }
    }

    if (name === "move_file") {
      const from = String(args.from ?? "");
      const to = String(args.to ?? "");
      if (!from || !to) return { ok: false, output: "from and to are required" };
      try {
        const src = resolveToolPath(from, cwd);
        const dst = resolveToolPath(to, cwd);
        if (!fs.existsSync(src)) return { ok: false, output: `${from} not found.` };
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.renameSync(src, dst);
        return { ok: true, output: `Moved ${from} → ${to}.` };
      } catch (e) {
        return { ok: false, output: `Move failed: ${(e as Error).message}` };
      }
    }

    if (name === "delete_file") {
      const p2 = String(args.path ?? "");
      if (!p2) return { ok: false, output: "path is required" };
      if (approve && !(await approve(`delete ${p2}`))) return { ok: false, output: "The user declined." };
      const file = resolveToolPath(p2, cwd);
      if (!fs.existsSync(file)) return { ok: false, output: `${p2} not found.` };
      const plat = process.platform;
      const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
      // trash when the platform supports it
      if (plat === "win32") {
        const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
          `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${file.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`], { encoding: "utf8" });
        if (r.status === 0) return { ok: true, output: `Sent ${p2} to the Recycle Bin.` };
      } else if (plat === "darwin") {
        const r = spawnSync("osascript", ["-e", `tell application \"Finder\" to delete POSIX file \"${file}\"`], { encoding: "utf8" });
        if (r.status === 0) return { ok: true, output: `Sent ${p2} to Trash.` };
      } else {
        const r = spawnSync("gio", ["trash", file], { encoding: "utf8" });
        if (r.status === 0) return { ok: true, output: `Sent ${p2} to trash.` };
      }
      // fallback: permanent
      fs.rmSync(file, { recursive: true, force: true });
      return { ok: true, output: `Deleted ${p2} (no trash available — permanent).` };
    }

    if (name === "open_url") {
      const url = String(args.url ?? "");
      if (!url) return { ok: false, output: "url is required" };
      return openUrl(url);
    }

    if (name === "web_fetch") {
      const url = String(args.url ?? "");
      if (!url) return { ok: false, output: "url is required" };
      return await webFetch(url);
    }

    if (name === "write_file") {
      const p = String(args.path ?? "");
      const content = String(args.content ?? "");
      if (!p) return { ok: false, output: "path is required" };
      if (content.length > MAX_WRITE_BYTES) return { ok: false, output: `Content too large (${content.length} chars, limit ${MAX_WRITE_BYTES})` };
      const file = resolveToolPath(p, cwd);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return { ok: true, output: `Wrote ${content.length} chars to ${p}` };
    }

    if (name === "edit_file") {
      const p = String(args.path ?? "");
      const oldText = String(args.old_text ?? "");
      const newText = String(args.new_text ?? "");
      const replaceAll = args.replace_all === true;
      if (!p || !oldText) return { ok: false, output: "path and old_text are required" };
      const file = resolveToolPath(p, cwd);
      const src = fs.readFileSync(file, "utf8");
      const count = src.split(oldText).length - 1;
      if (count === 0) return { ok: false, output: `old_text not found in ${p} — nothing written.` };
      if (count > 1 && !replaceAll) return { ok: false, output: `old_text found ${count} times in ${p} — pass replace_all or make it more specific.` };
      const next = replaceAll ? src.split(oldText).join(newText) : src.replace(oldText, newText);
      fs.writeFileSync(file, next);
      return { ok: true, output: count > 1 && !replaceAll ? `Replaced 1 of ${count} occurrences in ${p}` : `Replaced ${replaceAll ? count : 1} occurrence${replaceAll && count > 1 ? "s" : ""} in ${p}` };
    }

    if (name === "run_command") {
      const command = String(args.command ?? "");
      const background = args.background === true;
      if (!command) return { ok: false, output: "command is required" };
      if (approve && !(await approve(command))) return { ok: false, output: "The user declined to run this command." };
      if (background) {
        // detached long-runner (server/daemon): log to file, return immediately
        const isWin = process.platform === "win32";
        const logDir = path.join(cwd, ".unjailed");
        fs.mkdirSync(logDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const logFile = path.join(logDir, `bg-${stamp}.log`);
        try {
          const out = fs.openSync(logFile, "a");
          const child = spawn(isWin ? "cmd" : "/bin/sh", isWin ? ["/c", command] : ["-c", command], {
            cwd, detached: true, stdio: ["ignore", out, out],
          });
          child.unref();
          setTimeout(() => { try { fs.closeSync(out); } catch { /* closed */ } }, 500).unref();
          return { ok: true, output: `Started in background (pid ${child.pid}). Output: ${path.relative(cwd, logFile)}\nCheck it later with: run_command { "command": "tail -n 50 ${path.relative(cwd, logFile).split(path.sep).join("/")}" }` };
        } catch (e) {
          return { ok: false, output: `Failed to start background command: ${(e as Error).message}` };
        }
      }
      return await new Promise<ToolResult>((resolve) => {
        const isWin = process.platform === "win32";
        const child = spawn(isWin ? "cmd" : "/bin/sh", isWin ? ["/c", command] : ["-c", command], { cwd });
        let out = "";
        let settled = false;
        const done = (r: ToolResult) => { if (!settled) { settled = true; resolve(r); } };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          done({ ok: false, output: clip(squeeze(out)) + `\n…timed out after ${RUN_TIMEOUT_MS / 60000} min (killed). For servers/daemons pass background:true.` });
        }, RUN_TIMEOUT_MS);
        child.stdout.on("data", (d) => { out += d.toString(); });
        child.stderr.on("data", (d) => { out += d.toString(); });
        child.on("error", (e) => { clearTimeout(timer); done({ ok: false, output: `Failed to start: ${e.message}` }); });
        child.on("close", (code) => {
          clearTimeout(timer);
          done({ ok: code === 0, output: clip(squeeze(out)) || `(no output, exit ${code})` });
        });
      });
    }

    return { ok: false, output: `Unknown tool: ${name}` };
  } catch (e) {
    return { ok: false, output: `Error: ${(e as Error).message}` };
  }
}

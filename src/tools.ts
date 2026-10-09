import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** The built-in agent tools. run_command is only offered when allowCommands. */
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export const MAX_READ_BYTES = 200_000;      // 200 KB per file
export const MAX_RUN_OUTPUT = 20_000;       // chars of stdout/stderr kept
export const RUN_TIMEOUT_MS = 10_000;
export const MAX_LIST = 500;

export function toolDefinitions(allowCommands: boolean): ToolDef[] {
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
        description: "List files and folders in a directory. Defaults to the current directory.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "Directory to list (default .)" } },
        },
      },
    },
  ];
  if (allowCommands) {
    defs.push({
      type: "function",
      function: {
        name: "run_command",
        description: "Run a shell command on the user's machine (cmd on Windows, sh elsewhere). 10s timeout. Ask before anything destructive.",
        parameters: {
          type: "object",
          properties: { command: { type: "string", description: "The command line to run" } },
          required: ["command"],
        },
      },
    });
  }
  return defs;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

function clip(s: string): string {
  return s.length > MAX_RUN_OUTPUT ? s.slice(0, MAX_RUN_OUTPUT) + `\n…(truncated at ${MAX_RUN_OUTPUT} chars)` : s;
}

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
      const file = path.resolve(cwd, p);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) return { ok: false, output: `${p} is a directory (use list_dir)` };
      if (stat.size > MAX_READ_BYTES) return { ok: false, output: `${p} is ${stat.size} bytes — too large (limit ${MAX_READ_BYTES})` };
      const data = fs.readFileSync(file, "utf8"); // throws on binary-ish? utf8 never throws, may look odd
      return { ok: true, output: clip(data) };
    }
    if (name === "list_dir") {
      const p = String(args.path ?? ".");
      const dir = path.resolve(cwd, p);
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (entries.length > MAX_LIST) return { ok: true, output: clip(entries.slice(0, MAX_LIST).map((e) => (e.isDirectory() ? e.name + "/" : e.name)).join("\n") + `\n…(${entries.length - MAX_LIST} more)`) };
      return { ok: true, output: entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name)).join("\n") || "(empty)" };
    }
    if (name === "run_command") {
      const command = String(args.command ?? "");
      if (!command) return { ok: false, output: "command is required" };
      if (approve && !(await approve(command))) return { ok: false, output: "The user declined to run this command." };
      return await new Promise<ToolResult>((resolve) => {
        const isWin = process.platform === "win32";
        const child = spawn(isWin ? "cmd" : "/bin/sh", isWin ? ["/c", command] : ["-c", command], { cwd });
        let out = "";
        let settled = false;
        const done = (r: ToolResult) => { if (!settled) { settled = true; resolve(r); } };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          done({ ok: false, output: clip(out) + "\n…timed out after 10s (killed)" });
        }, RUN_TIMEOUT_MS);
        child.stdout.on("data", (d) => { out += d.toString(); });
        child.stderr.on("data", (d) => { out += d.toString(); });
        child.on("error", (e) => { clearTimeout(timer); done({ ok: false, output: `Failed to start: ${e.message}` }); });
        child.on("close", (code) => {
          clearTimeout(timer);
          done({ ok: code === 0, output: clip(out) || `(no output, exit ${code})` });
        });
      });
    }
    return { ok: false, output: `Unknown tool: ${name}` };
  } catch (e) {
    return { ok: false, output: `Error: ${(e as Error).message}` };
  }
}

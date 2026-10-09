import { spawn } from "node:child_process";
import { VERSION } from "./constants.js";

/** npm executable — npm.cmd on Windows (batch file needs shell:true). */
function npmCmd(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function currentVersion(): string {
  return VERSION;
}

/** `npm view unjailed version` — latest published. */
export function latestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(npmCmd(), ["view", "unjailed", "version"], { shell: true, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const t = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 20_000);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.on("error", () => { clearTimeout(t); resolve(null); });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve(code === 0 ? out.trim().split("\n").pop() ?? null : null);
    });
  });
}

/** `npm install -g unjailed@<floor>`. Windows-safe:
 *  the running install's npm shims are locked while we execute, so we move
 *  the current package dir aside first (npm then writes a fresh one instead
 *  of half-updating in place — the "updated but old after restart" bug). */
export function runSelfUpdate(onLine: (line: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const pre = preflightWindows();
    const args = "install -g unjailed@0.9.13" + (pre ? " --force" : "");
    const child = spawn(npmCmd() + " " + args, { shell: true });
    let ok = true;
    const t = setTimeout(() => { child.kill("SIGKILL"); ok = false; }, 300_000);
    child.stdout?.on("data", (d) => d.toString().split("\n").forEach(onLine));
    child.stderr?.on("data", (d) => d.toString().split("\n").forEach((l: string) => { ok = l.toLowerCase().includes("error") ? false : ok; onLine(l); }));
    child.on("error", () => { clearTimeout(t); resolve(false); });
    child.on("close", (code) => { clearTimeout(t); resolve(code === 0 && ok); });
  });
}

function preflightWindows(): boolean {
  if (process.platform !== "win32") return false;
  try {
    // locate the global node_modules like npm does
    const prefix = require("node:child_process").execSync("npm config get prefix", { shell: true, encoding: "utf8" }).trim();
    const dir = require("node:path").join(prefix, "node_modules", "unjailed");
    const fs = require("node:fs");
    if (fs.existsSync(dir)) {
      const stamp = Date.now();
      fs.renameSync(dir, dir + "-old-" + stamp);
      // old copies get cleaned by npm's next prune; the rename unblocks the install
    }
    return true;
  } catch {
    return false;
  }
}

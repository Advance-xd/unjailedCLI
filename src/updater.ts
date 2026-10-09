import { spawn } from "node:child_process";

/** npm executable — npm.cmd on Windows (batch file needs shell:true). */
function npmCmd(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function currentVersion(): string {
  // injected at build by postbuild? simplest: read package.json next to dist
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../package.json");
    return pkg.version;
  } catch {
    return "unknown";
  }
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

/** `npm install -g unjailed@latest`. Streams output via onLine. */
export function runSelfUpdate(onLine: (line: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(npmCmd(), ["install", "-g", "unjailed@0.9.1"], { shell: true });  // explicit floor; @latest tag can lag
    let ok = true;
    const t = setTimeout(() => { child.kill("SIGKILL"); ok = false; }, 300_000);
    child.stdout?.on("data", (d) => d.toString().split("\n").forEach(onLine));
    child.stderr?.on("data", (d) => d.toString().split("\n").forEach((l: string) => { ok = l.toLowerCase().includes("error") ? false : ok; onLine(l); }));
    child.on("error", () => { clearTimeout(t); resolve(false); });
    child.on("close", (code) => { clearTimeout(t); resolve(code === 0 && ok); });
  });
}

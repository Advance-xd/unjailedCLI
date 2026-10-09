import { exec } from "node:child_process";
import { listModels } from "./api.js";
import { readConfig, writeConfig, resolveBaseUrl } from "./config.js";

/**
 * Self-healing auth — the CLI must recover from dead keys WITHOUT asking the
 * customer to touch environment variables (2026-10-09: a user's revoked
 * UNJAILED_API_KEY env var overrode their valid saved key and locked them out).
 *
 * recoverAuth flow, run when a request 401s:
 *   1. If the failing key came from the env var and a DIFFERENT saved key
 *      exists → validate the saved key live. If it works, pin it
 *      ("ignoreEnvKey": true) so the env var never wins again. Done.
 *   2. If the failing key was the saved one and an env key exists → same,
 *      mirrored.
 *   3. Both dead / only one exists and it's dead → return null; the UI
 *      asks for /login as the last resort.
 */

export interface Recovered {
  key: string;
  source: "env" | "config";
  action: "switched-saved" | "switched-env" | "none";
  message: string;
}

function envKey(): string | null {
  const v = process.env.UNJAILED_API_KEY?.trim();
  return v || null;
}
function savedKey(): string | null {
  return readConfig().apiKey?.trim() || null;
}

async function keyWorks(key: string): Promise<boolean> {
  try {
    const models = await listModels(resolveBaseUrl(), key, undefined);
    return Array.isArray(models) && models.length > 0;
  } catch {
    return false;
  }
}

/** Try to recover automatically after a 401. Null = unrecoverable, /login needed. */
export async function recoverAuth(failedSource: "env" | "config"): Promise<Recovered | null> {
  const env = envKey();
  const saved = savedKey();
  const cfg = readConfig();

  // Case 1: env var key failed, saved key exists and differs
  if (failedSource === "env" && saved && saved !== env) {
    if (await keyWorks(saved)) {
      writeConfig({ ignoreEnvKey: true }); // env var never wins again
      return {
        key: saved,
        source: "config",
        action: "switched-saved",
        message: `The UNJAILED_API_KEY environment variable was rejected (probably an old key). Switched to your saved key automatically — it works.`,
      };
    }
  }

  // Case 2: saved key failed, env key exists and differs
  if (failedSource === "config" && env && saved !== env) {
    if (await keyWorks(env)) {
      return {
        key: env,
        source: "env",
        action: "switched-env",
        message: `The saved key was rejected. Switched to UNJAILED_API_KEY automatically — it works.`,
      };
    }
  }

  return null;
}

/** Attempt to remove UNJAILED_API_KEY from the user-level environment on
 *  Windows (persistent) — best effort; failure is silent (we already pinned
 *  ignoreEnvKey, so this is hygiene, not a requirement). */
export function tryClearEnvKeyWindows(): void {
  if (process.platform !== "win32") return;
  try {
    exec(
      `[Environment]::SetEnvironmentVariable('UNJAILED_API_KEY', $null, 'User')`,
      { shell: "powershell.exe", timeout: 8000 },
      () => { /* best effort */ },
    );
  } catch {
    /* best effort */
  }
}

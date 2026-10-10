import { colorLevel } from "../theme.js";
import { readConfig } from "../config.js";

/** Whether the fun effects (startup wink, side snow, finish sparkle) should run.
 *  Off when: not a real terminal, color disabled (NO_COLOR/dumb), the
 *  UNJAILED_NO_FX env var is set, or "fx": false is saved in the config.
 *  On by default otherwise. */
export function fxEnabled(): boolean {
  if (!process.stdout.isTTY) return false;
  if (colorLevel === 0) return false;
  const env = process.env.UNJAILED_NO_FX;
  if (env === "1" || env === "true") return false;
  if (readConfig().fx === false) return false;
  return true;
}

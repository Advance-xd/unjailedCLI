import { BRAND_BLUE } from "./constants.js";
import { c, colorLevel } from "./theme.js";

// 14×12 pixel smiley outline. Each terminal row packs two pixel rows via half blocks,
// so this renders 14 columns × 6 lines and looks square in a normal terminal font.
//   B = brand blue, . = transparent (the inside stays blank)
const PIXELS = [
  "BBBBBBBBBBBBBB",
  "B............B",
  "B............B",
  "B..BBB..BBB..B",
  "B............B",
  "B............B",
  "B............B",
  "B...B....B...B",
  "B...B....B...B",
  "B...BBBBBB...B",
  "B............B",
  "BBBBBBBBBBBBBB",
];

const PLAIN = [
  "+------------+",
  "|  ---  ---  |",
  "|            |",
  "|   |    |   |",
  "|   '----'   |",
  "+------------+",
];

const hexOf = (p: string) => (p === "B" ? BRAND_BLUE : null);

export function logoLines(level: number = colorLevel): string[] {
  if (level === 0) return PLAIN;
  const lines: string[] = [];
  for (let y = 0; y < PIXELS.length; y += 2) {
    let line = "";
    const top = PIXELS[y]!;
    const bottom = PIXELS[y + 1] ?? ".".repeat(top.length);
    for (let x = 0; x < top.length; x++) {
      const t = hexOf(top[x]!);
      const b = hexOf(bottom[x]!);
      if (t && b) line += t === b ? c.hex(t)("█") : c.hex(t).bgHex(b)("▀");
      else if (t) line += c.hex(t)("▀");
      else if (b) line += c.hex(b)("▄");
      else line += " ";
    }
    lines.push(line);
  }
  return lines;
}

export const LOGO_WIDTH = PIXELS[0]!.length;

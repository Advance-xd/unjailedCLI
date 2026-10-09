import { highlight, supportsLanguage } from "cli-highlight";
import { c, colorLevel } from "./theme.js";
import { BRAND_BLUE } from "./constants.js";
import stringWidth from "string-width";

/** Bold, italics, inline code and links within a single line. */
function inline(text: string): string {
  // Pull inline code out first so its contents aren't formatted.
  const codes: string[] = [];
  let s = text.replace(/`([^`\n]+)`/g, (_, code: string) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, (_, t: string) => c.bold(t));
  s = s.replace(/__([^_\n]+?)__/g, (_, t: string) => c.bold(t));
  s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, (_, pre: string, t: string) => pre + c.italic(t));
  s = s.replace(/~~([^~\n]+?)~~/g, (_, t: string) => c.strikethrough(t));
  s = s.replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, (_, label: string, url: string) => `${c.hex(BRAND_BLUE).underline(label)} ${c.gray(`(${url})`)}`);
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => (colorLevel === 0 ? `\`${codes[+i]}\`` : c.hex(BRAND_BLUE)(codes[+i]!)));
  return s;
}

function codeBlock(code: string, lang: string): string[] {
  let body = code;
  if (colorLevel > 0) {
    try {
      const language = lang && supportsLanguage(lang) ? lang : undefined;
      body = highlight(code, { language, ignoreIllegals: true });
    } catch {
      /* leave plain */
    }
  }
  const bar = c.gray("│ ");
  const lines = body.split("\n").map((l) => bar + l);
  const label = lang ? c.gray(`╭─ ${lang}`) : c.gray("╭─");
  return [label, ...lines, c.gray("╰─")];
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

const isTableSeparator = (line: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

function table(rows: string[][], aligns: ("left" | "right" | "center")[]): string[] {
  const cols = Math.max(...rows.map((r) => r.length));
  const cells = rows.map((r) => Array.from({ length: cols }, (_, i) => inline(r[i] ?? "")));
  const widths = Array.from({ length: cols }, (_, i) => Math.max(3, ...cells.map((r) => stringWidth(r[i]!))));
  const pad = (text: string, i: number) => {
    const gap = widths[i]! - stringWidth(text);
    if (aligns[i] === "right") return " ".repeat(gap) + text;
    if (aligns[i] === "center") return " ".repeat(Math.floor(gap / 2)) + text + " ".repeat(Math.ceil(gap / 2));
    return text + " ".repeat(gap);
  };
  const bar = c.gray(" │ ");
  const out = cells.map((r, ri) => r.map((cell, i) => pad(ri === 0 ? c.bold(cell) : cell, i)).join(bar));
  out.splice(1, 0, c.gray(widths.map((w) => "─".repeat(w)).join("─┼─")));
  return out;
}

/**
 * Render markdown to ANSI text. Safe to call on partial (still-streaming) input:
 * an unterminated code fence renders as a code block so far.
 */
/** Wrap a single rendered line to `cols` visible columns, ANSI-aware.
 *  Long unbroken lines (urls, paths, minified code) otherwise clip hard at
 *  the terminal edge on narrow windows consoles. */
function wrapAnsiLine(line: string, cols: number): string[] {
  if (cols < 20) return [line];
  const parts: string[] = [];
  let cur = "";
  let width = 0;
  // split into (ansi, visible char) tokens
  const tokens = line.match(/\x1b\[[0-9;]*m|./gu) ?? [];
  for (const tok of tokens) {
    if (tok.startsWith("\x1b")) { cur += tok; continue; }
    const w = stringWidth(tok);
    if (width + w > cols - 1) {
      parts.push(cur);
      cur = "";
      width = 0;
      // preserve leading bullet indent continuation
    }
    cur += tok;
    width += w;
  }
  parts.push(cur);
  return parts;
}

export function renderMarkdown(src: string, opts: { width?: number } = {}): string {
  const lines0 = src.replace(/\r\n?/g, "\n").split("\n");
  // width-wrapping happens post-render (see below) — fences stay unwrapped
  const lines = lines0;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/);
    if (fence) {
      const marker = fence[1]!;
      const lang = fence[2] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) body.push(lines[i++]!);
      out.push(...codeBlock(body.join("\n"), lang));
      continue;
    }

    // GitHub-style table: a header row followed by a |---|---| separator.
    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      const aligns = splitRow(lines[i + 1]!).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left") as "left" | "right" | "center");
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(splitRow(lines[i++]!));
      i--;
      out.push(...table(rows, aligns));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const text = inline(heading[2]!);
      out.push(heading[1]!.length <= 2 ? c.bold.underline(text) : c.bold(text));
      continue;
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push(c.gray("─".repeat(40)));
      continue;
    }

    const bullet = line.match(/^(\s*)[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (bullet) {
      const indent = " ".repeat(Math.floor(bullet[1]!.length / 2) * 2);
      const box = bullet[2] === undefined ? "•" : bullet[2] === " " ? "☐" : "☑";
      out.push(`${indent}${c.hex(BRAND_BLUE)(box)} ${inline(bullet[3]!)}`);
      continue;
    }

    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      const indent = " ".repeat(Math.floor(numbered[1]!.length / 2) * 2);
      out.push(`${indent}${c.hex(BRAND_BLUE)(numbered[2] + ".")} ${inline(numbered[3]!)}`);
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      out.push(c.gray("▎ ") + c.italic(inline(quote[1]!)));
      continue;
    }

    out.push(inline(line));
  }
  const joined = out.join("\n");
  const w = opts.width;
  if (!w) return joined;
  return joined
    .split("\n")
    .flatMap((l) => (l.includes("\x1b") || stringWidth(l) > w - 1 ? wrapAnsiLine(l, w) : [l]))
    .join("\n");
}

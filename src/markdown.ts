import { highlight, supportsLanguage } from "cli-highlight";
import { c, colorLevel } from "./theme.js";
import { BRAND_BLUE } from "./constants.js";

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

/**
 * Render markdown to ANSI text. Safe to call on partial (still-streaming) input:
 * an unterminated code fence renders as a code block so far.
 */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
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
  return out.join("\n");
}

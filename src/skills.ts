import fs from "node:fs";
import path from "node:path";
import { configDir } from "./config.js";

/**
 * A skill is a markdown file of instructions the model follows while it's switched on.
 * Looked up in two places (project wins on a name clash):
 *   ./.unjailed/skills/<name>/SKILL.md  or  ./.unjailed/skills/<name>.md   (this project)
 *   ~/.unjailed/skills/<name>/SKILL.md  or  ~/.unjailed/skills/<name>.md   (everywhere)
 * Optional frontmatter:  ---\nname: …\ndescription: …\n---
 */
export interface Skill {
  name: string;
  description: string;
  scope: "project" | "user";
  file: string;
  body: string;
}

export const MAX_SKILL_CHARS = 32_000;

export function userSkillsDir(): string {
  return path.join(configDir(), "skills");
}

export function projectSkillsDir(cwd = process.cwd()): string {
  return path.join(cwd, ".unjailed", "skills");
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export function parseSkill(raw: string, fallbackName: string): { name: string; description: string; body: string } {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  let name = fallbackName;
  let description = "";
  let body = text;
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = text.slice(fm[0].length);
    for (const line of fm[1]!.split("\n")) {
      const m = line.match(/^(\w+)\s*:\s*(.*)$/);
      if (!m) continue;
      const value = m[2]!.trim().replace(/^["']|["']$/g, "");
      if (m[1] === "name" && value) name = normaliseName(value);
      if (m[1] === "description") description = value;
    }
  }
  body = body.trim();
  if (!description) {
    // First non-heading line makes a decent description.
    const line = body.split("\n").find((l) => l.trim() && !l.startsWith("#"));
    description = (line ?? "").trim().slice(0, 100);
  }
  return { name, description, body };
}

function scan(dir: string, scope: Skill["scope"]): Skill[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const e of entries) {
    let file: string | null = null;
    let fallback = "";
    if (e.isDirectory()) {
      const f = path.join(dir, e.name, "SKILL.md");
      if (fs.existsSync(f)) {
        file = f;
        fallback = e.name;
      }
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      file = path.join(dir, e.name);
      fallback = e.name.slice(0, -3);
    }
    if (!file) continue;
    try {
      const parsed = parseSkill(fs.readFileSync(file, "utf8"), normaliseName(fallback));
      if (!NAME_RE.test(parsed.name) || !parsed.body) continue;
      out.push({ ...parsed, scope, file });
    } catch {
      /* unreadable; skip */
    }
  }
  return out;
}

/** All skills, project ones first, sorted by name; a project skill hides a user skill of the same name. */
export function loadSkills(cwd = process.cwd()): Skill[] {
  const byName = new Map<string, Skill>();
  for (const s of scan(userSkillsDir(), "user")) byName.set(s.name, s);
  for (const s of scan(projectSkillsDir(cwd), "project")) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "project" ? -1 : 1));
}

/** The system message sent with each request while skills are on. */
export function skillsSystemPrompt(skills: Skill[]): string | null {
  if (skills.length === 0) return null;
  const parts = skills.map((s) => {
    const body = s.body.length > MAX_SKILL_CHARS ? s.body.slice(0, MAX_SKILL_CHARS) + "\n…(truncated)" : s.body;
    return `<skill name="${s.name}">\n${body}\n</skill>`;
  });
  return `The user has switched on the following skill${skills.length === 1 ? "" : "s"}. Follow ${skills.length === 1 ? "its" : "their"} instructions for the rest of this conversation unless the user says otherwise.\n\n${parts.join("\n\n")}`;
}

/** Create ~/.unjailed/skills/<name>/SKILL.md (or the project folder) from a template. */
export function createSkill(name: string, scope: Skill["scope"], cwd = process.cwd()): string {
  const n = normaliseName(name);
  if (!NAME_RE.test(n)) throw new Error("Skill names can use letters, numbers, dots, dashes and underscores.");
  const dir = path.join(scope === "project" ? projectSkillsDir(cwd) : userSkillsDir(), n);
  const file = path.join(dir, "SKILL.md");
  if (fs.existsSync(file)) throw new Error(`A skill named "${n}" already exists: ${file}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file,
    `---\nname: ${n}\ndescription: One line about what this skill does\n---\n\n# ${n}\n\nWrite the instructions the model should follow while this skill is on.\nFor example: coding conventions, a writing style, a persona, a checklist to follow.\n`,
  );
  return file;
}

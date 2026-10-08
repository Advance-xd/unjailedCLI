import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "unjailed-skills-"));
process.env.UNJAILED_HOME = path.join(root, "home");
const proj = path.join(root, "proj");
const K = await import("../dist/skills.js");
after(() => fs.rmSync(root, { recursive: true, force: true }));

test("parses frontmatter and falls back to the first line", () => {
  const a = K.parseSkill("---\nname: Code Review\ndescription: \"Review diffs\"\n---\n\nBe strict.", "x");
  assert.deepEqual(a, { name: "code-review", description: "Review diffs", body: "Be strict." });
  const b = K.parseSkill("# Title\nShort answers only.\n", "terse");
  assert.equal(b.name, "terse");
  assert.equal(b.description, "Short answers only.");
});

test("loads user + project skills; project wins on a clash", () => {
  K.createSkill("style", "user", proj);
  K.createSkill("style", "project", proj);
  fs.mkdirSync(K.projectSkillsDir(proj), { recursive: true });
  fs.writeFileSync(path.join(K.projectSkillsDir(proj), "pirate.md"), "Talk like a pirate.");
  fs.writeFileSync(path.join(K.projectSkillsDir(proj), "empty.md"), "   ");
  const skills = K.loadSkills(proj);
  assert.deepEqual(skills.map((s) => `${s.name}:${s.scope}`), ["pirate:project", "style:project"]);
  assert.throws(() => K.createSkill("style", "user", proj), /already exists/);
  assert.throws(() => K.createSkill("../evil", "user", proj), /letters, numbers/);
});

test("system prompt wraps each active skill", () => {
  const sys = K.skillsSystemPrompt(K.loadSkills(proj).filter((s) => s.name === "pirate"));
  assert.match(sys, /<skill name="pirate">\nTalk like a pirate\.\n<\/skill>/);
  assert.equal(K.skillsSystemPrompt([]), null);
});

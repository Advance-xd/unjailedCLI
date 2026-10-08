import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "unjailed-sessions-"));
process.env.UNJAILED_HOME = home;
delete process.env.UNJAILED_NO_HISTORY;
const S = await import("../dist/sessions.js");
after(() => fs.rmSync(home, { recursive: true, force: true }));

const msgs = (q) => [{ role: "user", content: q }, { role: "assistant", content: "ok" }];

test("save, list newest first, load, delete", () => {
  const a = { ...S.newSession("/proj/a", "kimi-k3"), title: "first", messages: msgs("first"), updated: 1000 };
  const b = { ...S.newSession("/proj/b", "glm-5.3"), title: "second", messages: msgs("second"), updated: 2000 };
  S.saveSession(a);
  S.saveSession(b);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(S.sessionsDir(), `${a.id}.json`)).mode & 0o777, 0o600);
  const list = S.listSessions();
  assert.deepEqual(list.map((s) => s.title), ["second", "first"]);
  assert.equal(list[0].count, 1);
  assert.equal(S.loadSession(a.id).messages[0].content, "first");
  S.deleteSession(a.id);
  assert.equal(S.loadSession(a.id), null);
  assert.equal(S.listSessions().length, 1);
});

test("findSession by number, id and prefix", () => {
  const list = [{ id: "20261007-aaa" }, { id: "20261008-bbb" }];
  assert.equal(S.findSession("2", list).id, "20261008-bbb");
  assert.equal(S.findSession("20261007", list).id, "20261007-aaa");
  assert.equal(S.findSession("nope", list), undefined);
});

test("rejects path traversal ids and skips corrupt files", () => {
  assert.equal(S.loadSession("../config"), null);
  fs.writeFileSync(path.join(S.sessionsDir(), "broken.json"), "{not json");
  assert.doesNotThrow(() => S.listSessions());
});

test("titles and opt-out", () => {
  assert.equal(S.titleFrom(msgs("  hello\n  world ")), "hello world");
  assert.equal(S.titleFrom(msgs("x".repeat(100))).length, 60);
  process.env.UNJAILED_NO_HISTORY = "1";
  assert.equal(S.sessionsEnabled(), false);
  delete process.env.UNJAILED_NO_HISTORY;
  assert.equal(S.sessionsEnabled(), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// auth-recovery unit tests use a sandboxed UNJAILED_HOME config.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "uj-authrec-"));
process.env.UNJAILED_HOME = home;

const { readConfig, writeConfig, resolveKey } = await import("../dist/config.js");

test("ignoreEnvKey makes resolveKey skip the env var", () => {
  process.env.UNJAILED_API_KEY = "sk-uj-envkey-envkey-envkey-envkey";
  writeConfig({ apiKey: "sk-uj-savedkey-savedkey-savedkey", ignoreEnvKey: false });
  assert.equal(resolveKey().source, "env");

  writeConfig({ ignoreEnvKey: true });
  const r = resolveKey();
  assert.equal(r.source, "config");
  assert.ok(r.key.startsWith("sk-uj-savedkey"));

  delete process.env.UNJAILED_API_KEY;
  writeConfig({ ignoreEnvKey: false });
});

test("config round-trips ignoreEnvKey", () => {
  writeConfig({ ignoreEnvKey: true });
  assert.equal(readConfig().ignoreEnvKey, true);
  writeConfig({ ignoreEnvKey: false });
  assert.notEqual(readConfig().ignoreEnvKey, true); // false/undefined both mean "honor env var"
});

test("recoverAuth returns null when only one key exists and it's dead (mocked network fails closed)", async () => {
  // no network in tests: keyWorks() will fail → recovery must yield null, not loop
  process.env.UNJAILED_API_KEY = "sk-uj-dead-env-dead-env-dead";
  writeConfig({ ignoreEnvKey: false });
  const { recoverAuth } = await import("../dist/auth-recovery.js");
  const r = await recoverAuth("env");
  assert.equal(r, null);
  delete process.env.UNJAILED_API_KEY;
});

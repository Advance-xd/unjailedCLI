import test from "node:test";
import assert from "node:assert/strict";
import { toolDefinitions, executeTool, MAX_READ_BYTES } from "../src/tools.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("tool definitions by mode", () => {
  const off = toolDefinitions(false);
  const read = toolDefinitions(true);
  assert.equal(off.length, 2);
  assert.equal(read.length, 3);
  assert.ok(read.some((t) => t.function.name === "run_command"));
  assert.ok(read.some((t) => t.function.name === "read_file"));
  assert.ok(read.some((t) => t.function.name === "list_dir"));
});

test("read_file reads a real file, clips big ones, refuses dirs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uj-tools-"));
  const file = path.join(dir, "hello.txt");
  fs.writeFileSync(file, "hello agent");
  const r = await executeTool("read_file", { path: file }, dir);
  assert.equal(r.ok, true);
  assert.equal(r.output, "hello agent");

  const big = path.join(dir, "big.txt");
  fs.writeFileSync(big, "x".repeat(MAX_READ_BYTES + 10));
  const r2 = await executeTool("read_file", { path: big }, dir);
  assert.equal(r2.ok, false);

  const r3 = await executeTool("read_file", { path: dir }, dir);
  assert.equal(r3.ok, false);
});

test("list_dir lists with trailing slash on dirs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uj-tools-"));
  fs.writeFileSync(path.join(dir, "a.txt"), "a");
  fs.mkdirSync(path.join(dir, "sub"));
  const r = await executeTool("list_dir", {}, dir);
  assert.equal(r.ok, true);
  assert.ok(r.output.includes("a.txt"));
  assert.ok(r.output.includes("sub/"));
});

test("run_command works cross-platform and respects approval", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uj-tools-"));
  const echo = process.platform === "win32" ? "echo hello" : "echo hello";
  const r = await executeTool("run_command", { command: echo }, dir);
  assert.equal(r.ok, true);
  assert.ok(r.output.includes("hello"));

  // declined by approver
  const r2 = await executeTool("run_command", { command: echo }, dir, async () => false);
  assert.equal(r2.ok, false);
  assert.ok(/declined/i.test(r2.output));

  // approved by approver
  const r3 = await executeTool("run_command", { command: echo }, dir, async () => true);
  assert.equal(r3.ok, true);
});

test("run_command timeout kills hanging commands", async () => {
  const dir = process.cwd();
  const hang = process.platform === "win32" ? "ping -n 30 127.0.0.1" : "sleep 30";
  const t0 = Date.now();
  const r = await executeTool("run_command", { command: hang }, dir);
  assert.equal(r.ok, false);
  assert.ok(/timed out/.test(r.output));
  assert.ok(Date.now() - t0 < 15_000);
});

test("unknown tool errors cleanly", async () => {
  const r = await executeTool("nope", {}, process.cwd());
  assert.equal(r.ok, false);
  assert.ok(/Unknown tool/.test(r.output));
});

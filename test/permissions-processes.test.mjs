import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeTool, resolveToolPath, toolDefinitions } from "../dist/tools.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uj-local-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const approved = (name, args, cwd, options = {}) => executeTool(name, args, cwd, async () => true, { mode: "cmds", ...options });
const node = `"${process.execPath}"`;

test("read/off mode boundaries reject unadvertised mutations even with auto approval", async (t) => {
  const dir = workspace(t);
  fs.writeFileSync(path.join(dir, "keep.txt"), "keep");
  for (const mode of ["read", "off"]) {
    for (const [name, args] of [
      ["write_file", { path: "created.txt", content: "bad" }],
      ["edit_file", { path: "keep.txt", old_text: "keep", new_text: "bad" }],
      ["move_file", { from: "keep.txt", to: "moved.txt" }],
      ["delete_file", { path: "keep.txt", permanent: true }],
      ["run_command", { command: "echo unexpected" }],
      ["clipboard", { action: "write", text: "unexpected" }],
      ["launch_app", { target: "missing-app" }],
      ["open_url", { url: "https://example.com" }],
      ["stop_process", { job_id: "unknown" }],
    ]) {
      const result = await executeTool(name, args, dir, () => { throw new Error("must not request approval"); }, { mode, autoApprove: true });
      assert.equal(result.ok, false, `${mode}/${name}`);
      assert.match(result.output, /unavailable/);
    }
  }
  assert.deepEqual(toolDefinitions("off"), []);
  assert.equal(fs.readFileSync(path.join(dir, "keep.txt"), "utf8"), "keep");
  assert.equal(fs.existsSync(path.join(dir, "created.txt")), false);
  assert.equal((await executeTool("read_file", { path: "keep.txt" }, dir)).output, "keep");
  assert.equal((await executeTool("read_file", { path: "keep.txt" }, dir, undefined, { mode: "off" })).ok, false);
});

test("every mutation is denied without approval; auto/yolo remain explicit", async (t) => {
  const dir = workspace(t);
  for (const [name, args] of [
    ["write_file", { path: "x", content: "no" }], ["edit_file", { path: "x", old_text: "a", new_text: "b" }],
    ["move_file", { from: "x", to: "y" }], ["delete_file", { path: "x", permanent: true }],
    ["run_command", { command: "echo no" }], ["clipboard", { action: "write", text: "no" }],
    ["launch_app", { target: "anything" }], ["open_url", { url: "https://example.com" }], ["stop_process", { job_id: "unknown" }],
  ]) {
    for (const approve of [undefined, async () => false]) {
      const result = await executeTool(name, args, dir, approve, { mode: "cmds" });
      assert.equal(result.ok, false, name);
      assert.match(result.output, /approval|declined/);
    }
  }
  assert.deepEqual(fs.readdirSync(dir), []);
  for (const options of [{ mode: "yolo" }, { mode: "cmds", autoApprove: true }]) {
    assert.equal((await executeTool("write_file", { path: "yes", content: "approved" }, dir, undefined, options)).ok, true);
  }
});

test("cancel during approval prevents disk writes even after a yes", async (t) => {
  const dir = workspace(t);
  const controller = new AbortController();
  const result = await executeTool("write_file", { path: "x", content: "bad" }, dir, async () => {
    controller.abort(); return true;
  }, { mode: "cmds", signal: controller.signal });
  assert.equal(result.ok, false);
  assert.match(result.output, /cancelled/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("Windows, UNC, home and user folders resolve consistently including bare Desktop", () => {
  const win = (value) => resolveToolPath(value, "C:\\Projects\\app", "win32", "C:\\Users\\Ada");
  assert.equal(win("Desktop"), "C:\\Users\\Ada\\Desktop");
  assert.equal(win("Documents\\my app\\main.js"), "C:\\Users\\Ada\\Documents\\my app\\main.js");
  assert.equal(win("~/Downloads/a.js"), "C:\\Users\\Ada\\Downloads\\a.js");
  assert.equal(win("D:\\Apps\\x.js"), "D:\\Apps\\x.js");
  assert.equal(win("\\\\server\\share\\x.js"), "\\\\server\\share\\x.js");
  assert.equal(resolveToolPath("~/app", "/work", "linux", "/users/ada"), "/users/ada/app");
  assert.equal(resolveToolPath("~other/file", "/work", "linux", "/users/ada"), "/work/~other/file");
});

test("permissioned agent creates, edits, runs and inspects a program outside its current folder", async (t) => {
  const dir = workspace(t);
  const project = path.join(dir, "my app");
  const script = path.join(project, "hello.mjs");
  const requests = [];
  const run = (name, args) => executeTool(name, args, dir, async (action) => { requests.push(action); return true; }, { mode: "cmds" });
  assert.equal((await run("write_file", { path: script, content: 'import fs from "node:fs"; fs.writeFileSync("result.txt", "hello"); console.log("hello");' })).ok, true);
  assert.equal((await run("edit_file", { path: script, old_text: '"hello"', new_text: '"program verified"', replace_all: true })).ok, true);
  const result = await run("run_command", { command: `${node} hello.mjs`, cwd: project });
  assert.equal(result.ok, true, result.output);
  assert.match(result.output, /program verified/);
  assert.match(result.output, /Exit code: 0/);
  assert.equal((await run("read_file", { path: path.join(project, "result.txt") })).output, "program verified");
  assert.equal(requests.length, 3, "reads need no extra approval");
  assert.match(requests[2], /my app/);
});

test("move never overwrites an existing destination; permanent deletion needs explicit args and permission", async (t) => {
  const dir = workspace(t);
  fs.writeFileSync(path.join(dir, "a"), "a"); fs.writeFileSync(path.join(dir, "b"), "b");
  assert.equal((await approved("move_file", { from: "a", to: "b" }, dir)).ok, false);
  assert.equal(fs.readFileSync(path.join(dir, "b"), "utf8"), "b");
  assert.equal((await approved("delete_file", { path: "a", permanent: true }, dir)).ok, true);
  assert.equal(fs.existsSync(path.join(dir, "a")), false);
});

test("desktop helpers work as ESM and trash failure preserves files", { skip: process.platform !== "linux" }, async (t) => {
  const dir = workspace(t);
  const oldPath = process.env.PATH;
  const clipFile = path.join(dir, "clipboard.txt");
  fs.writeFileSync(path.join(dir, "wl-copy"), `#!/bin/sh\n/bin/cat > '${clipFile}'\n`, { mode: 0o700 });
  fs.writeFileSync(path.join(dir, "wl-paste"), `#!/bin/sh\n/bin/cat '${clipFile}'\n`, { mode: 0o700 });
  fs.writeFileSync(path.join(dir, "gio"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  fs.writeFileSync(path.join(dir, "keep.txt"), "keep");
  process.env.PATH = dir;
  try {
    const text = 'quotes " and $(echo do-not-execute)\nsecond line';
    assert.equal((await approved("clipboard", { action: "write", text }, dir)).ok, true);
    // /bin/sh is used explicitly for the fixture because PATH deliberately excludes system tools.
    fs.symlinkSync("/bin/sh", path.join(dir, "sh"));
    assert.equal((await executeTool("clipboard", { action: "read" }, dir)).output, text);
    const result = await approved("delete_file", { path: "keep.txt" }, dir);
    assert.equal(result.ok, false); assert.match(result.output, /preserved/);
    assert.equal(fs.readFileSync(path.join(dir, "keep.txt"), "utf8"), "keep");
    const launch = await approved("launch_app", { target: "no-such-unjailed-app" }, dir);
    assert.equal(launch.ok, false); assert.match(launch.output, /Launch failed/);
  } finally { process.env.PATH = oldPath; }
});

test("foreground commands report failure, bound output, validate timeouts and stop on timeout", async (t) => {
  const dir = workspace(t);
  fs.writeFileSync(path.join(dir, "fail.mjs"), 'console.error("expected failure"); process.exit(7)');
  const failed = await approved("run_command", { command: `${node} fail.mjs` }, dir);
  assert.equal(failed.ok, false); assert.match(failed.output, /Exit code: 7/);
  fs.writeFileSync(path.join(dir, "output.mjs"), 'console.log("x".repeat(400000)); console.log("END")');
  const output = await approved("run_command", { command: `${node} output.mjs` }, dir);
  assert.equal(output.ok, true); assert.ok(output.output.length < 30_000); assert.match(output.output, /END/);
  assert.equal((await approved("run_command", { command: "echo no", timeout_ms: 0 }, dir)).ok, false);
  fs.writeFileSync(path.join(dir, "hang.mjs"), 'setInterval(() => {}, 1000)');
  const timedOut = await approved("run_command", { command: `${node} hang.mjs`, timeout_ms: 100 }, dir);
  assert.equal(timedOut.ok, false); assert.match(timedOut.output, /Timed out/);
});

test("aborting a command kills its child program before delayed disk mutation", async (t) => {
  const dir = workspace(t);
  fs.writeFileSync(path.join(dir, "delayed.mjs"), 'import fs from "node:fs"; console.log("ready"); setTimeout(() => fs.writeFileSync("unexpected", "bad"), 900)');
  const controller = new AbortController();
  const pending = approved("run_command", { command: `${node} delayed.mjs` }, dir, { signal: controller.signal });
  setTimeout(() => controller.abort(), 150);
  const result = await pending;
  assert.equal(result.ok, false); assert.match(result.output, /cancelled/i);
  await sleep(1000);
  assert.equal(fs.existsSync(path.join(dir, "unexpected")), false);
});

test("background jobs expose output/status, bound logs, and support permissioned stop", async (t) => {
  const dir = workspace(t);
  fs.writeFileSync(path.join(dir, "server.mjs"), 'console.log("x".repeat(200000)); console.log("SERVER READY"); setInterval(() => {}, 1000)');
  const result = await approved("run_command", { command: `${node} server.mjs`, background: true }, dir);
  assert.equal(result.ok, true, result.output);
  const jobId = result.output.match(/Job ID: ([\w-]+)/)?.[1];
  assert.ok(jobId);
  try {
    let status;
    for (let i = 0; i < 30; i++) {
      status = await executeTool("process_status", { job_id: jobId }, dir);
      if (status.output.includes("SERVER READY")) break;
      await sleep(30);
    }
    assert.match(status.output, /running/); assert.match(status.output, /SERVER READY/);
    const log = fs.readdirSync(path.join(dir, ".unjailed"))[0];
    assert.ok(fs.statSync(path.join(dir, ".unjailed", log)).size <= 100_000);
    assert.equal((await executeTool("stop_process", { job_id: jobId }, dir, async () => false, { mode: "cmds" })).ok, false);
    assert.match((await executeTool("process_status", { job_id: jobId }, dir)).output, /running/);
  } finally { assert.equal((await approved("stop_process", { job_id: jobId }, dir)).ok, true); }
  assert.doesNotMatch((await executeTool("process_status", { job_id: jobId }, dir)).output, /: running/);
  assert.equal((await approved("stop_process", { job_id: String(process.pid) }, dir)).ok, false);
});

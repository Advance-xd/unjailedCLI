// Runs in its own process so UNJAILED_TIMEOUT is read at import time.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.UNJAILED_TIMEOUT = "1";
const { listModels, ApiError } = await import("../dist/api.js");

test("hung server produces a timeout message", async () => {
  const server = http.createServer(() => {}).listen(0);
  const port = server.address().port;
  try {
    await assert.rejects(listModels(`http://localhost:${port}/v1`, "k"), (e) => e instanceof ApiError && /Timed out/.test(e.message));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

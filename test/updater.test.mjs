import test from "node:test";
import assert from "node:assert/strict";
import { selectUpdateVersion } from "../dist/updater.js";

test("updater reaches newer releases and never follows a stale tag backwards", () => {
  assert.equal(selectUpdateVersion("0.12.0", "0.12.0", "0.13.0"), "0.13.0");
  assert.equal(selectUpdateVersion("0.11.2", "0.12.0", "0.11.2"), "0.12.0");
  assert.equal(selectUpdateVersion("0.14.0", "0.12.0", "0.13.0"), "0.14.0");
  assert.equal(selectUpdateVersion("0.12.9", "0.12.0", "0.12.10"), "0.12.10");
});

test("updater safely falls back on failed or malformed registry responses", () => {
  for (const latest of [null, "", "latest", "0.15.0 && echo bad", "0.15.0\n", "01.2.3", "1.0.0-01"]) {
    assert.equal(selectUpdateVersion("0.14.0", "0.12.0", latest), "0.14.0");
    assert.equal(selectUpdateVersion("0.11.2", "0.12.0", latest), "0.12.0");
  }
});

test("updater respects semver prerelease precedence and build metadata", () => {
  assert.equal(selectUpdateVersion("0.13.0-beta.10", "0.12.0", "0.13.0-beta.2"), "0.13.0-beta.10");
  assert.equal(selectUpdateVersion("0.13.0-beta.10", "0.12.0", "0.13.0"), "0.13.0");
  assert.equal(selectUpdateVersion("0.13.0+build.4", "0.12.0", "0.12.1"), "0.13.0+build.4");
});

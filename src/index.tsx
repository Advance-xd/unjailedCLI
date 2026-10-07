#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./ui/App.js";
import { VERSION } from "./constants.js";
import { configPath } from "./config.js";

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Unjailed AI ${VERSION} — chat with Unjailed AI in your terminal

Usage
  unjailed            start a chat session (type /login first)

Options
  -v, --version       print the version
  -h, --help          show this help

Environment
  UNJAILED_API_KEY    API key (overrides the saved key)
  UNJAILED_BASE_URL   API base URL
  UNJAILED_MODEL      model to start with
  UNJAILED_HOME       config directory (default ~/.unjailed)
  NO_COLOR            disable colors

Config: ${configPath()}`);
  process.exit(0);
}

if (!process.stdin.isTTY) {
  console.error("unjailed is interactive and needs a terminal (stdin is not a TTY).");
  process.exit(1);
}

const app = render(<App />, { exitOnCtrlC: false, kittyKeyboard: { mode: "auto" } });
await app.waitUntilExit();
process.exit(0);

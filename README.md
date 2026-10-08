<p align="center"><img src="logo.svg" width="96" alt="Unjailed AI"></p>

<h1 align="center">Unjailed CLI</h1>

<p align="center">Chat with <a href="https://unjailedai.com">Unjailed AI</a> from your terminal. It streams responses, renders markdown, and sends no telemetry.</p>

## Install

<!-- install:start -->

### macOS and Linux

```sh
curl -fsSL https://unjailedai.com/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://unjailedai.com/install.ps1 | iex
```

### npm (any OS)

```sh
npm install -g unjailed
```

You need **Node.js 20 or newer**. The install scripts check your Node version and then run `npm install -g unjailed` for you.

<!-- install:end -->

## Quick start

```sh
unjailed
```

Then type `/login` and paste your API key. You can get a key at [unjailedai.com/dashboard](https://unjailedai.com/dashboard). Once you're logged in, start chatting.

## Commands

Type `/` to open the command menu. Use ↑/↓ to move, Enter or Tab to select, and Esc to close.

| Command | What it does |
|---|---|
| `/login` | Paste your API key (input is masked). The key is checked against the API before it's saved. |
| `/logout` | Remove the saved API key. |
| `/model` | Pick a model from the live list. The current model is marked. Your chat history is kept when you switch, and your choice is remembered. |
| `/model <id>` | Switch straight to a model by its id. |
| `/api` | Show the base URL, masked key and current model, and run a live connection check. |
| `/clear` | Clear the conversation and the screen. |
| `/help` | List commands and keyboard shortcuts. |
| `/exit` | Quit. Ctrl+C twice or Ctrl+D also works. |

## Keys

| Key | Action |
|---|---|
| Enter | Send |
| Shift+Enter, or `\` then Enter | New line. Alt+Enter and Ctrl+J also work, for terminals that don't report Shift+Enter. |
| ↑ / ↓ | Step through your previous inputs |
| Paste | Multi-line pastes stay in the input box; they're never sent until you press Enter |
| Esc | Stop the response; close menus |
| Ctrl+C | Stops the response while one is streaming. Otherwise clears the input; press it twice to exit. |
| Ctrl+D | Exit |

## Environment variables

| Variable | Purpose |
|---|---|
| `UNJAILED_API_KEY` | API key. Takes priority over the saved key. |
| `UNJAILED_BASE_URL` | API base URL (default `https://unjailedai.com/v1`) |
| `UNJAILED_MODEL` | Model to start with |
| `UNJAILED_HOME` | Config directory (default `~/.unjailed`) |
| `UNJAILED_TIMEOUT` | Request timeout in seconds (default 30) |
| `NO_COLOR` | Turn off colors |

## Config location

| OS | Path |
|---|---|
| macOS / Linux | `~/.unjailed/config.json` (permissions `600`) |
| Windows | `%USERPROFILE%\.unjailed\config.json` |

The file holds `apiKey`, `model` and an optional `baseUrl`. Delete it to reset everything. The CLI never prints your full key; it shows the key masked, for example `sk-…a1b2`.

## Privacy

The CLI sends no telemetry and no analytics, and makes no requests other than the API calls you trigger. Your conversation lives in memory only and disappears when you exit.

## Development

```sh
npm install
npm run build     # compile TypeScript to dist/
npm run mock      # local mock API on http://localhost:8787/v1 (key: sk-mock-test-a1b2)
UNJAILED_BASE_URL=http://localhost:8787/v1 UNJAILED_HOME=./.dev node dist/index.js
npm test          # unit + integration tests against the mock
```

Put `ratelimit`, `servererror`, `credit`, `slow`, `hang`, `reason`, `markdown` or `longcode` in a chat message to make the mock server return that behavior.

The default API URL is set in `src/constants.ts` (`DEFAULT_BASE_URL`).

## License

MIT · [github.com/unjailedai/unjailedCLI](https://github.com/unjailedai/unjailedCLI)

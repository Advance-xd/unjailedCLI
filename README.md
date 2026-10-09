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
| `/effort` | Set reasoning effort: `auto` (default; the model decides), `low`, `medium` or `high`. `/effort high` sets it directly. Remembered between runs. |
| `/skills` | Switch skills on or off for this chat (Space toggles). `/skills <name>` toggles one; `/skills new <name>` creates one. |
| `/tools` | Agent tools. No argument: the model can read files and list directories. `cmds` adds run_command (it asks before each run), `yolo` skips asking, `off` disables. |
| `/api` | Show the base URL, masked key and current model, and run a live connection check. |
| `/update` | Update the CLI to the latest version from npm. |
| `/auto` (`/bypass`) | Auto-approve tool calls — the agent stops asking and just works. `/auto off` restores confirmations. |
| `/plan` | Plan mode: before writing files or running commands, the agent shows a numbered plan — Enter approves, Esc rejects. `/plan off` disables. |
| `/resume` | Pick up a previous chat from the current folder. `/resume 2` or `/resume <id>` jumps straight to one. |
| `/sessions` | Browse saved chats from every folder: resume one, or press `d` to delete it. |
| `/clear` | Start a new chat and clear the screen. The previous chat stays saved. |
| `/help` | List commands and keyboard shortcuts. |
| `/exit` | Quit. Ctrl+C twice or Ctrl+D also works. |

## Sessions

Chats are saved automatically after each reply, tagged with the folder you started `unjailed` in, so each project keeps its own history.

```sh
unjailed -c     # continue the most recent chat in this folder
unjailed -r     # choose a saved chat to resume
```

Inside the app, `/resume` lists this folder's chats and `/sessions` lists all of them. Sessions are stored as JSON in `~/.unjailed/sessions/` (permissions `600`); the newest 200 are kept. To turn saving off, set `UNJAILED_NO_HISTORY=1` or put `"saveSessions": false` in `config.json`.

## Skills

A skill is a markdown file of instructions the model follows while it's switched on: a coding style, a review checklist, a persona, house rules for a project.

| Where | Applies to |
|---|---|
| `./.unjailed/skills/<name>/SKILL.md` or `./.unjailed/skills/<name>.md` | This project (wins if a name clashes) |
| `~/.unjailed/skills/<name>/SKILL.md` or `~/.unjailed/skills/<name>.md` | Every folder |

```markdown
---
name: reviewer
description: Strict code review
---
Review code like a senior engineer. List bugs first, then style.
```

Switched-on skills are sent as a system message with each request and re-read from disk every time, so edits apply straight away. Saved chats remember which skills were on, and `/resume` switches them back on.

## Agent tools

`/tools` gives the model hands: it can read files and list directories on your
machine, and answer using what it finds. It works the same on Linux, macOS and
Windows.

| Mode | What the model can do |
|---|---|
| `/tools` | **Read-only:** read files, list directories, glob-find files, grep contents, open urls in your browser, fetch web pages |
| `/tools cmds` | **+ write:** write files, edit files, run shell commands — you confirm each command with `y` |
| `/tools yolo` | Same as `cmds`, commands run without confirmation |
| `/tools off` | Plain chat (default) |

The toolkit:

| Tool | What it does |
|---|---|
| `read_file` | Read a file (200 KB cap) |
| `list_dir` | List a directory |
| `glob` | Find files by name pattern (`**/*.ts`) |
| `grep` | Search file contents, regex, file:line results |
| `open_url` | Open a url in your default browser |
| `web_fetch` | Fetch a page/API and read it as text |
| `write_file` | Create or overwrite a file (cmds/yolo) |
| `edit_file` | Exact string replace in a file (cmds/yolo) |
| `run_command` | Shell with a 2-minute timeout (cmds/yolo) |

Commands run through `cmd /c` on Windows and `/bin/sh -c` elsewhere, with a
10-minute timeout (long enough for downloads, builds and server installs) and a
30 KB output cap. Long-running processes — game servers, daemons — take
`background: true` and run detached, logging to `.unjailed/bg-*.log`. The choice is saved in your config and
shown in the status line.

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
| `UNJAILED_NO_HISTORY` | Set to `1` to stop saving chats (disables `/resume`) |
| `NO_COLOR` | Turn off colors |

## Config location

| OS | Path |
|---|---|
| macOS / Linux | `~/.unjailed/config.json` (permissions `600`) |
| Windows | `%USERPROFILE%\.unjailed\config.json` |

The file holds `apiKey`, `model`, an optional `baseUrl` and an optional `saveSessions`. Saved chats live next to it in `sessions/`. Delete it to reset everything. The CLI never prints your full key; it shows the key masked, for example `sk-…a1b2`.

## Privacy

The CLI sends no telemetry and no analytics, and makes no requests other than the API calls you trigger. Saved chats stay on your machine in `~/.unjailed/sessions/` and are never uploaded; delete them with `/sessions` → `d`, delete the folder, or turn saving off with `UNJAILED_NO_HISTORY=1`.

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

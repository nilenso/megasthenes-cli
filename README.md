# megasthenes-cli

A CLI for [megasthenes](https://github.com/nilenso/megasthenes).

```bash
megasthenes ask --repo https://github.com/owner/repo --question "What does this project do?"
```

See the [megasthenes documentation](https://nilenso.github.io/megasthenes/) for the library this CLI wraps.

## Install

Requires **Node.js ≥ 18** and `git`, `ripgrep`, `fd` on `PATH`.

```bash
# macOS
brew install git ripgrep fd

# Debian / Ubuntu (fd binary may be `fdfind`)
sudo apt install git ripgrep fd-find
```

```bash
npm install -g megasthenes-cli
```

This puts a `megasthenes` executable on your `PATH` (the npm package is `megasthenes-cli`; the installed command is `megasthenes`).

Or run one-off without installing:

```bash
npx megasthenes-cli ask --repo <url> --question "<text>"
```

## Configure

Set the env var for your LLM provider:

| Provider   | Env var                |
| ---------- | ---------------------- |
| OpenRouter | `OPENROUTER_API_KEY`   |
| Anthropic  | `ANTHROPIC_API_KEY`    |
| OpenAI     | `OPENAI_API_KEY`       |
| Google     | `GOOGLE_CLOUD_API_KEY` |

Optional defaults:

```bash
export MEGASTHENES_PROVIDER=openrouter
export MEGASTHENES_MODEL=anthropic/claude-sonnet-4.6
```

### Configuration file

Any CLI flag can also be set in a JSON file at `$XDG_CONFIG_HOME/megasthenes/config.json` (defaults to `~/.config/megasthenes/config.json`). Override the path with the `MEGASTHENES_CONFIG` env var. Keys are the camelCase form of the flag names.

```json
{
  "provider": "openrouter",
  "model": "anthropic/claude-sonnet-4.6",
  "maxIterations": 8,
  "thinkingEffort": "medium",
  "sandboxBaseUrl": "http://localhost:8080",
  "sandboxTimeoutMs": 60000
}
```

Precedence (highest → lowest): CLI flags > env vars > config file > built-in defaults.

## Usage

```bash
megasthenes ask --repo <url> --question "<text>" [options]
# Positional shortcut (unquoted words after the URL are joined):
megasthenes ask <repo-url> "<question>" [options]
```

```bash
# Pick a provider and model
megasthenes ask --repo https://github.com/owner/repo --question "Audit error handling." \
  --provider anthropic --model claude-sonnet-4-6

# Pin to a tag, stream tool calls to stderr
megasthenes ask --repo https://github.com/owner/repo --question "Summarize the data model." \
  --commitish v2.3.0 --verbose

# JSON output for jq
megasthenes ask --repo https://github.com/owner/repo --question "List public APIs." --json \
  | jq '.usage, .metadata.latencyMs'
```

Run `megasthenes ask --help` for the full reference.

### Sandboxed execution

For untrusted repositories, run tool execution in an isolated container. Stand up the sandbox worker following the [Sandboxed Execution guide](https://nilenso.github.io/megasthenes/guides/sandbox/), then point the CLI at it:

```bash
megasthenes ask --repo https://github.com/random/untrusted --question "What does this build script do?" \
  --sandbox-base-url http://localhost:8080 --sandbox-secret "$SANDBOX_SECRET"
```

## Exit codes

| Code | Meaning                                               |
| ---- | ----------------------------------------------------- |
| 0    | success                                               |
| 1    | `internal_error`                                      |
| 2    | `max_iterations` (gave up before producing an answer) |
| 3    | `context_overflow`                                    |
| 4    | `provider_error` / `network_error` / `empty_response` |
| 64   | invalid CLI usage                                     |
| 130  | aborted (Ctrl-C)                                      |

## Development

```bash
git clone https://github.com/nilenso/megasthenes-cli
cd megasthenes-cli
npm install
npm test
npm run typecheck
npm run build         # produces dist/cli/index.js
```

## License

MIT © nilenso

# megasthenes-cli

Terminal CLI for [megasthenes](https://github.com/nilenso/megasthenes) — ask natural-language questions about any GitHub or GitLab repository and get a markdown-rendered, source-cited answer.

```bash
megasthenes ask https://github.com/owner/repo "What does this project do?"
```

## Install

### Prerequisites

- **Node.js ≥ 18** (or Bun)
- System tools: `git`, `ripgrep` (`rg`), `fd`

```bash
# macOS
brew install git ripgrep fd

# Debian / Ubuntu
sudo apt install git ripgrep fd-find       # (binary may be named `fdfind`)

# Arch
sudo pacman -S git ripgrep fd
```

### Global install (recommended)

```bash
npm  install -g megasthenes-cli
# or
bun  add    -g megasthenes-cli
# or
pnpm add    -g megasthenes-cli
# or
yarn global add megasthenes-cli
```

This puts a `megasthenes` binary on your `PATH`. Verify:

```bash
megasthenes --help
megasthenes ask --help
```

### One-off via npx / bunx (no install)

```bash
npx  megasthenes-cli ask <repo> "<question>"
bunx megasthenes-cli ask <repo> "<question>"
```

### Upgrade / uninstall

```bash
npm install -g megasthenes-cli@latest
npm uninstall -g megasthenes-cli
```

## Configure your API key

Set the env var matching the LLM provider you want to use:

| Provider     | Env var               |
| ------------ | --------------------- |
| OpenRouter   | `OPENROUTER_API_KEY`  |
| Anthropic    | `ANTHROPIC_API_KEY`   |
| OpenAI       | `OPENAI_API_KEY`      |
| Google       | `GOOGLE_CLOUD_API_KEY`|
| Groq         | `GROQ_API_KEY`        |
| xAI          | `XAI_API_KEY`         |
| Cerebras     | `CEREBRAS_API_KEY`    |

```bash
export OPENROUTER_API_KEY=sk-or-v1-…
```

## Usage

```bash
megasthenes ask <repo-url> "<question>" [options]
```

Examples:

```bash
# Default provider/model
megasthenes ask https://github.com/owner/repo "Where are feature flags defined?"

# Pick a provider and model
megasthenes ask https://github.com/owner/repo "Audit error handling." \
  --provider anthropic --model claude-sonnet-4-6

# Pin to a tag and stream tool calls to stderr
megasthenes ask https://github.com/owner/repo "Summarize the data model." \
  --commitish v2.3.0 --verbose

# Use a sandbox worker for untrusted repos
megasthenes ask https://github.com/random/untrusted "What does this build script do?" \
  --sandbox-base-url http://localhost:8080 --sandbox-secret "$SANDBOX_SECRET"

# JSON output for piping into jq
megasthenes ask https://github.com/owner/repo "List public APIs." --json \
  | jq '.usage, .metadata.latencyMs'
```

You can set defaults via env vars to keep invocations short:

```bash
export MEGASTHENES_PROVIDER=openrouter
export MEGASTHENES_MODEL=anthropic/claude-sonnet-4.6

megasthenes ask https://github.com/owner/repo "What frameworks does this use?"
```

Run `megasthenes ask --help` for the full reference.

## Exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| 0    | success                                              |
| 1    | `internal_error`                                     |
| 2    | `max_iterations` (gave up before producing an answer)|
| 3    | `context_overflow`                                   |
| 4    | `provider_error` / `network_error` / `empty_response`|
| 64   | invalid CLI usage                                    |
| 130  | aborted (Ctrl-C)                                     |

## Development

```bash
git clone https://github.com/nilenso/megasthenes-cli
cd megasthenes-cli
bun install
bun test
bun run typecheck
bun run build         # produces dist/cli/index.js
```

## License

MIT © nilenso

# megasthenes-cli

Terminal CLI for [megasthenes](https://github.com/nilenso/megasthenes) — ask natural-language questions about any GitHub or GitLab repository and get a markdown-rendered, source-cited answer.

```bash
megasthenes ask https://github.com/owner/repo "What does this project do?"
```

See the [megasthenes documentation](https://nilenso.github.io/megasthenes/) for the library this CLI wraps.

## Install

Requires **Node.js ≥ 18** (or Bun) and `git`, `ripgrep`, `fd` on `PATH`.

```bash
# macOS
brew install git ripgrep fd

# Debian / Ubuntu (fd binary may be `fdfind`)
sudo apt install git ripgrep fd-find

# Arch
sudo pacman -S git ripgrep fd
```

```bash
npm install -g megasthenes-cli     # or: bun add -g, pnpm add -g, yarn global add
```

Or run one-off without installing:

```bash
npx megasthenes-cli ask <repo> "<question>"
```

## Configure

Set the env var for your LLM provider:

| Provider   | Env var                |
| ---------- | ---------------------- |
| OpenRouter | `OPENROUTER_API_KEY`   |
| Anthropic  | `ANTHROPIC_API_KEY`    |
| OpenAI     | `OPENAI_API_KEY`       |
| Google     | `GOOGLE_CLOUD_API_KEY` |
| Groq       | `GROQ_API_KEY`         |
| xAI        | `XAI_API_KEY`          |
| Cerebras   | `CEREBRAS_API_KEY`     |

Optional defaults:

```bash
export MEGASTHENES_PROVIDER=openrouter
export MEGASTHENES_MODEL=anthropic/claude-sonnet-4.6
```

## Usage

```bash
megasthenes ask <repo-url> "<question>" [options]
```

```bash
# Pick a provider and model
megasthenes ask https://github.com/owner/repo "Audit error handling." \
  --provider anthropic --model claude-sonnet-4-6

# Pin to a tag, stream tool calls to stderr
megasthenes ask https://github.com/owner/repo "Summarize the data model." \
  --commitish v2.3.0 --verbose

# JSON output for jq
megasthenes ask https://github.com/owner/repo "List public APIs." --json \
  | jq '.usage, .metadata.latencyMs'
```

Run `megasthenes ask --help` for the full reference.

### Sandboxed execution

For untrusted repositories, run tool execution in an isolated container. Stand up the sandbox worker following the [Sandboxed Execution guide](https://nilenso.github.io/megasthenes/guides/sandbox/), then point the CLI at it:

```bash
megasthenes ask https://github.com/random/untrusted "What does this build script do?" \
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
bun install
bun test
bun run typecheck
bun run build         # produces dist/cli/index.js
```

## License

MIT © nilenso

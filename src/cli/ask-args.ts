/**
 * CLI argument parser and help text for `megasthenes ask`.
 *
 * Parses argv into a flat ParsedArgs record. Validation that depends on the
 * library's typed config (e.g. ThinkingConfig union shape) lives in
 * ask-config.ts.
 */

export interface ParsedArgs {
	repo?: string;
	question?: string;

	// Repo
	token?: string;
	commitish?: string;

	// Model
	provider?: string;
	model?: string;
	maxIterations?: number;
	systemPrompt?: string;
	systemPromptFile?: string;

	// Thinking
	thinking?: "adaptive";
	thinkingEffort?: "low" | "medium" | "high";

	// Sandbox
	sandboxBaseUrl?: string;
	sandboxTimeoutMs?: number;
	sandboxSecret?: string;

	// Tracing
	tracingEndpoint?: string;

	// Output
	verbose: boolean;
	json: boolean;
	help: boolean;
}

export class ArgParseError extends Error {}

export function parseAskArgs(argv: readonly string[]): ParsedArgs {
	const out: ParsedArgs = { verbose: false, json: false, help: false };
	const positionals: string[] = [];

	const need = (flag: string, value: string | undefined): string => {
		if (value === undefined) throw new ArgParseError(`${flag} requires a value`);
		return value;
	};

	const intArg = (flag: string, raw: string): number => {
		const n = Number.parseInt(raw, 10);
		if (!Number.isFinite(n) || n <= 0) {
			throw new ArgParseError(`${flag} expects a positive integer, got "${raw}"`);
		}
		return n;
	};

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;

		// Long flags with `=value`
		const eq = a.startsWith("--") ? a.indexOf("=") : -1;
		const flag = eq >= 0 ? a.slice(0, eq) : a;
		const inlineValue = eq >= 0 ? a.slice(eq + 1) : undefined;
		const consume = (): string => need(flag, inlineValue ?? argv[++i]);

		switch (flag) {
			case "-h":
			case "--help":
				out.help = true;
				break;

			case "--token":
				out.token = consume();
				break;
			case "--commitish":
				out.commitish = consume();
				break;

			case "--provider":
				out.provider = consume();
				break;
			case "--model":
				out.model = consume();
				break;
			case "--max-iterations":
				out.maxIterations = intArg(flag, consume());
				break;
			case "--system-prompt":
				out.systemPrompt = consume();
				break;
			case "--system-prompt-file":
				out.systemPromptFile = consume();
				break;

			case "--thinking": {
				const v = consume();
				if (v !== "adaptive") {
					throw new ArgParseError(`--thinking only accepts "adaptive", got "${v}"`);
				}
				out.thinking = "adaptive";
				break;
			}
			case "--thinking-effort": {
				const v = consume();
				if (v !== "low" && v !== "medium" && v !== "high") {
					throw new ArgParseError(`--thinking-effort expects low|medium|high, got "${v}"`);
				}
				out.thinkingEffort = v;
				break;
			}

			case "--sandbox-base-url":
				out.sandboxBaseUrl = consume();
				break;
			case "--sandbox-timeout-ms":
				out.sandboxTimeoutMs = intArg(flag, consume());
				break;
			case "--sandbox-secret":
				out.sandboxSecret = consume();
				break;

			case "--tracing-endpoint":
				out.tracingEndpoint = consume();
				break;

			case "--verbose":
				out.verbose = true;
				break;
			case "--json":
				out.json = true;
				break;

			default:
				if (a.startsWith("-")) throw new ArgParseError(`Unknown option: ${a}`);
				positionals.push(a);
		}
	}

	if (positionals.length >= 1) out.repo = positionals[0];
	if (positionals.length >= 2) out.question = positionals.slice(1).join(" ");
	if (positionals.length > 2 && !positionals.slice(1).some((p) => p.includes(" "))) {
		// Joined multiple bare words into a question — fine. (Quoting is recommended in --help.)
	}

	return out;
}

export const ASK_HELP = `megasthenes ask — Ask a question about a Git repository and print the answer as markdown.

Usage:
  megasthenes ask <repo> <question> [options]

Arguments:
  <repo>          Repository URL (GitHub or GitLab; forge auto-detected).
  <question>      The question to ask, in plain language. Quote it.

Repo options:
  --token <t>                   Auth token for private repositories.
  --commitish <ref>             Branch, tag, or SHA to query. Defaults to HEAD.

Model options:
  --provider <name>             LLM provider (e.g. anthropic, openrouter, google).
  --model <id>                  Model identifier (e.g. claude-sonnet-4-6).
  --max-iterations <n>          Max tool-use iterations per turn.
  --system-prompt <s>           Inline system prompt override.
  --system-prompt-file <path>   Read the system prompt from a file.

Thinking options:
  --thinking adaptive           Use adaptive thinking (Anthropic 4.6 only). Default: effort mode.
  --thinking-effort <level>     low | medium | high. Default: medium.

Sandbox options:
  --sandbox-base-url <url>      Enable sandbox mode and point at this worker URL.
  --sandbox-timeout-ms <ms>     Per-request timeout for sandbox calls.
  --sandbox-secret <s>          Shared secret for sandbox auth.

Tracing options:
  --tracing-endpoint <url>      OTLP/HTTP traces endpoint (e.g. Arize Phoenix at
                                http://localhost:6006). The path "/v1/traces" is
                                appended automatically if omitted.

Output options:
  --verbose                     Stream tool calls, iteration starts, and errors to stderr.
  --json                        Emit the full TurnResult as JSON to stdout instead of markdown.
  -h, --help                    Show this help and exit.

Configuration file:
  User defaults for any of the flags above can be set in a JSON file at
  $XDG_CONFIG_HOME/megasthenes/config.json (defaults to
  ~/.config/megasthenes/config.json). Keys are camelCase versions of the flag
  names (e.g. "maxIterations", "sandboxBaseUrl"). Override the path with the
  MEGASTHENES_CONFIG env var. Precedence: CLI flags > env vars > config file
  > built-in defaults.

Environment:
  Configuration defaults (CLI flags always win):
    MEGASTHENES_PROVIDER     Default LLM provider when --provider is omitted.
                             e.g. MEGASTHENES_PROVIDER=openrouter
    MEGASTHENES_MODEL        Default model id when --model is omitted.
                             e.g. MEGASTHENES_MODEL=anthropic/claude-sonnet-4.6
    MEGASTHENES_CONFIG       Path to a JSON config file (see above).

  Provider API keys (read by the underlying pi-ai SDK; set the one matching
  your --provider):
    ANTHROPIC_API_KEY        Anthropic direct.         e.g. sk-ant-api03-…
    OPENROUTER_API_KEY       OpenRouter (multi-model). e.g. sk-or-v1-…
    OPENAI_API_KEY           OpenAI direct.            e.g. sk-proj-…
    GOOGLE_CLOUD_API_KEY     Google Gemini.            e.g. AIzaSy…
    GROQ_API_KEY             Groq.                     e.g. gsk_…
    XAI_API_KEY              xAI (Grok).               e.g. xai-…
    CEREBRAS_API_KEY         Cerebras.                 e.g. csk-…

Exit codes:
  0  success
  1  internal_error
  2  max_iterations
  3  context_overflow
  4  provider_error / network_error / empty_response
  64  invalid CLI usage
  130 aborted (Ctrl-C)
`;

export const TOP_HELP = `Usage: megasthenes <command>

Commands:
  ask            Ask a question about a Git repository (see 'megasthenes ask --help')

Options:
  --help, -h     Show this help message
`;

/**
 * Resolves ParsedArgs + environment variables + user config file + library
 * defaults into typed ClientConfig / SessionConfig / AskOptions ready to hand
 * to the library.
 *
 * Precedence (highest to lowest): CLI flags > env vars > config file >
 * built-in defaults. Config file lives at
 * $XDG_CONFIG_HOME/megasthenes/config.json (defaults to
 * ~/.config/megasthenes/config.json); override with MEGASTHENES_CONFIG.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AskOptions,
	type ClientConfig,
	type ModelConfig,
	type SandboxClientConfig,
	type SessionConfig,
	type ThinkingConfig,
	nullLogger,
} from "@nilenso/megasthenes";
import { ArgParseError, type ParsedArgs } from "./ask-args.ts";

export interface ResolvedConfig {
	clientConfig: ClientConfig;
	sessionConfig: SessionConfig;
	askOptions: AskOptions;
	question: string;
	verbose: boolean;
	json: boolean;
	tracingEndpoint?: string;
}

export type FileConfig = Partial<
	Pick<
		ParsedArgs,
		| "provider"
		| "model"
		| "maxIterations"
		| "verbose"
		| "json"
		| "token"
		| "commitish"
		| "systemPrompt"
		| "systemPromptFile"
		| "thinking"
		| "thinkingEffort"
		| "sandboxBaseUrl"
		| "sandboxTimeoutMs"
		| "sandboxSecret"
		| "tracingEndpoint"
	>
>;

const DEFAULT_PROVIDER = "openrouter";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const DEFAULT_MAX_ITERATIONS = 25;
const DEFAULT_THINKING_EFFORT: "low" | "medium" | "high" = "medium";

const ALLOWED_FILE_KEYS = [
	"provider",
	"model",
	"maxIterations",
	"verbose",
	"json",
	"token",
	"commitish",
	"systemPrompt",
	"systemPromptFile",
	"thinking",
	"thinkingEffort",
	"sandboxBaseUrl",
	"sandboxTimeoutMs",
	"sandboxSecret",
	"tracingEndpoint",
] as const;

export function defaultConfigPath(env: NodeJS.ProcessEnv): string | undefined {
	if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "megasthenes", "config.json");
	if (env.HOME) return join(env.HOME, ".config", "megasthenes", "config.json");
	return undefined;
}

export function loadFileConfig(env: NodeJS.ProcessEnv): FileConfig {
	const explicit = env.MEGASTHENES_CONFIG !== undefined;
	const path = env.MEGASTHENES_CONFIG ?? defaultConfigPath(env);
	if (path === undefined) return {};
	if (!existsSync(path)) {
		if (explicit) throw new ArgParseError(`Config file not found: ${path}`);
		return {};
	}
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ArgParseError(`Could not read config file ${path}: ${msg}`);
	}
	return parseFileConfig(raw, path);
}

export function parseFileConfig(raw: string, path: string): FileConfig {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ArgParseError(`Invalid JSON in ${path}: ${msg}`);
	}
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new ArgParseError(`Config file ${path} must be a JSON object`);
	}
	const obj = data as Record<string, unknown>;

	for (const k of Object.keys(obj)) {
		if (!(ALLOWED_FILE_KEYS as readonly string[]).includes(k)) {
			throw new ArgParseError(`${path}: unknown config key "${k}"`);
		}
	}

	const out: FileConfig = {};
	const rec = out as Record<string, unknown>;

	const setString = (k: (typeof ALLOWED_FILE_KEYS)[number]) => {
		const v = obj[k];
		if (v === undefined) return;
		if (typeof v !== "string") throw new ArgParseError(`${path}: "${k}" must be a string`);
		rec[k] = v;
	};
	const setBool = (k: (typeof ALLOWED_FILE_KEYS)[number]) => {
		const v = obj[k];
		if (v === undefined) return;
		if (typeof v !== "boolean") throw new ArgParseError(`${path}: "${k}" must be a boolean`);
		rec[k] = v;
	};
	const setPosInt = (k: (typeof ALLOWED_FILE_KEYS)[number]) => {
		const v = obj[k];
		if (v === undefined) return;
		if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
			throw new ArgParseError(`${path}: "${k}" must be a positive integer`);
		}
		rec[k] = v;
	};

	setString("provider");
	setString("model");
	setString("token");
	setString("commitish");
	setString("systemPrompt");
	setString("systemPromptFile");
	setString("sandboxBaseUrl");
	setString("sandboxSecret");
	setString("tracingEndpoint");
	setPosInt("maxIterations");
	setPosInt("sandboxTimeoutMs");
	setBool("verbose");
	setBool("json");

	if (obj.thinking !== undefined) {
		if (obj.thinking !== "adaptive") {
			throw new ArgParseError(`${path}: "thinking" must be "adaptive"`);
		}
		out.thinking = "adaptive";
	}
	if (obj.thinkingEffort !== undefined) {
		const v = obj.thinkingEffort;
		if (v !== "low" && v !== "medium" && v !== "high") {
			throw new ArgParseError(`${path}: "thinkingEffort" must be low|medium|high`);
		}
		out.thinkingEffort = v;
	}

	return out;
}

export function resolveConfig(
	args: ParsedArgs,
	env: NodeJS.ProcessEnv,
	file: FileConfig = loadFileConfig(env),
): ResolvedConfig {
	if (!args.repo) throw new ArgParseError("Missing <repo> argument.");
	if (!args.question) throw new ArgParseError("Missing <question> argument.");

	const provider = args.provider ?? env.MEGASTHENES_PROVIDER ?? file.provider ?? DEFAULT_PROVIDER;
	const model: ModelConfig = {
		provider,
		id: args.model ?? env.MEGASTHENES_MODEL ?? file.model ?? DEFAULT_MODEL,
	};

	const systemPrompt = resolveSystemPrompt(args, file);
	const thinking = resolveThinking(args, file);

	const token = args.token ?? file.token;
	const commitish = args.commitish ?? file.commitish;

	const sessionConfig: SessionConfig = {
		repo: {
			url: args.repo,
			...(token !== undefined ? { token } : {}),
			...(commitish !== undefined ? { commitish } : {}),
		},
		model,
		maxIterations: args.maxIterations ?? file.maxIterations ?? DEFAULT_MAX_ITERATIONS,
		...(systemPrompt !== undefined ? { systemPrompt } : {}),
		thinking,
	};

	const sandbox = resolveSandbox(args, file);
	// Always silence the library's internal logger. The CLI surfaces its own
	// curated output: clone progress via onProgress and turn stream events via
	// forwardEvent() in --verbose mode.
	const clientConfig: ClientConfig = {
		...(sandbox !== undefined ? { sandbox } : {}),
		logger: nullLogger,
	};

	const tracingEndpoint = args.tracingEndpoint ?? file.tracingEndpoint;

	return {
		clientConfig,
		sessionConfig,
		askOptions: {},
		question: args.question,
		verbose: args.verbose || (file.verbose ?? false),
		json: args.json || (file.json ?? false),
		...(tracingEndpoint !== undefined ? { tracingEndpoint } : {}),
	};
}

function resolveSystemPrompt(args: ParsedArgs, file: FileConfig): string | undefined {
	if (args.systemPrompt !== undefined && args.systemPromptFile !== undefined) {
		throw new ArgParseError("Pass at most one of --system-prompt or --system-prompt-file.");
	}
	if (args.systemPrompt !== undefined) return args.systemPrompt;
	const filePath = args.systemPromptFile ?? file.systemPromptFile;
	if (filePath !== undefined) {
		try {
			return readFileSync(filePath, "utf8");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new ArgParseError(`Could not read --system-prompt-file: ${msg}`);
		}
	}
	if (file.systemPrompt !== undefined) return file.systemPrompt;
	return undefined;
}

function resolveThinking(args: ParsedArgs, file: FileConfig): ThinkingConfig {
	const thinkingMode = args.thinking ?? file.thinking;
	const effort = args.thinkingEffort ?? file.thinkingEffort ?? DEFAULT_THINKING_EFFORT;
	if (thinkingMode === "adaptive") {
		return { type: "adaptive", effort };
	}
	return { effort };
}

function resolveSandbox(args: ParsedArgs, file: FileConfig): SandboxClientConfig | undefined {
	const baseUrl = args.sandboxBaseUrl ?? file.sandboxBaseUrl;
	const timeoutMs = args.sandboxTimeoutMs ?? file.sandboxTimeoutMs;
	const secret = args.sandboxSecret ?? file.sandboxSecret;
	if (baseUrl === undefined) {
		if (timeoutMs !== undefined || secret !== undefined) {
			throw new ArgParseError(
				"sandbox timeout-ms / secret require a sandbox base URL (CLI or config).",
			);
		}
		return undefined;
	}
	return {
		baseUrl,
		timeoutMs: timeoutMs ?? 60_000,
		...(secret !== undefined ? { secret } : {}),
	};
}

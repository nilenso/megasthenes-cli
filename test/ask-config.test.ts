import { describe, expect, it } from "bun:test";
import { ArgParseError, parseAskArgs } from "../src/cli/ask-args.ts";
import { resolveConfig } from "../src/cli/ask-config.ts";

const baseArgs = (extra: string[] = []) =>
	parseAskArgs(["https://github.com/o/r", "What is this?", ...extra]);

describe("resolveConfig", () => {
	it("falls back to env vars for provider and model", () => {
		const args = baseArgs();
		const r = resolveConfig(args, {
			MEGASTHENES_PROVIDER: "anthropic",
			MEGASTHENES_MODEL: "claude-sonnet-4-6",
		});
		expect(r.sessionConfig.model).toEqual({
			provider: "anthropic",
			id: "claude-sonnet-4-6",
		});
	});

	it("CLI flags override env vars", () => {
		const args = baseArgs(["--provider", "google", "--model", "gemini-2.5-pro"]);
		const r = resolveConfig(args, {
			MEGASTHENES_PROVIDER: "anthropic",
			MEGASTHENES_MODEL: "claude-sonnet-4-6",
		});
		expect(r.sessionConfig.model.provider).toBe("google");
		expect(r.sessionConfig.model.id).toBe("gemini-2.5-pro");
	});

	it("builds the effort thinking arm only when --thinking-effort is set", () => {
		const noThinking = resolveConfig(baseArgs(), {});
		expect(noThinking.sessionConfig.thinking).toBeUndefined();

		const effort = resolveConfig(baseArgs(["--thinking-effort", "high"]), {});
		expect(effort.sessionConfig.thinking).toEqual({ effort: "high" });
	});

	it("builds the adaptive thinking arm with default effort", () => {
		const r = resolveConfig(baseArgs(["--thinking", "adaptive"]), {});
		expect(r.sessionConfig.thinking).toEqual({ type: "adaptive", effort: "medium" });
	});

	it("combines --thinking adaptive with --thinking-effort", () => {
		const r = resolveConfig(
			baseArgs(["--thinking", "adaptive", "--thinking-effort", "low"]),
			{},
		);
		expect(r.sessionConfig.thinking).toEqual({ type: "adaptive", effort: "low" });
	});

	it("only enables sandbox when --sandbox-base-url is provided", () => {
		expect(resolveConfig(baseArgs(), {}).clientConfig.sandbox).toBeUndefined();
		const r = resolveConfig(
			baseArgs(["--sandbox-base-url", "http://localhost:8787", "--sandbox-secret", "s"]),
			{},
		);
		expect(r.clientConfig.sandbox).toEqual({
			baseUrl: "http://localhost:8787",
			timeoutMs: 60_000,
			secret: "s",
		});
	});

	it("rejects sandbox sub-options without a base URL", () => {
		expect(() =>
			resolveConfig(baseArgs(["--sandbox-secret", "s"]), {}),
		).toThrow(ArgParseError);
	});

	it("rejects mutually exclusive --system-prompt and --system-prompt-file", () => {
		expect(() =>
			resolveConfig(
				baseArgs(["--system-prompt", "x", "--system-prompt-file", "p.md"]),
				{},
			),
		).toThrow(ArgParseError);
	});

	it("requires repo and question", () => {
		const noRepo = parseAskArgs([]);
		expect(() => resolveConfig(noRepo, {})).toThrow(/<repo>/);
	});
});

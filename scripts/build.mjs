#!/usr/bin/env node
/**
 * Bundle the CLI into a single ESM file at `dist/cli/index.js`.
 *
 * Banner injects (a) the Node shebang so the output is directly executable,
 * and (b) a `createRequire`-backed `require` so bundled CommonJS deps that
 * call `require()` (like ajv's dynamic format loading) work under ESM —
 * without this they throw "Dynamic require of X is not supported" at runtime.
 * We chmod +x the output so local builds are runnable directly; npm sets the
 * mode itself on install via the `bin` field.
 */

import { chmodSync } from "node:fs";
import { build } from "esbuild";

const banner = [
	"#!/usr/bin/env node",
	'import { createRequire as __esmCreateRequire } from "node:module";',
	"const require = __esmCreateRequire(import.meta.url);",
].join("\n");

await build({
	entryPoints: ["src/cli/index.ts"],
	outfile: "dist/cli/index.js",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node18",
	minify: true,
	banner: { js: banner },
	logLevel: "info",
});

chmodSync("dist/cli/index.js", 0o755);

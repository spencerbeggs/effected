// Run by hand or from CI (.github/workflows/update-runtime-defaults.yml):
//   pnpm --filter @effected/runtimes exec tsx lib/scripts/generate-defaults.ts
//
// Refetches the live upstream feeds THROUGH THE SHIPPED LIBRARY (internal/feeds.ts
// driven by the package's own layers) and splices the freshly rendered data into
// the byte-span of each exported const's initializer in src/internal/defaults/,
// leaving headers, imports, TSDoc and type annotations untouched — the
// @effected/spdx scripts/generate-data.ts pattern, adapted for object literals
// and live feeds.
//
// oxc-parser is a devDependency used ONLY by this script — nothing under src/**
// may import it at runtime. tsx (the TypeScript runner that executes this file)
// comes from the @savvy-web/silk toolchain, not a package-local dependency. This
// script is never run by the test suite: it touches the network.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { parseSync } from "oxc-parser";
import { GitHubClient } from "../../src/GitHub.js";
import { fetchGitHubReleases, fetchNodeReleases, fetchNodeSchedule, tryParseSemVer } from "../../src/internal/feeds.js";
import type { RawNodeRelease, RawRelease } from "../../src/internal/types.js";
import type { NodeScheduleData } from "../../src/NodeSchedule.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultsDir = resolve(scriptDir, "../../src/internal/defaults");

// Minimal shape for the oxc ESTree nodes we traverse. oxc nodes carry numeric
// `start`/`end` byte offsets into the source string.
interface Node {
	readonly type: string;
	readonly start: number;
	readonly end: number;
	readonly [key: string]: unknown;
}

interface Target {
	/** Name of the exported `const` whose initializer literal gets rewritten. */
	readonly exportName: string;
	/** Fully rendered replacement literal (a bracketed array or braced object). */
	readonly text: string;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Keep only records whose `version` is SemVer-parseable, preserving feed order. */
const keepParseable = <T extends { readonly version: string }>(
	records: ReadonlyArray<T>,
): Effect.Effect<ReadonlyArray<T>> =>
	Effect.forEach(records, (record) =>
		tryParseSemVer(record.version).pipe(
			Effect.map((parsed) => (Option.isSome(parsed) ? Option.some(record) : Option.none<T>())),
		),
	).pipe(Effect.map((results) => results.flatMap(Option.toArray)));

/** Render `{ version, npm, date }` records as a bracketed array literal, one per line. */
function renderNodeReleases(records: ReadonlyArray<RawNodeRelease>): string {
	if (records.length === 0) return "[]";
	const lines = records.map(
		(r) =>
			`\t{ version: ${JSON.stringify(r.version)}, npm: ${JSON.stringify(r.npm)}, date: ${JSON.stringify(r.date)} },`,
	);
	return ["[", ...lines, "]"].join("\n");
}

/** Render `{ version, date }` records as a bracketed array literal, one per line. */
function renderReleases(records: ReadonlyArray<RawRelease>): string {
	if (records.length === 0) return "[]";
	const lines = records.map((r) => `\t{ version: ${JSON.stringify(r.version)}, date: ${JSON.stringify(r.date)} },`);
	return ["[", ...lines, "]"].join("\n");
}

/** Render the schedule as a braced object literal keyed by release line, one entry per line. */
function renderSchedule(schedule: NodeScheduleData): string {
	const entries = Object.entries(schedule);
	if (entries.length === 0) return "{}";
	const lines = entries.map(([key, entry]) => {
		const renderedKey = IDENTIFIER.test(key) ? key : JSON.stringify(key);
		const fields: string[] = [`start: ${JSON.stringify(entry.start)}`];
		if (entry.lts !== undefined) fields.push(`lts: ${JSON.stringify(entry.lts)}`);
		if (entry.maintenance !== undefined) fields.push(`maintenance: ${JSON.stringify(entry.maintenance)}`);
		fields.push(`end: ${JSON.stringify(entry.end)}`);
		if (entry.codename !== undefined) fields.push(`codename: ${JSON.stringify(entry.codename)}`);
		return `\t${renderedKey}: { ${fields.join(", ")} },`;
	});
	return ["{", ...lines, "}"].join("\n");
}

/** Depth-first search for the array/object initializer of `export const <exportName> = <init>`. */
function findInitializerNode(program: Node, exportName: string): Node | undefined {
	let found: Node | undefined;
	const visit = (node: unknown): void => {
		if (found || node === null || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		const n = node as Node;
		if (n.type === "VariableDeclarator") {
			const id = n.id as Node | undefined;
			if (id?.type === "Identifier" && id.name === exportName) {
				let init = n.init as Node | undefined;
				if (init?.type === "TSAsExpression") init = init.expression as Node | undefined;
				if (init && (init.type === "ArrayExpression" || init.type === "ObjectExpression")) {
					found = init;
					return;
				}
			}
		}
		for (const value of Object.values(n)) {
			if (value && typeof value === "object") visit(value);
		}
	};
	visit(program);
	return found;
}

/** Parse `filePath`, splice each target's initializer span, and write back only if changed. */
function regenerateFile(filePath: string, targets: readonly Target[]): void {
	const source = readFileSync(filePath, "utf8");
	const result = parseSync(filePath, source);
	if (result.errors.length > 0) {
		throw new Error(`${filePath}: ${result.errors.map((error) => error.message).join("; ")}`);
	}
	const program = result.program as unknown as Node;

	const edits: Array<{ start: number; end: number; text: string }> = [];
	for (const target of targets) {
		const node = findInitializerNode(program, target.exportName);
		if (!node) {
			throw new Error(`${filePath}: could not find exported "${target.exportName}"`);
		}
		edits.push({ start: node.start, end: node.end, text: target.text });
	}

	// Splice from the end of the file backward so an earlier edit's length change
	// never invalidates the byte offsets captured for a later one (node.ts has two).
	edits.sort((a, b) => b.start - a.start);
	let next = source;
	for (const edit of edits) {
		next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
	}

	if (next === source) {
		console.log(`unchanged ${filePath}`);
		return;
	}
	writeFileSync(filePath, next);
	console.log(`updated ${filePath}`);
}

const program = Effect.gen(function* () {
	const client = yield* GitHubClient;
	console.log("Fetching runtime data from upstream feeds...");

	const [rawNodeReleases, nodeSchedule, rawBunReleases, rawDenoReleases] = yield* Effect.all([
		fetchNodeReleases(),
		fetchNodeSchedule(),
		fetchGitHubReleases(client, "oven-sh", "bun"),
		fetchGitHubReleases(client, "denoland", "deno"),
	]);

	// Drop any release whose version is not SemVer-parseable (e.g. a GitHub tag
	// like "not-quite-v0" or "build-8") — reuses the library's own parser so
	// this logic is never duplicated. The schedule is keyed by release line,
	// not by version, so it is not filtered here.
	const [nodeReleases, bunReleases, denoReleases] = yield* Effect.all([
		keepParseable(rawNodeReleases),
		keepParseable(rawBunReleases),
		keepParseable(rawDenoReleases),
	]);

	// A zero-length feed means a fetch went wrong; writing it would wipe the
	// bundled offline snapshot. Refuse rather than commit an empty default.
	if (nodeReleases.length === 0) return yield* Effect.die(new Error("nodejs.org dist index returned no releases"));
	if (Object.keys(nodeSchedule).length === 0)
		return yield* Effect.die(new Error("node schedule feed returned no entries"));
	if (bunReleases.length === 0) return yield* Effect.die(new Error("bun release feed returned no releases"));
	if (denoReleases.length === 0) return yield* Effect.die(new Error("deno release feed returned no releases"));

	regenerateFile(resolve(defaultsDir, "node.ts"), [
		{ exportName: "nodeDefaults", text: renderNodeReleases(nodeReleases) },
		{ exportName: "nodeScheduleDefaults", text: renderSchedule(nodeSchedule) },
	]);
	regenerateFile(resolve(defaultsDir, "deno.ts"), [{ exportName: "denoDefaults", text: renderReleases(denoReleases) }]);
	regenerateFile(resolve(defaultsDir, "bun.ts"), [{ exportName: "bunDefaults", text: renderReleases(bunReleases) }]);

	console.log(
		`Done: ${nodeReleases.length} node, ${Object.keys(nodeSchedule).length} schedule lines, ${bunReleases.length} bun, ${denoReleases.length} deno.`,
	);
});

const layer = Layer.mergeAll(GitHubClient.layerDefault, FetchHttpClient.layer);

Effect.runPromise(program.pipe(Effect.provide(layer))).catch((error) => {
	console.error("Failed to generate defaults:", error);
	process.exit(1);
});

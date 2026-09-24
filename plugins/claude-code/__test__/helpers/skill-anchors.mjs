#!/usr/bin/env node
// skill-anchors.mjs — checks that every source anchor (`File.ts:N`) in the
// in-scope skills lands on the symbol it names.
//
// A skill cites Effect or kit source as `Module.ts:123` so a reader can open the
// line. Those numbers drift silently on every Effect advance and every kit
// edit. This check makes the drift loud. It reads skill-anchors.json beside it
// and enforces three things:
//
//   1. Coverage. Every anchor token in every in-scope skill file is either
//      listed under "anchors" or under "ignore". An anchor nobody listed fails,
//      so a new citation cannot land unchecked.
//   2. No orphans. Every listed entry still occurs in its skill file. A
//      citation that was rewritten fails until the manifest follows it.
//   3. Symbols. For each listed anchor, each cited line in its source file
//      contains the literal "symbol" text recorded for that line.
//
// Anchor tokens are `path/To/File.ts:N` (also `.mts`/`.js`) with an optional
// line list or range after the colon (`:12,40`, `:57-431`), and bare
// continuations written as a code span, `` `:N` ``, which reuse the file
// named just before them in the prose.
//
// HOW TO ADD AN ANCHOR
//
//   Add an object to "anchors" in skill-anchors.json:
//
//     {
//       "file": "effect-v4-cli/references/gotchas.md",   // relative to skills/
//       "anchor": "unstable/cli/Command.ts:1448",         // the token exactly as written
//       "source": "effect:unstable/cli/Command.ts",       // root:path, roots below
//       "symbols": { "1448": "export const provide: {" }  // line -> literal text on it
//     }
//
//   Roots: "effect" is the vendored Effect src, "vitest" the vendored
//   @effect/vitest src, "repo" the repository root (kit packages and tests).
//   Every comma-separated line, and the first line of every range, needs a
//   symbol; a range's other lines may also be checked. Pick text that names
//   the thing the prose cites (the `export const` line, not a closing brace).
//   A bare `` `:N` `` token is keyed by its own text in its file, so give it
//   its own entry with the same source as the anchor it continues.
//   A token that is not a citation at all (example output, say) goes under
//   "ignore" with a reason.
//
//   When the check fails after an Effect advance, re-derive the line against
//   the vendored tree, fix the skill prose, and update both the "anchor" text
//   and the "symbols" key here.
//
// Usage: node skill-anchors.mjs [--repo <root>] [--skills <dir>] [--manifest <file>]
// Exit 0 when clean, 1 on any failure; each failure is printed as a FAIL line.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};
const repo = resolve(flag("--repo", join(here, "../../../..")));
const skills = resolve(flag("--skills", join(repo, "plugins/claude-code/skills")));
const manifestPath = resolve(flag("--manifest", join(here, "skill-anchors.json")));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const ANCHOR = /[A-Za-z0-9/._$-]*[A-Za-z0-9]\.(?:ts|mts|js):[0-9][0-9,–-]*|`:[0-9][0-9,–-]*`/g;
const failures = [];
const fail = (message) => failures.push(message);

const markdownUnder = (path) => {
	if (!existsSync(path)) {
		fail(`scope entry ${relative(skills, path)} does not exist`);
		return [];
	}
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? markdownUnder(join(path, entry.name))
			: entry.name.endsWith(".md")
				? [join(path, entry.name)]
				: [],
	);
};

const inScope = [...new Set(manifest.scope.flatMap((entry) => markdownUnder(join(skills, entry))))];
const key = (file, anchor) => `${file}\t${anchor}`;

const listed = new Map();
for (const entry of manifest.anchors) {
	const k = key(entry.file, entry.anchor);
	if (listed.has(k)) fail(`duplicate manifest entry ${entry.file}: ${entry.anchor}`);
	listed.set(k, entry);
}
const ignored = new Set(manifest.ignore.map((entry) => key(entry.file, entry.anchor)));

// 1 + 2: coverage and orphans.
const seen = new Set();
for (const path of inScope) {
	const file = relative(skills, path);
	for (const token of new Set(readFileSync(path, "utf8").match(ANCHOR) ?? [])) {
		const k = key(file, token);
		seen.add(k);
		if (!listed.has(k) && !ignored.has(k)) fail(`${file}: anchor ${token} is not in the manifest`);
	}
}
for (const k of [...listed.keys(), ...ignored]) {
	if (!seen.has(k)) fail(`manifest entry ${k.replace("\t", ": ")} does not occur in an in-scope skill file`);
}

// 3: every cited line lands on its symbol.
const sourceCache = new Map();
const sourceLines = (source) => {
	if (!sourceCache.has(source)) {
		const [root, ...rest] = source.split(":");
		const base = manifest.roots[root];
		const path = base === undefined ? undefined : join(repo, base, rest.join(":"));
		sourceCache.set(
			source,
			path !== undefined && existsSync(path) ? readFileSync(path, "utf8").split("\n") : undefined,
		);
	}
	return sourceCache.get(source);
};

let checked = 0;
for (const entry of manifest.anchors) {
	const where = `${entry.file}: ${entry.anchor}`;
	const lines = sourceLines(entry.source);
	if (lines === undefined) {
		fail(`${where} -> source ${entry.source} not found`);
		continue;
	}
	const spec = entry.anchor.replace(/`/g, "").split(":").pop();
	const items = spec
		.split(",")
		.filter((item) => item !== "")
		.map((item) => item.split(/[-–]/).map(Number));
	const cited = (n) => items.some(([start, end]) => n === start || (end !== undefined && n >= start && n <= end));
	for (const [start] of items) {
		if (entry.symbols[String(start)] === undefined)
			fail(`${where} -> cited line ${start} has no symbol in the manifest`);
	}
	for (const [lineText, symbol] of Object.entries(entry.symbols)) {
		const n = Number(lineText);
		if (!cited(n)) {
			fail(`${where} -> manifest checks line ${n}, which the anchor does not cite`);
			continue;
		}
		checked++;
		const actual = lines[n - 1] ?? "";
		if (!actual.includes(symbol)) {
			fail(
				`${where} -> ${entry.source}:${n} does not contain ${JSON.stringify(symbol)}\n     line ${n} is: ${actual.trim()}`,
			);
		}
	}
}

for (const message of failures) console.log(`FAIL ${message}`);
console.log(
	`${inScope.length} skill files, ${listed.size} anchors, ${ignored.size} ignored, ${checked} line checks, ${failures.length} failures`,
);
process.exit(failures.length === 0 ? 0 : 1);

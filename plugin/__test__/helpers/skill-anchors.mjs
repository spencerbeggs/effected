#!/usr/bin/env node
// skill-anchors.mjs — checks that every source anchor (`File.ts:N`) in every
// skill file lands on the symbol it names.
//
// A skill cites Effect or kit source as `Module.ts:123` so a reader can open the
// line. Those numbers drift silently on every Effect advance and every kit
// edit. This check makes the drift loud. It reads skill-anchors.json beside it
// and enforces five things:
//
//   1. Coverage. Every anchor token in every in-scope skill file is either
//      listed under "anchors" or under "ignore". An anchor nobody listed fails,
//      so a new citation cannot land unchecked. The scope is ["."], the whole
//      skills tree.
//   2. No orphans, no extras. Every listed entry occurs in its skill file
//      exactly "occurrences" times (default 1), so a second citation of the
//      same token, which may claim something else, cannot ride on the first
//      one's entry. A citation that was rewritten fails until the manifest
//      follows it. A path-qualified token must also be a path suffix of its
//      entry's "source".
//   3. Symbols. Every cited line, and both ends of every range, carries the
//      "symbols" text recorded for it (word-bounded; see symbolMatches in
//      plugin/scripts/skill-anchors-core.mjs).
//   4. No comment lines. A symbol whose cited line is a comment fails unless
//      the entry sets "comment": true. Most rotten citations pointed a line or
//      four into the doc comment above the declaration they named.
//   5. No bare citations. A `:NNN` written outside a code span and outside a
//      `File.ts:N` token names no file, so nothing can check it. Nor can a
//      prose citation (`` `src/Logger.ts` ``: `withConsoleLog` at 273): a
//      line number after "at", "line" or "lines" beside a file named without
//      one fails too. Every line citation is written as a `File.ts:N` token.
//
// Tokens and the shared rules live in plugin/scripts/skill-anchors-core.mjs.
// A token is keyed with any trailing `,` `-` or `–` stripped, so
// `PlatformError.ts:163,` and `PlatformError.ts:163` are one entry.
//
// HOW TO ADD AN ANCHOR
//
//   Add an object to "anchors" in skill-anchors.json:
//
//     {
//       "file": "effect-v4-cli/references/gotchas.md",   // relative to skills/
//       "anchor": "cli/Command.ts:1448",                   // the token as written
//       "source": "effect:cli/Command.ts",                 // root:path, roots below
//       "symbols": { "1448": "export const provide: {" }  // line -> text on it
//     }
//
//   Roots: "effect" is the vendored Effect src, "vitest" the vendored
//   @effect/vitest src, "repo" the repository root (kit packages and tests).
//   Every comma-separated line and both ends of every range need a symbol; a
//   range's inner lines may also be checked. Pick text that names the thing
//   the prose cites (the `export const` line, not a closing brace), and text
//   that occurs once in the file, so plugin/scripts/rederive-anchors.mjs can
//   relocate it after an advance. When the text repeats, add
//   "after": "<text of the nearest enclosing member line>", and the symbol
//   resolves to its first match inside the block that unique line opens
//   (never past the next sibling member). A range end resolves
//   to the first match after its start; a symbol that begins with `^`
//   must start the line, indentation included (`"^}"`, `"^\t});"`), which is
//   how a closing brace is named. A bare `` `:N` `` token is keyed by its own text in its file, so
//   give it its own entry with the same source as the anchor it continues.
//   A token that is not a citation at all (example output, say) goes under
//   "ignore" with a reason.
//
//   When the check fails after an Effect advance, run
//   `node plugin/scripts/rederive-anchors.mjs`, then again with `--write`.
//
// Usage: node skill-anchors.mjs [--repo <root>] [--skills <dir>] [--manifest <file>]
// Exit 0 when clean, 1 on any failure; each failure is printed as a FAIL line.

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	bareCitationsIn,
	isCommentLine,
	key,
	loadManifest,
	markdownUnder,
	parseSpec,
	proseCitationsIn,
	sourceReader,
	specOf,
	symbolMatches,
	tokensIn,
} from "../../scripts/skill-anchors-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};
const repo = resolve(flag("--repo", join(here, "../../..")));
const skills = resolve(flag("--skills", join(repo, "plugin/skills")));
const manifest = loadManifest(resolve(flag("--manifest", join(here, "skill-anchors.json"))));

const failures = [];
const fail = (message) => failures.push(message);

const inScope = [
	...new Set(
		manifest.scope.flatMap((entry) => {
			const found = markdownUnder(join(skills, entry));
			if (found === undefined) fail(`scope entry ${entry} does not exist`);
			return found ?? [];
		}),
	),
];

const listed = new Map();
for (const entry of manifest.anchors) {
	const k = key(entry.file, entry.anchor);
	if (listed.has(k)) fail(`duplicate manifest entry ${entry.file}: ${entry.anchor}`);
	listed.set(k, entry);
}
const ignored = new Set(manifest.ignore.map((entry) => key(entry.file, entry.anchor)));

// 1, 2 and 5: coverage, orphans, bare citations.
const seen = new Set();
for (const path of inScope) {
	const file = relative(skills, path);
	const text = readFileSync(path, "utf8");
	const counts = new Map();
	for (const { token } of tokensIn(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
	for (const [token, count] of counts) {
		const k = key(file, token);
		seen.add(k);
		const entry = listed.get(k);
		if (entry === undefined && !ignored.has(k)) fail(`${file}: anchor ${token} is not in the manifest`);
		else if (entry !== undefined && count !== (entry.occurrences ?? 1))
			fail(
				`${file}: anchor ${token} occurs ${count} times but the manifest declares ${entry.occurrences ?? 1}; check what each occurrence claims, then set "occurrences"`,
			);
	}
	for (const bare of bareCitationsIn(text)) {
		fail(`${file}:${bare.line}: bare citation ${bare.text} names no file; write it as a File.ts:N token`);
	}
	for (const prose of proseCitationsIn(text)) {
		fail(`${file}:${prose.line}: prose citation "${prose.text}" is unchecked; write it as a File.ts:N token`);
	}
}
for (const k of [...listed.keys(), ...ignored]) {
	if (!seen.has(k)) fail(`manifest entry ${k.replaceAll("\t", ": ")} does not occur in an in-scope skill file`);
}

// 3 and 4: every cited line lands on its symbol, and none is a comment line.
const sourceLines = sourceReader(repo, manifest);
let checked = 0;
for (const entry of manifest.anchors) {
	const where = `${entry.file}: ${entry.anchor}`;
	// A path-qualified token must name the file its entry checks.
	if (!entry.anchor.startsWith("`")) {
		// A leading `$VAR/` is a placeholder (`$EFFECT_SRC/Context.ts`), and a
		// root's own name may stand as a package prefix (`effect/cli/Command.ts`).
		const cited = entry.anchor.slice(0, entry.anchor.lastIndexOf(":"));
		const [root, ...rest] = entry.source.split(":");
		const resolved = `/${join(manifest.roots[root] ?? root, rest.join(":"))}`;
		const bare = cited.replace(/^\$[A-Z_]+\//, "");
		const unprefixed = bare.startsWith(`${root}/`) ? bare.slice(root.length + 1) : bare;
		if (!resolved.endsWith(`/${bare}`) && !resolved.endsWith(`/${unprefixed}`))
			fail(`${where} -> the token names ${cited}, but the entry checks ${entry.source}`);
	}
	const lines = sourceLines(entry.source);
	if (lines === undefined) {
		fail(`${where} -> source ${entry.source} not found`);
		continue;
	}
	const items = parseSpec(specOf(entry.anchor));
	const cited = (n) => items.some(([start, end]) => n === start || (end !== undefined && n >= start && n <= end));
	for (const [start, end] of items) {
		if (entry.symbols[String(start)] === undefined)
			fail(`${where} -> cited line ${start} has no symbol in the manifest`);
		if (end !== undefined && entry.symbols[String(end)] === undefined)
			fail(`${where} -> range end ${end} has no symbol in the manifest`);
	}
	for (const [lineText, symbol] of Object.entries(entry.symbols)) {
		const n = Number(lineText);
		if (!cited(n)) {
			fail(`${where} -> manifest checks line ${n}, which the anchor does not cite`);
			continue;
		}
		checked++;
		const actual = lines[n - 1] ?? "";
		if (!symbolMatches(actual, symbol)) {
			fail(
				`${where} -> ${entry.source}:${n} does not contain ${JSON.stringify(symbol)}\n     line ${n} is: ${actual.trim()}`,
			);
		} else if (entry.comment !== true && isCommentLine(actual)) {
			fail(
				`${where} -> ${entry.source}:${n} is a comment line; cite the declaration, or set "comment": true for a docstring quote\n     line ${n} is: ${actual.trim()}`,
			);
		}
	}
}

for (const message of failures) console.log(`FAIL ${message}`);
console.log(
	`${inScope.length} skill files, ${listed.size} anchors, ${ignored.size} ignored, ${checked} line checks, ${failures.length} failures`,
);
process.exit(failures.length === 0 ? 0 : 1);

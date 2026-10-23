#!/usr/bin/env node
// rederive-anchors.mjs — relocate every skill source anchor by its symbol after
// the vendored source moves (an Effect advance, or a kit edit under a cited
// file).
//
// Reads the manifest the anchor check uses (plugin/__test__/helpers/
// skill-anchors.json) and, for every entry, finds where each recorded symbol
// sits now:
//
//   - A cited line (a single line, or a range start) resolves to the one line
//     in its source that carries its symbol, word-bounded. When the entry has
//     "after" (a string for every line, or an object keyed by cited line), the
//     search runs only inside the block opened by the one line carrying that
//     text and takes the first match there: name the nearest enclosing member
//     (`makeTempFileScoped() {`) to pick one of five identical
//     `Effect.die("not implemented")` lines. The block ends at the next sibling
//     (see blockOf), so a member that loses its symbol is refused as MISSING
//     rather than relocated onto the same text in the member below it.
//   - A range's inner and end lines resolve in order, each to the first match
//     after the line before it, so the end follows its own symbol when the
//     block grows or shrinks.
//
// It never guesses. Zero matches prints MISSING, several print AMBIGUOUS with
// every candidate, and two anchors in one skill file that would become the
// same token print COLLISION. Any refusal exits 1 and writes nothing. With
// --write and no refusal, it rewrites the manifest and every skill file in a
// single pass over the token positions, so a chain of moves (A->B, B->C) and a
// line that prefixes a range (`:57` beside `:57-431`) cannot collide.
//
// Usage (repo root):
//   node plugin/scripts/rederive-anchors.mjs            # report only
//   node plugin/scripts/rederive-anchors.mjs --write    # apply when clean
// Options: --repo <root> --skills <dir> --manifest <file>

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	formatManifest,
	isCommentLine,
	key,
	loadManifest,
	parseSpec,
	rewriteNumbers,
	sourceReader,
	specOf,
	symbolMatches,
	tokensIn,
} from "./skill-anchors-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};
const repo = resolve(flag("--repo", join(here, "../..")));
const skills = resolve(flag("--skills", join(repo, "plugin/skills")));
const manifestPath = resolve(flag("--manifest", join(repo, "plugin/__test__/helpers/skill-anchors.json")));
const write = args.includes("--write");
const manifest = loadManifest(manifestPath);
const sourceLines = sourceReader(repo, manifest);

const refusals = [];
const refuse = (message) => refusals.push(message);
const matchesOf = (lines, text, from = 1) => {
	const found = [];
	for (let n = from; n <= lines.length; n++) if (symbolMatches(lines[n - 1], text)) found.push(n);
	return found;
};

const indentOf = (line) => line.length - line.trimStart().length;
const isCloser = (line) => /^[}\])]/.test(line.trimStart());

/**
 * The block an `after` line opens, as 1-based { from, to }: the lines below it
 * up to the first non-blank line that is indented less, or indented the same
 * and not a closer (`}`, `)`, `]`), so `},` and `} else {` stay inside while
 * the next sibling member ends it. An `after` line inside a doc comment stands
 * for the declaration that comment documents: the block starts at that
 * declaration and runs to the declaration's own end. A symbol must sit inside
 * this block, so a member that loses its symbol is refused instead of
 * relocated onto a sibling below it.
 */
const blockOf = (lines, fence) => {
	let head = fence;
	let from = fence + 1;
	if (isCommentLine(lines[fence - 1])) {
		while (head <= lines.length && (isCommentLine(lines[head - 1]) || lines[head - 1].trim() === "")) head++;
		from = head;
	}
	const base = indentOf(lines[head - 1] ?? "");
	let to = head;
	for (let n = head + 1; n <= lines.length; n++) {
		const line = lines[n - 1];
		if (line.trim() === "") continue;
		const indent = indentOf(line);
		if (indent < base || (indent === base && !isCloser(line))) break;
		to = n;
	}
	return { from, to };
};

/** Relocate one entry; returns { anchor, symbols, after } or undefined on refusal. */
const relocate = (entry) => {
	const where = `${entry.file}: ${entry.anchor}`;
	const lines = sourceLines(entry.source);
	if (lines === undefined) {
		refuse(`MISSING ${where} -> source ${entry.source} not found`);
		return undefined;
	}
	const afterFor = (line) =>
		typeof entry.after === "string" ? entry.after : entry.after === undefined ? undefined : entry.after[String(line)];
	const moved = new Map();
	const numbers = [];
	for (const [start, end] of parseSpec(specOf(entry.anchor))) {
		const symbol = entry.symbols[String(start)];
		if (symbol === undefined) {
			refuse(`MISSING ${where} -> cited line ${start} has no symbol`);
			return undefined;
		}
		let at;
		const after = afterFor(start);
		if (after !== undefined) {
			const fences = matchesOf(lines, after);
			if (fences.length !== 1) {
				refuse(
					`${fences.length === 0 ? "MISSING" : "AMBIGUOUS"} ${where} -> "after" text ${JSON.stringify(after)}${fences.length === 0 ? " not found" : ` on lines ${fences.join(", ")}`}`,
				);
				return undefined;
			}
			const block = blockOf(lines, fences[0]);
			const inside = matchesOf(lines, symbol, block.from).filter((n) => n <= block.to);
			if (inside.length === 0) {
				refuse(
					`MISSING ${where} -> ${JSON.stringify(symbol)} not found in the block of line ${fences[0]} (lines ${block.from}-${block.to})`,
				);
				return undefined;
			}
			at = inside[0];
		} else {
			const candidates = matchesOf(lines, symbol);
			if (candidates.length !== 1) {
				refuse(
					candidates.length === 0
						? `MISSING ${where} -> ${JSON.stringify(symbol)} not found in ${entry.source}`
						: `AMBIGUOUS ${where} -> ${JSON.stringify(symbol)} on lines ${candidates.join(", ")}; add "after"`,
				);
				return undefined;
			}
			at = candidates[0];
		}
		moved.set(start, at);
		numbers.push(at);
		if (end === undefined) continue;
		// Inner and end lines, in order, each after the line before it.
		const inner = Object.keys(entry.symbols)
			.map(Number)
			.filter((n) => n > start && n <= end)
			.sort((a, b) => a - b);
		let previous = at;
		for (const n of inner) {
			const next = matchesOf(lines, entry.symbols[String(n)], previous + 1)[0];
			if (next === undefined) {
				refuse(`MISSING ${where} -> ${JSON.stringify(entry.symbols[String(n)])} not found after line ${previous}`);
				return undefined;
			}
			moved.set(n, next);
			previous = next;
		}
		if (!moved.has(end)) {
			refuse(`MISSING ${where} -> range end ${end} has no symbol`);
			return undefined;
		}
		numbers.push(moved.get(end));
	}
	const symbols = {};
	for (const [line, symbol] of Object.entries(entry.symbols)) {
		const target = moved.get(Number(line));
		if (target === undefined) {
			refuse(`MISSING ${where} -> manifest checks line ${line}, which the anchor does not cite`);
			return undefined;
		}
		if (symbols[String(target)] !== undefined) {
			refuse(`COLLISION ${where} -> two cited lines resolve to line ${target}`);
			return undefined;
		}
		symbols[String(target)] = symbol;
	}
	let after = entry.after;
	if (after !== undefined && typeof after !== "string") {
		after = Object.fromEntries(Object.entries(after).map(([line, text]) => [String(moved.get(Number(line))), text]));
	}
	return { anchor: rewriteNumbers(entry.anchor, numbers), symbols, after, lines };
};

const results = manifest.anchors.map((entry) => ({ entry, next: relocate(entry) }));

// Collisions: two entries in one skill file that would end as the same token.
const finalTokens = new Map();
for (const { entry, next } of results) {
	const k = key(entry.file, next?.anchor ?? entry.anchor);
	const owner = finalTokens.get(k);
	if (owner !== undefined)
		refuse(`COLLISION ${entry.file}: ${owner} and ${entry.anchor} would both become ${next?.anchor ?? entry.anchor}`);
	else finalTokens.set(k, entry.anchor);
}
for (const ignore of manifest.ignore) {
	const k = key(ignore.file, ignore.anchor);
	if (finalTokens.has(k) && finalTokens.get(k) !== ignore.anchor)
		refuse(`COLLISION ${ignore.file}: ${finalTokens.get(k)} would become the ignored token ${ignore.anchor}`);
}

const moves = results.filter(({ entry, next }) => next !== undefined && next.anchor !== entry.anchor);
for (const { entry, next } of moves) {
	console.log(`MOVED ${entry.file}: ${entry.anchor} -> ${next.anchor}`);
	for (const line of Object.keys(next.symbols)) console.log(`     ${line}: ${next.lines[Number(line) - 1].trim()}`);
}
for (const message of refusals) console.log(message);

if (refusals.length > 0) {
	console.log(`${moves.length} moved, ${refusals.length} refused; nothing written`);
	process.exit(1);
}
if (!write) {
	console.log(`${moves.length} moved, 0 refused${moves.length > 0 ? "; rerun with --write to apply" : ""}`);
	process.exit(0);
}

// Apply: one pass per skill file over the token positions.
const byFile = new Map();
for (const { entry, next } of moves) {
	const map = byFile.get(entry.file) ?? new Map();
	map.set(entry.anchor, next.anchor);
	byFile.set(entry.file, map);
}
for (const [file, map] of byFile) {
	const path = join(skills, file);
	const text = readFileSync(path, "utf8");
	let out = "";
	let cursor = 0;
	for (const { raw, token, index } of tokensIn(text)) {
		const replacement = map.get(token);
		if (replacement === undefined) continue;
		out += text.slice(cursor, index) + replacement + raw.slice(token.length);
		cursor = index + raw.length;
	}
	writeFileSync(path, out + text.slice(cursor));
}
for (const { entry, next } of moves) {
	entry.anchor = next.anchor;
	entry.symbols = next.symbols;
	if (next.after !== undefined) entry.after = next.after;
}
writeFileSync(manifestPath, formatManifest(manifest));
console.log(`${moves.length} moved, 0 refused; manifest and ${byFile.size} skill files written`);

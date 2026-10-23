// skill-anchors-core.mjs — the one tokenizer and manifest loader shared by the
// anchor checker (plugin/__test__/helpers/skill-anchors.mjs) and the re-deriver
// (plugin/scripts/rederive-anchors.mjs).
//
// Both tools read the same `File.ts:N` tokens out of the same skill files. They
// once parsed them with two different regexes, and the re-deriver's looser one
// rewrote the prefix of `File.ts:57-431` when it meant `File.ts:57`. Keep every
// token, spec and symbol rule here so the two cannot drift apart again.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * An anchor token: `path/To/File.ts:N` (also `.mts` / `.js`) with an optional
 * line list or range after the colon (`:12,40`, `:57-431`), or a bare
 * continuation written as a code span, `` `:N` ``, which reuses the file named
 * just before it in the prose.
 */
export const ANCHOR = /[A-Za-z0-9/._$-]*[A-Za-z0-9]\.(?:ts|mts|js):[0-9][0-9,–-]*|`:[0-9][0-9,–-]*`/g;

/**
 * A bare `:NNN` line citation outside a code span and outside a `File.ts:N`
 * token: `the docstring at :2424`. The checker cannot see which file it names,
 * so it would rot unchecked. Write it as a token instead (`Schema.ts:2440`, or
 * `` `:2440` `` after a token on the same line). Timestamps (`10:30:00`),
 * ports (`localhost:4318`) and JSON (`"maximum":9007`) do not match: the colon
 * must follow whitespace or an opening bracket, and the digits must not run on
 * into another `:` or `.`.
 */
export const BARE = /(?<=^|[\s([])(:[0-9]{3,})(?![0-9:.])/g;

/** Strip the separators prose can glue onto a token (`Error.ts:163,`). */
export const normalize = (raw) => raw.replace(/[,–-]+$/, "");

/** Every anchor token in `text`, with its offset and normalized key. */
export const tokensIn = (text) =>
	[...text.matchAll(ANCHOR)].map((match) => ({
		raw: match[0],
		token: normalize(match[0]),
		index: match.index,
	}));

/** Bare `:NNN` citations in `text`, as `{ line, column, text }`. */
export const bareCitationsIn = (text) =>
	text.split("\n").flatMap((line, i) => {
		const masked = line.replace(ANCHOR, (m) => "#".repeat(m.length)).replace(/`[^`]*`/g, (m) => "#".repeat(m.length));
		return [...masked.matchAll(BARE)].map((match) => ({ line: i + 1, column: match.index + 1, text: match[1] }));
	});

/**
 * A prose line citation: `at 917`, `line 942`, `lines 265-271`, written beside
 * a file named in a code span with no line number (`` `src/Logger.ts` ``) on
 * the same or the previous line. The tokenizer cannot see it, so it would rot
 * unchecked; write it as a token instead (`Logger.ts:942`, or `` `:942` ``
 * after one). A range whose end is not above its start (`at 2020-12`, a JSON
 * Schema dialect) is not a line range.
 */
export const PROSE = /\b(?:at|line|lines)\s+([0-9]{3,})(?:\s*[-–]\s*([0-9]+))?(?![0-9-])/g;
const NAMED_FILE = /`[^`\s]*\.(?:ts|mts|js)`/;

/** Prose line citations in `text`, as `{ line, column, text }`. */
export const proseCitationsIn = (text) => {
	const lines = text.split("\n");
	return lines.flatMap((line, i) =>
		NAMED_FILE.test(`${lines[i - 1] ?? ""} ${line}`)
			? [...line.matchAll(PROSE)]
					.filter((match) => match[2] === undefined || Number(match[2]) > Number(match[1]))
					.map((match) => ({ line: i + 1, column: match.index + 1, text: match[0] }))
			: [],
	);
};

/** The `N` part of a token: `Schema.ts:12,40-44` -> "12,40-44". */
export const specOf = (token) => token.replace(/`/g, "").split(":").pop();

/** Parse a spec into items: `12,40-44` -> [[12], [40, 44]]. */
export const parseSpec = (spec) =>
	spec
		.split(",")
		.filter((item) => item !== "")
		.map((item) => item.split(/[-–]/).map(Number));

/**
 * Rewrite the numbers of a token in order, keeping its file, separators and
 * backticks: `rewriteNumbers("`:57-431`", [60, 440])` -> "`:60-440`".
 */
export const rewriteNumbers = (token, numbers) => {
	const colon = token.lastIndexOf(":");
	let i = 0;
	return token.slice(0, colon + 1) + token.slice(colon + 1).replace(/[0-9]+/g, () => String(numbers[i++]));
};

const isWord = (ch) => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);

/**
 * Does `line` carry `symbol`? A symbol that begins with `^` must start the
 * line, indentation included, and one that ends with `$` must end it: `^}$` is
 * a lone closing brace in column one, `^\t});$` one at exactly one tab. Any
 * other symbol may sit anywhere in the line, but word-bounded:
 * `export const layer` does not match `export const layerNoop`.
 */
export const symbolMatches = (line, symbol) => {
	const start = symbol.startsWith("^");
	const end = symbol.length > 1 && symbol.endsWith("$");
	const text = symbol.slice(start ? 1 : 0, end ? -1 : undefined);
	if (text === "") return false;
	let from = 0;
	for (;;) {
		const at = line.indexOf(text, from);
		if (at === -1) return false;
		const before = start ? at !== 0 : isWord(text[0]) && isWord(line[at - 1]);
		const after = end
			? at + text.length !== line.trimEnd().length
			: isWord(text.at(-1)) && isWord(line[at + text.length]);
		if (!before && !after) return true;
		if (start) return false;
		from = at + 1;
	}
};

/** A line that is part of a comment: `/**`, ` *`, ` *\/` or `//`. */
export const isCommentLine = (line) => /^\s*(?:\/\*\*?|\*\/?|\/\/)/.test(line);

/** Every `.md` file under `path` (a file or a directory). */
export const markdownUnder = (path) => {
	if (!existsSync(path)) return undefined;
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path, { withFileTypes: true })
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
		.flatMap((entry) =>
			entry.isDirectory()
				? markdownUnder(join(path, entry.name))
				: entry.name.endsWith(".md")
					? [join(path, entry.name)]
					: [],
		);
};

export const key = (file, anchor) => `${file}\t${anchor}`;

/** Read and parse the manifest. */
export const loadManifest = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Serialize the manifest the way it is committed (tabs, trailing newline). */
export const formatManifest = (manifest) => `${JSON.stringify(manifest, null, "\t")}\n`;

/**
 * A cached reader for `root:path` sources: returns the file's lines, or
 * undefined when the root is unknown or the file is missing.
 */
export const sourceReader = (repo, manifest) => {
	const cache = new Map();
	return (source) => {
		if (!cache.has(source)) {
			const [root, ...rest] = source.split(":");
			const base = manifest.roots[root];
			const path = base === undefined ? undefined : join(repo, base, rest.join(":"));
			cache.set(source, path !== undefined && existsSync(path) ? readFileSync(path, "utf8").split("\n") : undefined);
		}
		return cache.get(source);
	};
};

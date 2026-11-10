// A changeset's front matter as @changesets/parse reads it, for the lint
// rules: its fence regex (unanchored, as upstream's is), the YAML value, and
// the offset of each key, so a finding lands on the key's line.

import { Yaml } from "@effected/yaml";
import { Result } from "effect";

/**
 * `@changesets/parse`'s `mdRegex`, with its `[^]` written `[\s\S]` (the same
 * class): leading whitespace allowed, not anchored to the start.
 */
const FENCES = /\s*---([\s\S]*?)\r?\n\s*---(\s*(?:\n|$)[\s\S]*)/;

/** A span of the source a finding points at. */
export interface Span {
	readonly offset: number;
	readonly length: number;
}

/** One `name: type` entry of the front matter mapping. */
export interface FrontMatterEntry {
	readonly name: string;
	readonly type: unknown;
	readonly at: Span;
}

/** Why `@changesets/parse` would refuse the file, or its entries. */
export type FrontMatterRead =
	| { readonly ok: true; readonly entries: ReadonlyArray<FrontMatterEntry> }
	| {
			readonly ok: false;
			readonly problem: "empty" | "missing" | "yaml" | "shape";
			readonly detail: string;
			readonly at: Span;
	  };

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where `name`'s key sits in the block: the first line that starts with it, quoted or not. */
const keySpan = (source: string, blockStart: number, block: string, name: string): Span => {
	const key = new RegExp(`^[ \\t]*(["']?)${escapeRegExp(name)}\\1[ \\t]*:`, "m");
	const found = key.exec(block);
	if (found === null) return { offset: blockStart, length: 0 };
	const lineStart = blockStart + found.index;
	const lineEnd = source.indexOf("\n", lineStart);
	return { offset: lineStart, length: (lineEnd === -1 ? source.length : lineEnd) - lineStart };
};

/**
 * Read a changeset's front matter with `@changesets/parse`'s rules: the
 * trimmed text must be non-empty, its fences must match, the block must be
 * YAML, and a truthy value must be a mapping. A falsy value, such as the
 * empty block `changeset add --empty` writes, has no entries.
 */
export const readFrontMatter = (source: string): FrontMatterRead => {
	const whole = { offset: 0, length: 0 };
	if (source.trim() === "") return { ok: false, problem: "empty", detail: "The file is empty.", at: whole };
	const match = FENCES.exec(source);
	if (match === null) {
		return {
			ok: false,
			problem: "missing",
			detail: 'No front matter: a changeset starts with a block between two "---" lines.',
			at: whole,
		};
	}
	const block = match[1] ?? "";
	const blockStart = match.index + match[0].indexOf("---") + 3;
	const fenceSpan = { offset: match.index + match[0].indexOf("---"), length: 3 };
	const parsed = Yaml.parseResult(block);
	if (Result.isFailure(parsed)) {
		return {
			ok: false,
			problem: "yaml",
			detail: `The front matter is not valid YAML: ${parsed.failure.message}`,
			at: fenceSpan,
		};
	}
	const value = parsed.success;
	if (!value) return { ok: true, entries: [] };
	if (typeof value !== "object" || Array.isArray(value)) {
		return {
			ok: false,
			problem: "shape",
			detail: "The front matter must be a mapping of package names to release types.",
			at: fenceSpan,
		};
	}
	return {
		ok: true,
		entries: Object.entries(value as Record<string, unknown>).map(([name, type]) => ({
			name,
			type,
			at: keySpan(source, blockStart, block, name),
		})),
	};
};

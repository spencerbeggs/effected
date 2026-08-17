/**
 * One-off generator for `src/internal/entityMap.ts`.
 *
 * Run by hand, never by CI and never by the test suite:
 *
 * ```sh
 * pnpm --filter @effected/markdown exec tsx __test__/tools/generate-entities.ts
 * ```
 *
 * The HTML5 named character references are WHATWG data. `entities` ships them
 * as a packed binary trie rather than a plain map (`dist/*.
 * /generated/decode-data-html.js`), so this walks that trie and flattens it
 * back into name/value pairs. Only the semicolon-terminated names are kept:
 * CommonMark's entity grammar requires the semicolon, so the legacy
 * unterminated forms can never match.
 *
 * `entities` is an exact-pinned devDependency and exists only for this script.
 * The generated file is committed; nothing at runtime depends on the package.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { htmlDecodeTree } from "entities/decode";

/**
 * Bit layout of a trie node, from the `entities` source
 * (`src/internal/bin-trie-flags.ts`, the v7+ re-encoding):
 *
 * - bits 15..14 — value length, `+1` encoded (`0` means no value; `1` packs
 *   the codepoint into the header's low 13 bits; `2`/`3` store one or two
 *   codepoints in the following words).
 * - bit 13 — on a value node: the semicolon is required and implicit (no `;`
 *   edge is stored). On a valueless node: this header opens a compact run.
 * - bits 12..7 — branch count, or the run length for a compact run.
 * - bits 6..0 — jump-table offset, single-branch character, or the first
 *   character of a compact run.
 */
const VALUE_LENGTH = 0b1100_0000_0000_0000;
const FLAG13 = 0b0010_0000_0000_0000;
const BRANCH_LENGTH = 0b0001_1111_1000_0000;
const JUMP_TABLE = 0b0000_0000_0111_1111;

const SEMICOLON = 0x3b;

const at = (index: number): number => htmlDecodeTree[index] ?? 0;

const valueLengthOf = (node: number): number => (at(node) & VALUE_LENGTH) >> 14;

/** True when `node` is a compact-run header rather than an ordinary node. */
const isRun = (node: number): boolean => valueLengthOf(node) === 0 && (at(node) & FLAG13) !== 0;

/**
 * The decoded replacement string stored at `node`, per the `entities`
 * decoder's `emitNamedEntityData`: one codepoint packed into the node word
 * (minus the flag bits), one in the next word, or two in the next two.
 */
const valueAt = (node: number, valueLength: number): string => {
	if (valueLength === 1) {
		return String.fromCodePoint(at(node) & ~(VALUE_LENGTH | FLAG13));
	}
	if (valueLength === 2) {
		return String.fromCodePoint(at(node + 1));
	}
	return String.fromCodePoint(at(node + 1), at(node + 2));
};

/**
 * Resolves a chain of compact runs starting at `node`: the run's characters
 * (first in the header's jump bits, the rest packed two per word, low byte
 * first) are appended to the name, landing on the header that follows.
 */
const resolveRuns = (node: number, name: string): readonly [node: number, name: string] => {
	let current = node;
	let resolved = name;
	while (isRun(current)) {
		const runLength = (at(current) & BRANCH_LENGTH) >> 7;
		resolved += String.fromCharCode(at(current) & JUMP_TABLE);
		for (let index = 0; index < runLength - 1; index += 1) {
			const packed = at(current + 1 + (index >> 1));
			resolved += String.fromCharCode(index % 2 === 0 ? packed & 0xff : (packed >> 8) & 0xff);
		}
		current += 1 + (runLength >> 1);
	}
	return [current, resolved];
};

/** Every `(character, childNode)` edge leaving `node`. */
const edgesOf = (node: number): ReadonlyArray<readonly [char: number, child: number]> => {
	const current = at(node);
	const valueLength = valueLengthOf(node);

	// A value length of 1 means the codepoint is packed into the low 13 bits
	// of the node word itself — the same bits that would otherwise hold the
	// branch count and jump offset. Such a node is therefore always terminal;
	// reading branch metadata out of a codepoint walks into garbage.
	if (valueLength === 1) {
		return [];
	}

	const branchesAt = node + Math.max(1, valueLength);
	const branchCount = (current & BRANCH_LENGTH) >> 7;
	const jumpOffset = current & JUMP_TABLE;

	// A single branch, with the character encoded in the jump offset itself.
	if (branchCount === 0) {
		return jumpOffset === 0 ? [] : [[jumpOffset, branchesAt]];
	}

	const edges: Array<readonly [number, number]> = [];

	// A jump table: one slot per character in a contiguous range, `0` marking
	// an empty slot (hence the `- 1` on occupied ones).
	if (jumpOffset !== 0) {
		for (let index = 0; index < branchCount; index += 1) {
			const child = at(branchesAt + index) - 1;
			if (child >= 0) {
				edges.push([jumpOffset + index, child]);
			}
		}
		return edges;
	}

	// A dictionary: sorted characters packed two per word (low byte first),
	// then the matching child indices.
	const packedKeySlots = (branchCount + 1) >> 1;
	for (let index = 0; index < branchCount; index += 1) {
		const packed = at(branchesAt + (index >> 1));
		const char = (packed >> ((index & 1) * 8)) & 0xff;
		edges.push([char, at(branchesAt + packedKeySlots + index)]);
	}
	return edges;
};

const collect = (): ReadonlyArray<readonly [name: string, value: string]> => {
	const entries: Array<readonly [string, string]> = [];

	// Iterative DFS: the trie is ~2000 nodes deep-ish in principle, and an
	// explicit stack keeps the generator honest about the same recursion
	// discipline the engine follows.
	const stack: Array<readonly [node: number, name: string]> = [[0, ""]];

	while (stack.length > 0) {
		const frame = stack.pop();
		if (frame === undefined) {
			break;
		}
		const [node, name] = resolveRuns(...frame);

		// A value node with the semicolon flag is a complete named reference
		// whose terminating `;` is implicit — no `;` edge is stored for it.
		if (valueLengthOf(node) !== 0 && (at(node) & FLAG13) !== 0) {
			entries.push([name, valueAt(node, valueLengthOf(node))]);
		}

		for (const [char, child] of edgesOf(node)) {
			// A value reached over an explicit `;` edge is likewise complete:
			// these are the references that also have a legacy unterminated
			// form, so their semicolon is a real edge rather than a flag.
			if (char === SEMICOLON) {
				const [terminal] = resolveRuns(child, "");
				const terminalValueLength = valueLengthOf(terminal);
				if (terminalValueLength !== 0) {
					entries.push([name, valueAt(terminal, terminalValueLength)]);
				}
				continue;
			}
			stack.push([child, name + String.fromCharCode(char)]);
		}
	}

	entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return entries;
};

const entries = collect();

// entities' exports map does not expose ./package.json, so read it by path.
const entitiesVersion = (
	JSON.parse(readFileSync(resolve(import.meta.dirname, "../../node_modules/entities/package.json"), "utf8")) as {
		version: string;
	}
).version;

const header = `// Generated by __test__/tools/generate-entities.ts — do not edit by hand.
//
// The HTML5 named character references, flattened out of the packed trie in
// entities@${entitiesVersion} (https://github.com/fb55/entities), BSD-2-Clause licensed. The data
// itself is the WHATWG HTML named character reference set
// (https://html.spec.whatwg.org/multipage/named-characters.html).
//
// Only the semicolon-terminated names are here: CommonMark's entity grammar
// requires the semicolon, so the legacy unterminated forms cannot match.
//
// Stored as JSON and parsed once at module load — a ${entries.length}-entry
// Map literal costs several times this in source size, and the parse is a
// one-off. Leaf module: imports nothing.

const DATA = ${JSON.stringify(JSON.stringify(entries))};

/** The HTML5 named character references, keyed without \`&\` or \`;\`. */
export const ENTITY_MAP: ReadonlyMap<string, string> = new Map(JSON.parse(DATA) as ReadonlyArray<[string, string]>);
`;

const target = resolve(import.meta.dirname, "../../src/internal/entityMap.ts");
writeFileSync(target, header);
console.log(`wrote ${entries.length} entities to ${target}`);

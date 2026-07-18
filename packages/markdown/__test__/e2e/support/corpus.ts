/**
 * Test data loader for the vendored CommonMark spec conformance corpus.
 *
 * Reads the generated `spec.json` fixture at
 * `__test__/fixtures/commonmark/spec.json` (see VENDORED.md there) — one
 * entry per embedded CommonMark 0.31.2 spec example.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Root directory of the vendored CommonMark conformance fixtures. */
export const COMMONMARK_FIXTURES_DIR = resolve(import.meta.dirname, "../../fixtures/commonmark");

/** A single CommonMark spec conformance example. */
export interface SpecExample {
	readonly markdown: string;
	readonly html: string;
	readonly example: number;
	readonly section: string;
}

/** Shape of a `spec.json` entry as produced by upstream's `spec_tests.py --dump-tests`. */
interface RawSpecExample {
	readonly markdown: string;
	readonly html: string;
	readonly example: number;
	readonly start_line: number;
	readonly end_line: number;
	readonly section: string;
}

/**
 * Load the 652-example CommonMark 0.31.2 conformance corpus from the
 * vendored `spec.json` fixture, narrowed to the package's `SpecExample`
 * shape (upstream's `start_line`/`end_line` are dropped — nothing under
 * `__test__/` consumes them).
 */
export const loadSpecExamples = (): ReadonlyArray<SpecExample> => {
	const raw = readFileSync(resolve(COMMONMARK_FIXTURES_DIR, "spec.json"), "utf8");
	const examples = JSON.parse(raw) as ReadonlyArray<RawSpecExample>;
	return examples.map(({ markdown, html, example, section }) => ({ markdown, html, example, section }));
};

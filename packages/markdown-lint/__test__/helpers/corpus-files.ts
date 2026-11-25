// The upstream markdownlint fixture corpus, read once. Kept apart from the differential harness so the script
// that chooses the corpus sample can read the fixtures without going through the sample it is about to replace.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** A named input to compare on. */
export interface DifferentialInput {
	readonly name: string;
	readonly source: string;
}

const fixturesDir = join(import.meta.dirname, "..", "fixtures", "markdownlint");

/** The whole upstream fixture corpus: every `.md` file but the README, by name. */
export const fullCorpus: ReadonlyArray<DifferentialInput> = readdirSync(fixturesDir)
	.filter((file) => file.endsWith(".md") && file !== "README.md")
	.sort()
	.map((file) => ({ name: file, source: readFileSync(join(fixturesDir, file), "utf8") }));

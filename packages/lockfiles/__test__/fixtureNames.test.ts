import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { LockfileFormat } from "../src/LockfileFormat.js";
import { filenamesFor } from "../src/LockfileFormat.js";
import { FIXTURES_DIR, FIXTURE_SUFFIX } from "./helpers/fixtures.js";

const FORMATS: ReadonlyArray<LockfileFormat> = ["bun", "npm", "pnpm", "yarn"];

/** Every filename GitHub's dependency graph reads as an npm-ecosystem manifest: each format's lockfiles, and `package.json`. */
const MANIFEST_NAMES = new Set([...FORMATS.flatMap(filenamesFor), "package.json"]);

/** Every file under the fixtures directory, as a path relative to it. */
const filesUnder = (dir: string, prefix = ""): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? filesUnder(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
	);

describe("lockfile fixtures are stored under a name that is no manifest", () => {
	const files = filesUnder(FIXTURES_DIR);

	it("no fixture is named as a manifest the dependency graph would scan", () => {
		// A fixture under its real name raises a Dependabot alert for every advisory against a package it pins, and
		// dismissing one does not stop the next. Store it as `<lockfile>.fixture` and read it with `fixture()`.
		const named = files.filter((file) => MANIFEST_NAMES.has(basename(file)));
		assert.deepStrictEqual(named, [], `rename to <name>${FIXTURE_SUFFIX}: ${named.join(", ")}`);
	});

	it("control: the walk finds the fixtures, and each one is a manifest name plus the suffix", () => {
		const fixtures = files.filter((file) => file.endsWith(FIXTURE_SUFFIX));
		// Non-vacuous: a mistyped directory would find nothing and pass the check above.
		assert.isAtLeast(fixtures.length, 30);
		for (const file of fixtures) {
			assert.isTrue(MANIFEST_NAMES.has(basename(file).slice(0, -FIXTURE_SUFFIX.length)), file);
		}
	});
});

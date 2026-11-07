import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { ShellSyntax } from "../src/index.js";
import type { ProjectedHeredoc, ProjectedSegment, ProjectedWord } from "./helpers/project.js";
import { normalizeExpected, projectCommand, projectScript } from "./helpers/project.js";

interface Case {
	readonly name: string;
	readonly source?: string;
	readonly input: string;
	readonly divergence?: string;
	readonly expect: {
		readonly segments: ReadonlyArray<Partial<ProjectedSegment> & { readonly words: ReadonlyArray<ProjectedWord> }>;
		readonly comments?: ReadonlyArray<string>;
		readonly diagnostics?: ReadonlyArray<string>;
		readonly commands?: ReadonlyArray<ReadonlyArray<ProjectedWord | null>>;
		readonly substitutions?: ReadonlyArray<{
			readonly body: string;
			readonly commands: ReadonlyArray<ReadonlyArray<ProjectedWord | null>>;
			readonly heredocs?: ReadonlyArray<ProjectedHeredoc>;
		}>;
	};
}

const load = (file: string): ReadonlyArray<Case> =>
	(
		JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), "utf8")) as {
			readonly cases: ReadonlyArray<Case>;
		}
	).cases;

const corpora = [
	{ file: "shell-quote.json", count: 113 },
	{ file: "agent-shapes.json", count: 34 },
] as const;

for (const { file, count } of corpora) {
	const cases = load(file);
	describe(file, () => {
		// A silently empty or truncated corpus would pass every loop below.
		it("loads the expected number of cases", () => {
			assert.strictEqual(cases.length, count);
			assert.strictEqual(new Set(cases.map((c) => c.name)).size, count, "case names are unique");
		});

		for (const testCase of cases) {
			it(testCase.name, () => {
				const script = ShellSyntax.parse(testCase.input);
				assert.deepStrictEqual<unknown>(projectScript(script), normalizeExpected(testCase.expect));
				if (testCase.expect.commands !== undefined) {
					assert.deepStrictEqual<unknown>(script.commands().map(projectCommand), testCase.expect.commands);
				}
				if (testCase.expect.substitutions !== undefined) {
					const found = script.substitutions();
					assert.deepStrictEqual(
						found.map((part) => part.body),
						testCase.expect.substitutions.map((s) => s.body),
					);
					testCase.expect.substitutions.forEach((expected, index) => {
						const nested = ShellSyntax.parse(expected.body);
						assert.deepStrictEqual<unknown>(nested.commands().map(projectCommand), expected.commands);
						if (expected.heredocs !== undefined) {
							assert.deepStrictEqual<unknown>(
								nested.segments.flatMap((segment) =>
									segment.heredocs.map((h) => ({ heredoc: h.delimiter, quoted: h.quoted, body: h.body })),
								),
								expected.heredocs,
							);
						}
						assert.strictEqual(found[index]?.body, script.source.slice(found[index]?.bodyStart, found[index]?.bodyEnd));
					});
				}
			});
		}
	});
}

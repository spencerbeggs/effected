// PnpmWorkspaceFile: the pnpm-workspace.yaml editor. Ported from
// rolldown-pnpm-config's package/__test__/cli/workspace-file.test.ts and
// workspace-style.test.ts (every case but the findWorkspaceFile walk, which
// is not ported: discovery is @effected/workspaces' job), plus the typed
// failure and hostile-input rows.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { PnpmWorkspaceFile, PnpmWorkspaceFileError } from "../src/PnpmWorkspaceFile.js";

// Stored as `.yaml.txt` so the pre-commit YAML formatter cannot normalize away
// the very style each fixture is named for.
const FIXTURES = join(import.meta.dirname, "fixtures", "workspace-style");
const fixture = (name: string): string => readFileSync(join(FIXTURES, `${name}.txt`), "utf8");

const read = (source: string): PnpmWorkspaceFile => {
	const result = PnpmWorkspaceFile.parseResult(source);
	if (Result.isFailure(result)) throw new Error("fixture did not parse");
	return result.success;
};
const valueOfText = (source: string): Record<string, unknown> => ({ ...read(source).value });
const write = (source: string, next: Record<string, unknown>): string => read(source).write(next);

interface Catalogs {
	catalogs: { effected: Record<string, string> };
}

/** The source with `effect` bumped to ~4.1.1, everything else as parsed. */
const bumpEffect = (source: string): Record<string, unknown> => {
	const ws = valueOfText(source) as unknown as Catalogs;
	ws.catalogs.effected.effect = "~4.1.1";
	return ws as unknown as Record<string, unknown>;
};

describe("PnpmWorkspaceFile (workspace-file.test.ts)", () => {
	it("parses and renders deterministically and idempotently", () => {
		const parsed = valueOfText('publicHoistPattern:\n  - "@types/*"\npackages:\n  - pkg/*\n');
		assert.deepStrictEqual(parsed, { publicHoistPattern: ["@types/*"], packages: ["pkg/*"] });
		const once = PnpmWorkspaceFile.render(parsed);
		assert.strictEqual(PnpmWorkspaceFile.render(valueOfText(once)), once); // idempotent
		assert.deepStrictEqual(valueOfText(""), {});
	});

	it("treats a top-level sequence as an empty workspace, not an index-keyed record", () => {
		assert.deepStrictEqual(valueOfText("- a\n- b\n"), {});
	});
});

describe("PnpmWorkspaceFile.canonicalize", () => {
	it("sorts primitive arrays lexicographically", () => {
		assert.deepStrictEqual(PnpmWorkspaceFile.canonicalize({ a: ["swc", "esbuild", "sharp"] }), {
			a: ["esbuild", "sharp", "swc"],
		});
	});

	it("preserves arrays that contain objects", () => {
		const v = { a: [{ x: 2 }, { x: 1 }] };
		assert.deepStrictEqual(PnpmWorkspaceFile.canonicalize(v), { a: [{ x: 2 }, { x: 1 }] });
	});

	it("alpha-sorts object keys recursively", () => {
		const sorted = PnpmWorkspaceFile.canonicalize({ b: 1, a: { d: 1, c: 2 } }) as Record<
			string,
			Record<string, number>
		>;
		assert.deepStrictEqual(Object.keys(sorted), ["a", "b"]);
		assert.deepStrictEqual(Object.keys(sorted.a ?? {}), ["c", "d"]);
	});

	it("sorts keys and primitive arrays by code unit, independent of locale", () => {
		assert.deepStrictEqual(Object.keys(PnpmWorkspaceFile.canonicalize({ b: 1, B: 2, a: 3 }) as object), [
			"B",
			"a",
			"b",
		]);
		assert.deepStrictEqual(PnpmWorkspaceFile.canonicalize(["b", "B", "a"]), ["B", "a", "b"]);
	});
});

describe("PnpmWorkspaceFile.inferStyle (workspace-style.test.ts)", () => {
	it("reads double quotes, indented sequences and 2-space indent", () => {
		const style = PnpmWorkspaceFile.inferStyle(fixture("double-indented.yaml"));
		assert.strictEqual(style.indent, 2);
		assert.strictEqual(style.indentSequences, true);
		assert.strictEqual(style.quoteStyle, "double");
		assert.strictEqual(style.lineWidth, 0);
	});

	it("reads single quotes and unindented sequences", () => {
		const style = PnpmWorkspaceFile.inferStyle(fixture("single-unindented.yaml"));
		assert.strictEqual(style.indent, 2);
		assert.strictEqual(style.indentSequences, false);
		assert.strictEqual(style.quoteStyle, "single");
	});

	it("reads a 4-space indent", () => {
		const style = PnpmWorkspaceFile.inferStyle(fixture("four-space.yaml"));
		assert.strictEqual(style.indent, 4);
		assert.strictEqual(style.indentSequences, true);
	});

	it("takes the dominant quote style of a mixed file", () => {
		assert.strictEqual(PnpmWorkspaceFile.inferStyle(fixture("mixed-quotes.yaml")).quoteStyle, "double");
	});

	it("falls back to the historical defaults for dimensions with no votes", () => {
		const style = PnpmWorkspaceFile.inferStyle(fixture("no-votes.yaml"));
		assert.strictEqual(style.indent, 2);
		assert.strictEqual(style.indentSequences, false);
		assert.strictEqual(style.quoteStyle, "single");
	});
});

describe("PnpmWorkspaceFile#write (workspace-style.test.ts)", () => {
	for (const name of ["double-indented.yaml", "single-unindented.yaml", "four-space.yaml"]) {
		it(`changes only the changed line in ${name}`, () => {
			const source = fixture(name);
			assert.strictEqual(
				write(source, bumpEffect(source)),
				source.replace('effect": ~4.1.0', 'effect": ~4.1.1').replace("effect': ~4.1.0", "effect': ~4.1.1"),
			);
		});

		it(`keeps the quotes and trailing comment of a changed scalar in ${name}`, () => {
			const source = fixture(name);
			const ws = valueOfText(source) as unknown as Catalogs;
			ws.catalogs.effected["@effect/ai-anthropic"] = "~4.1.1";
			assert.strictEqual(
				write(source, ws as unknown as Record<string, unknown>),
				source.replace("~4.1.0 # pinned", "~4.1.1 # pinned"),
			);
		});
	}

	it("keeps a changed plain scalar plain when its siblings quote theirs", () => {
		const source = "catalog:\n  a: 1.0.0 # plain\n  'b': '2.0.0'\n  'c': '3.0.0'\n  'd': '4.0.0'\n";
		const ws = valueOfText(source) as { catalog: Record<string, string> };
		ws.catalog.a = "1.1.0";
		assert.strictEqual(write(source, ws), source.replace("1.0.0", "1.1.0"));
	});

	it("inserts new keys and sequences in the file's own style", () => {
		const source = fixture("double-indented.yaml");
		const next = bumpEffect(source) as Record<string, unknown> & Catalogs;
		next.catalogs.effected["@effect/vitest"] = "~4.1.1";
		next.publicHoistPattern = ["@types/*"];
		const out = write(source, next);
		assert.include(out, '    "effect": ~4.1.1\n    "@effect/vitest": ~4.1.1\n');
		assert.isTrue(out.endsWith('publicHoistPattern:\n  - "@types/*"\n'));
		assert.include(out, "# Repo workspace — hand-maintained.\n");
		assert.include(out, "# pinned with the kit");
		assert.deepStrictEqual(valueOfText(out), next);
	});

	it("keeps the author's key order and removes dropped keys in place", () => {
		const source = fixture("single-unindented.yaml");
		const { minimumReleaseAgeExclude: _dropped, ...next } = valueOfText(source);
		assert.strictEqual(write(source, next), source.slice(0, source.indexOf("minimumReleaseAgeExclude:")));
	});

	it("is a no-op when nothing changed, including a reordered sequence", () => {
		const source = fixture("double-indented.yaml");
		const next = valueOfText(source) as { packages: string[] };
		next.packages = [...next.packages].reverse();
		assert.strictEqual(write(source, next), source);
	});

	it("renders an empty or new file exactly as render does", () => {
		const next = { packages: ["pkg/*"], catalogs: { silk: { "@types/node": "^24.0.0" } } };
		assert.strictEqual(write("", next), PnpmWorkspaceFile.render(next));
		assert.strictEqual(write("\n  \n", next), PnpmWorkspaceFile.render(next));
	});

	it("re-renders in the inferred style when the source is not a mapping", () => {
		// A top-level sequence votes for double quotes but not for nested-sequence indentation.
		const next = { publicHoistPattern: ["@types/*"] };
		assert.strictEqual(write('- "a"\n', next), 'publicHoistPattern:\n- "@types/*"\n');
	});

	it("adds one item to an all-quoted list without touching the others", () => {
		const source = 'onlyBuiltDependencies:\n  - "esbuild"\n  - "sharp"\nstrictDepBuilds: true\n';
		const out = write(source, { onlyBuiltDependencies: ["esbuild", "sharp", "zz"], strictDepBuilds: true });
		assert.strictEqual(out, 'onlyBuiltDependencies:\n  - "esbuild"\n  - "sharp"\n  - "zz"\nstrictDepBuilds: true\n');
	});

	it("removes one item from a list without touching the others", () => {
		const source = "onlyBuiltDependencies:\n- 'esbuild' # native\n- 'sharp'\n- 'swc'\n";
		const out = write(source, { onlyBuiltDependencies: ["esbuild", "swc"] });
		assert.strictEqual(out, "onlyBuiltDependencies:\n- 'esbuild' # native\n- 'swc'\n");
	});

	it("quotes a new key where the file quotes keys by choice", () => {
		const source = fixture("double-indented.yaml");
		const next = valueOfText(source) as unknown as Catalogs;
		next.catalogs.effected.vitest = "^4.0.0";
		assert.include(
			write(source, next as unknown as Record<string, unknown>),
			'    "effect": ~4.1.0\n    "vitest": ^4.0.0\n',
		);
	});

	it("leaves a new key plain where the file quotes only what it must", () => {
		const source = 'catalogs:\n  effected:\n    "@effect/vitest": ~4.1.0\n    effect: ~4.1.0\n';
		const out = write(source, {
			catalogs: { effected: { "@effect/vitest": "~4.1.0", effect: "~4.1.0", vitest: "^4.0.0" } },
		});
		assert.strictEqual(out, `${source}    vitest: ^4.0.0\n`);
	});

	it("keeps CRLF line endings on both the splice and the insert path", () => {
		const source = "packages:\r\n  - pkg/*\r\ncatalogs:\r\n  silk:\r\n    typescript: ^5.8.0\r\n";
		const out = write(source, {
			packages: ["pkg/*"],
			catalogs: { silk: { typescript: "^5.9.0" } },
			strictDepBuilds: true,
		});
		assert.strictEqual(
			out,
			"packages:\r\n  - pkg/*\r\ncatalogs:\r\n  silk:\r\n    typescript: ^5.9.0\r\nstrictDepBuilds: true\r\n",
		);
	});

	it("never leaves a dangling alias when an anchored node changes", () => {
		const source = "onlyBuiltDependencies: &b\n  - esbuild\nignoredBuiltDependencies: *b\n";
		const next = { onlyBuiltDependencies: ["esbuild", "sharp"], ignoredBuiltDependencies: ["esbuild"] };
		assert.deepStrictEqual(valueOfText(write(source, next)), next);
	});

	it("does not change an alias's value when a scalar under its anchor is spliced", () => {
		const source = "catalogs:\n  a:\n    effect: &v ~4.1.0\n  b:\n    effect: *v\n";
		const next = { catalogs: { a: { effect: "~4.1.1" }, b: { effect: "~4.1.0" } } };
		assert.deepStrictEqual(valueOfText(write(source, next)), next);
	});

	it("never writes a key that collides with an existing non-string key", () => {
		const out = write("1: a\n", { "1": "b" });
		assert.deepStrictEqual(valueOfText(out), { "1": "b" });
		assert.lengthOf(out.trim().split("\n"), 1);
	});
});

describe("PnpmWorkspaceFile.parse failures and hostile input", () => {
	it.effect("fails malformed YAML through the typed channel, in both forms", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PnpmWorkspaceFile.parse("packages: [unclosed\n"));
			assert.instanceOf(error, PnpmWorkspaceFileError);
			assert.strictEqual(error._tag, "PnpmWorkspaceFileError");
			assert.strictEqual(error.reason, "invalid-yaml");
			assert.isString(error.message);
			const result = PnpmWorkspaceFile.parseResult("packages: [unclosed\n");
			assert.isTrue(Result.isFailure(result));
		}),
	);

	it.effect("parse decodes the same file as parseResult", () =>
		Effect.gen(function* () {
			const file = yield* PnpmWorkspaceFile.parse("packages:\n  - pkg/*\n");
			assert.deepStrictEqual(file.value, { packages: ["pkg/*"] });
			assert.strictEqual(file.source, "packages:\n  - pkg/*\n");
		}),
	);

	it("never defects on deeply nested input", () => {
		const text = `a: ${"[".repeat(20000)}${"]".repeat(20000)}\n`;
		assert.doesNotThrow(() => PnpmWorkspaceFile.parseResult(text));
	});

	it("a __proto__ key is an own data property and pollutes nothing", () => {
		const file = read("__proto__:\n  polluted: true\npackages:\n  - a\n");
		assert.isTrue(Object.hasOwn(file.value, "__proto__"));
		assert.isUndefined(({} as Record<string, unknown>).polluted);
		const out = file.write({ packages: ["a"], ["__proto__"]: { polluted: true } } as Record<string, unknown>);
		assert.isString(out);
		assert.isUndefined(({} as Record<string, unknown>).polluted);
	});

	it("an inherited key name is never read as present", () => {
		// "constructor" is absent from the source; writing it must add it, not skip it as already there.
		const out = write("packages:\n  - a\n", { packages: ["a"], constructor: "x" });
		assert.deepStrictEqual(valueOfText(out), { packages: ["a"], constructor: "x" });
	});

	it("write is total over an unsupported source: a multi-document stream re-renders", () => {
		const next = { packages: ["a"] };
		const out = write("packages:\n  - a\n---\npackages:\n  - b\n", next);
		assert.isString(out);
	});
});

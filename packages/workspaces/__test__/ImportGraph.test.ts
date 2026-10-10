import { builtinModules } from "node:module";
import { assert, describe, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { DependencyField } from "@effected/npm";
import { Effect, Layer, Path } from "effect";
import { WorkspaceDiscovery, WorkspacePackage } from "../src/index.js";
import { ImportGraph, SourceBoundary } from "../src/testing.js";

/**
 * A layer's `it` has no `it.live`, so the walk suites run without the test
 * services instead: the 3-second `Effect.timeout` guards then run on the real
 * clock and fail as a `TimeoutException` when a walk never ends.
 */
const LIVE_CLOCK = { excludeTestServices: true } as const;

describe("ImportGraph.reachability", () => {
	// The vitest-agent shape: the root entry and the reporter must never load
	// ink, three hops away or not.
	const UI = {
		"/ui/src/index.ts": 'export { shell } from "./ui/shell.js";\nexport { report } from "./reporter.js";\n',
		"/ui/src/ui/shell.ts": 'import { view } from "./view.js";\nexport const shell = view;\n',
		"/ui/src/ui/view.ts": 'import { render } from "ink";\nexport const view = render;\n',
		"/ui/src/reporter.ts": 'import { Effect } from "effect";\nexport const report = Effect;\n',
	};
	layer(
		Layer.mergeAll(MemoryFileSystem.layerWith(UI), Path.layer),
		LIVE_CLOCK,
	)((it) => {
		it.effect("follows a multi-hop relative chain and reports the chain that reaches a forbidden import", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.reachability({
					root: "/ui/src",
					entries: ["index.ts"],
					forbid: ["ink", "react"],
				});
				assert.deepStrictEqual(scan.files, ["index.ts", "reporter.ts", "ui/shell.ts", "ui/view.ts"]);
				assert.deepStrictEqual(scan.violations, ["ui/view.ts:1:24 ink via index.ts -> ui/shell.ts -> ui/view.ts"]);
				assert.deepStrictEqual(scan.unresolved, []);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("passes when nothing the entries reach imports a forbidden specifier", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.reachability({
					root: "/ui/src",
					entries: ["reporter.ts"],
					forbid: ["ink", "react"],
				});
				assert.deepStrictEqual(scan.files, ["reporter.ts"]);
				assert.deepStrictEqual(scan.violations, []);
				assert.deepStrictEqual(scan.unresolved, []);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("checks the entry files themselves, and a forbidden bare import is caught without any walk", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.reachability({
					root: "/ui/src",
					entries: ["ui/view.ts"],
					forbid: ["ink"],
				});
				assert.deepStrictEqual(scan.files, ["ui/view.ts"]);
				assert.deepStrictEqual(scan.violations, ["ui/view.ts:1:24 ink via ui/view.ts"]);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("matches a forbid entry like forbidImports does: exact, subpath and trailing star", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.reachability({
					root: "/ui/src",
					entries: ["index.ts"],
					forbid: ["ink/*", "re*"],
				});
				assert.deepStrictEqual(scan.violations, []);
				const star = yield* ImportGraph.reachability({
					root: "/ui/src",
					entries: ["index.ts"],
					forbid: ["in*"],
				});
				assert.deepStrictEqual(star.violations, ["ui/view.ts:1:24 ink via index.ts -> ui/shell.ts -> ui/view.ts"]);
			}).pipe(Effect.timeout("3 seconds")),
		);
	});

	// The hole a directory rule cannot close: every ink import stays inside
	// ink/, so the confined scan is clean, yet the root entry statically
	// reaches ink/ and therefore loads ink.
	const HOLE = {
		"/hole/src/index.ts": 'export { shell } from "./ui/shell.js";\n',
		"/hole/src/ui/shell.ts": 'import { host } from "../ink/host.js";\nexport const shell = host;\n',
		"/hole/src/ink/host.ts": 'import { render } from "ink";\nexport const host = render;\n',
	};
	layer(
		Layer.mergeAll(MemoryFileSystem.layerWith(HOLE), Path.layer),
		LIVE_CLOCK,
	)((it) => {
		it.effect("positive control: the directory rule passes — every ink import is inside ink/", () =>
			Effect.gen(function* () {
				const scan = yield* SourceBoundary.scan({
					root: "/hole/src",
					rules: [{ forbidImports: ["ink"] }],
					allowRules: { forbidImports: ["ink/**"] },
				});
				assert.deepStrictEqual(scan.violations, []);
				assert.deepStrictEqual(
					scan.waived.map((offence) => offence.label),
					["ink/host.ts:1:24 forbidImports ink"],
				);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("the reachability walk closes the hole: the root entry reaches ink/ through a static path", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.reachability({
					root: "/hole/src",
					entries: ["index.ts"],
					forbid: ["ink"],
				});
				assert.deepStrictEqual(scan.violations, ["ink/host.ts:1:24 ink via index.ts -> ui/shell.ts -> ink/host.ts"]);
			}).pipe(Effect.timeout("3 seconds")),
		);
	});

	const RESOLUTION = {
		"/r/src/main.ts": `${[
			'import { a } from "./a.js";',
			'import { i } from "./sub/index.js";',
			'import { b } from "./sub/bare";',
			'import type { T } from "./types.js";',
			'const lazy = await import("./lazy.js");',
			"export const m = [a, i, b, lazy];",
			"export type { T };",
		].join("\n")}\n`,
		"/r/src/a.ts": "export const a = 1;\n",
		"/r/src/sub/index.ts": "export const i = 1;\n",
		"/r/src/sub/bare.ts": "export const b = 1;\n",
		"/r/src/types.ts": "export type T = number;\n",
		"/r/src/lazy.ts": 'import { render } from "ink";\nexport const l = render;\n',
	};
	layer(
		Layer.mergeAll(MemoryFileSystem.layerWith(RESOLUTION), Path.layer),
		LIVE_CLOCK,
	)((it) => {
		it.effect("resolves .js to .ts, directories to index files, and extensionless specifiers", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.reachability({ root: "/r/src", entries: ["main"], forbid: [] });
				assert.deepStrictEqual(scan.files, ["a.ts", "lazy.ts", "main.ts", "sub/bare.ts", "sub/index.ts", "types.ts"]);
				assert.deepStrictEqual(scan.unresolved, []);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("follows type-only and dynamic literal imports: the walk over-approximates what loads", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.reachability({ root: "/r/src", entries: ["main.ts"], forbid: ["ink"] });
				assert.deepStrictEqual(scan.violations, ["lazy.ts:1:24 ink via main.ts -> lazy.ts"]);
			}).pipe(Effect.timeout("3 seconds")),
		);
	});

	const LINKS = {
		"/c/src/a.ts": 'import "./b.js";\n',
		"/c/src/b.ts": 'import "./a.js";\nimport "./generated.js";\n',
	};
	layer(
		Layer.mergeAll(MemoryFileSystem.layerWith(LINKS), Path.layer),
		LIVE_CLOCK,
	)((it) => {
		it.effect("terminates on an import cycle, visiting each file once", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.reachability({ root: "/c/src", entries: ["a.ts"], forbid: [] });
				assert.deepStrictEqual(scan.files, ["a.ts", "b.ts"]);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("reports a relative import no candidate resolves in unresolved, once per file and specifier", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.reachability({ root: "/c/src", entries: ["a.ts"], forbid: [] });
				assert.deepStrictEqual(
					scan.unresolved.map((entry) => entry.label),
					["b.ts ./generated.js"],
				);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("an entry that resolves to no file fails typed, and so does an empty entries list", () =>
			Effect.gen(function* () {
				const missing = yield* Effect.flip(
					ImportGraph.reachability({ root: "/c/src", entries: ["nope.ts"], forbid: [] }),
				);
				assert.strictEqual(missing._tag, "EntryNotFoundError");
				const empty = yield* Effect.flip(ImportGraph.reachability({ root: "/c/src", entries: [], forbid: [] }));
				assert.strictEqual(empty._tag, "NoEntriesError");
			}),
		);
	});

	const CROSS = {
		"/x/app/src/index.ts": 'export { ui } from "@org/ui";\n',
		"/x/ui/src/index.ts": 'import { render } from "ink";\nexport const ui = render;\n',
	};
	layer(
		Layer.mergeAll(MemoryFileSystem.layerWith(CROSS), Path.layer),
		LIVE_CLOCK,
	)((it) => {
		it.effect("stops at a bare specifier by default: not walked, still checked against forbid", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.reachability({
					root: "/x/app/src",
					entries: ["index.ts"],
					forbid: ["@org/*"],
				});
				assert.deepStrictEqual(scan.files, ["index.ts"]);
				assert.deepStrictEqual(scan.violations, ["index.ts:1:20 @org/ui via index.ts"]);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("followPackage extends the walk across a workspace package, and its misses land in unresolved", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.reachability({
					root: "/x/app/src",
					entries: ["index.ts"],
					forbid: ["ink"],
					followPackage: (specifier) => (specifier === "@org/ui" ? "/x/ui/src/index.ts" : undefined),
				});
				assert.deepStrictEqual(scan.violations, [
					"../../ui/src/index.ts:1:24 ink via index.ts -> ../../ui/src/index.ts",
				]);
				const stale = yield* ImportGraph.reachability({
					root: "/x/app/src",
					entries: ["index.ts"],
					forbid: ["ink"],
					followPackage: (specifier) => (specifier === "@org/ui" ? "/x/ui/src/gone.ts" : undefined),
				});
				assert.deepStrictEqual(stale.violations, []);
				assert.deepStrictEqual(
					stale.unresolved.map((entry) => entry.label),
					["index.ts @org/ui"],
				);
			}).pipe(Effect.timeout("3 seconds")),
		);
	});
});

describe("ImportGraph.undeclared", () => {
	const pkg = (
		name: string,
		relativePath: string,
		fields: Partial<Record<DependencyField, Record<string, string>>> = {},
	): WorkspacePackage =>
		WorkspacePackage.make({
			name,
			version: "1.0.0",
			path: relativePath === "." ? "/repo" : `/repo/${relativePath}`,
			packageJsonPath: relativePath === "." ? "/repo/package.json" : `/repo/${relativePath}/package.json`,
			relativePath,
			workspaceRoot: "/repo",
			...fields,
		});

	const PACKAGES = [
		pkg("repo", "."),
		pkg("@repo/app", "packages/app", {
			dependencies: { "@repo/core": "workspace:^", effect: "catalog:effect" },
			peerDependencies: { "@effect/vitest": "^1" },
			devDependencies: { vitest: "^3" },
		}),
		pkg("@repo/core", "packages/core", { dependencies: { effect: "^4" } }),
	];

	const TREE = {
		"/repo/packages/app/src/main.ts": `${[
			'import { Effect } from "effect";',
			'import { core } from "@repo/core";',
			'import { assert } from "@effect/vitest";',
			'import { readFileSync } from "node:fs";',
			'import { join } from "path";',
			'import { x } from "./local.js";',
			'import { pad } from "left-pad";',
			'import { sub } from "undeclared-pkg/deep";',
			'import { own } from "@repo/app/local";',
			"export const m = [Effect, core, assert, readFileSync, join, x, pad, sub, own];",
		].join("\n")}\n`,
		"/repo/packages/app/src/local.ts": "export const x = 1;\nexport const own = 2;\n",
		"/repo/packages/app/src/types.ts": 'import type { Thing } from "types-only-pkg";\nexport type { Thing };\n',
		"/repo/packages/app/src/value.ts": 'import { Thing } from "types-only-pkg";\nexport const t = Thing;\n',
		"/repo/packages/app/src/computed.ts": 'const name = "left-pad";\nexport const c = await import(name);\n',
		"/repo/packages/app/__test__/main.test.ts": 'import { describe } from "vitest";\ndescribe("x", () => {});\n',
		"/repo/packages/app/dist/dev/pkg/bundle.js": 'import { z } from "zod";\nexport const b = z;\n',
		"/repo/packages/core/src/index.ts": 'import { leftPad } from "left-pad";\nexport const core = leftPad;\n',
	};

	const UNDECLARED = Layer.mergeAll(
		MemoryFileSystem.layerWith(TREE),
		Path.layer,
		WorkspaceDiscovery.layerTest({ listPackages: () => Effect.succeed(PACKAGES) }),
	);

	layer(
		UNDECLARED,
		LIVE_CLOCK,
	)((it) => {
		it.effect("flags a runtime import no manifest field declares, naming package, file and specifier", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules });
				assert.deepStrictEqual(scan.violations, [
					"@repo/app src/main.ts:7:21 undeclared left-pad",
					"@repo/app src/main.ts:8:21 undeclared undeclared-pkg",
					"@repo/app src/value.ts:1:23 undeclared types-only-pkg",
					"@repo/core src/index.ts:1:25 undeclared left-pad",
				]);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("passes a declared dependency, a declared peerDependency and a self-reference", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules });
				const dependencies = scan.undeclared.map((entry) => entry.dependency);
				assert.notInclude(dependencies, "effect");
				assert.notInclude(dependencies, "@repo/core");
				assert.notInclude(dependencies, "@effect/vitest");
				assert.notInclude(dependencies, "@repo/app");
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("never flags a node: specifier, a relative import, or a bare builtin the caller lists", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules });
				const specifiers = scan.undeclared.map((entry) => entry.specifier);
				assert.notInclude(specifiers, "node:fs");
				assert.notInclude(specifiers, "./local.js");
				assert.notInclude(specifiers, "path");
				assert.notInclude(specifiers, "@repo/app/local");
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("positive control: without a builtins list a bare builtin IS flagged, since none ships here", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared();
				assert.include(
					scan.undeclared.map((entry) => entry.label),
					"@repo/app src/main.ts:5:22 undeclared path",
				);
				const specifiers = scan.undeclared.map((entry) => entry.specifier);
				assert.notInclude(specifiers, "node:fs");
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("skips a type-only import, and counts a dynamic literal import as runtime", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules });
				const files = scan.undeclared.map((entry) => entry.file);
				assert.notInclude(files, "src/types.ts");
				assert.include(files, "src/value.ts");
				// A computed specifier is invisible to static analysis: computed.ts
				// reads no literal and is never flagged. That is the documented limit.
				assert.notInclude(files, "src/computed.ts");
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("reads only the include globs: test files and build output stay out of scope by default", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules });
				assert.deepStrictEqual(scan.packages, ["@repo/app", "@repo/core", "repo"]);
				assert.deepStrictEqual(scan.files, [
					"packages/app/src/computed.ts",
					"packages/app/src/local.ts",
					"packages/app/src/main.ts",
					"packages/app/src/types.ts",
					"packages/app/src/value.ts",
					"packages/core/src/index.ts",
				]);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("an include override widens the walk, and a devDependency still never declares", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({
					builtins: builtinModules,
					include: ["src/**", "__test__/**"],
				});
				assert.include(scan.files, "packages/app/__test__/main.test.ts");
				assert.include(
					scan.undeclared.map((entry) => entry.label),
					"@repo/app __test__/main.test.ts:1:26 undeclared vitest",
				);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("an uncompilable include glob fails typed", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(ImportGraph.undeclared({ include: ["a".repeat(65_537)] }));
				assert.strictEqual(error._tag, "GlobPatternError");
			}),
		);
	});
});

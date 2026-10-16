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
			optionalDependencies: { fsevents: "^2" },
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
		// A runtime dynamic import in a value position: `=` after `const` and
		// `await` both keep it runtime, so both specifiers are checked.
		"/repo/packages/app/src/dynamic.ts":
			'export const p = import("left-pad");\nexport const q = await import("undeclared-pkg/x");\n',
		// Every type-position `import()` shape the scanner must erase, one
		// statement per line so a regression names its line. Lines 1-10 are the
		// one-token shapes; the rest need the enclosing construct resolved:
		// interface, class and type-literal members, parameter and return
		// annotations, nested type literals, a function-type return, a mapped
		// type, a labeled tuple, a conditional false branch, a generic default, a
		// decorated member, an optional method and a destructured parameter.
		"/repo/packages/app/src/typepos.ts": `${[
			'export type Config = import("types-only-pkg").UserConfig;',
			'export type Lazy = typeof import("types-only-pkg");',
			'export declare let annotated: import("types-only-pkg").Thing;',
			'export interface Heritage extends import("types-only-pkg").Base {}',
			'export type Union = import("types-only-pkg").A | import("types-only-pkg").B;',
			'export type Fn = () => import("types-only-pkg").R;',
			'export type Tup = [import("types-only-pkg").A, import("types-only-pkg").B];',
			'export type Bound<K extends import("types-only-pkg").K> = K;',
			'export type Cond<T> = T extends import("types-only-pkg").S ? import("types-only-pkg").Y : never;',
			'export const cast = (v: unknown) => v as import("types-only-pkg").Thing;',
			'export interface Members { a: import("types-only-pkg").A; b?: import("types-only-pkg").B; readonly c: import("types-only-pkg").C; m(): import("types-only-pkg").D; n?(): import("types-only-pkg").E; [k: string]: unknown }',
			'export class Holder { prop: import("types-only-pkg").P; opt?: import("types-only-pkg").O; private priv: import("types-only-pkg").Q; method(a: import("types-only-pkg").A): import("types-only-pkg").R { return a as never; } }',
			'export function fn(a: import("types-only-pkg").A, b: import("types-only-pkg").B): import("types-only-pkg").R { return b as never; }',
			'export const arrow = (v: import("types-only-pkg").V): import("types-only-pkg").R => v as never;',
			'export const generic = <T>(v: T): Promise<import("types-only-pkg").R> => Promise.resolve(v as never);',
			'export type Obj = { a: import("types-only-pkg").A; nested: { b: import("types-only-pkg").B } };',
			'export type FnObj = (a: string) => { r: import("types-only-pkg").R };',
			'export type Mapped = { [K in keyof import("types-only-pkg").M]: import("types-only-pkg").V };',
			'export type Index = { [k: string]: import("types-only-pkg").V };',
			'export let tuple: [a: import("types-only-pkg").A, b?: import("types-only-pkg").B];',
			'export type CondFalse<T> = T extends string ? never : import("types-only-pkg").F;',
			'export type Dflt<T = import("types-only-pkg").D> = T;',
			'export type Deep = Promise<Array<import("types-only-pkg").A>>;',
			'export const obj = { m(): import("types-only-pkg").R { return 1 as never; } };',
			'export class Decorated { @Input() field: import("types-only-pkg").I; @Input() method(): import("types-only-pkg").R { return 1 as never; } }',
			'export const destructured = ({ a }: import("types-only-pkg").D) => a;',
			'export const typed: Promise<unknown> | null = null satisfies import("types-only-pkg").S;',
			'export function guard(v: unknown): v is import("types-only-pkg").G { return v === v; }',
			'declare module "ambient" { export function d(): import("types-only-pkg").D; }',
		].join("\n")}\n`,
		// Every runtime `import()` the scanner must keep, one per line with its
		// own specifier so a miss names the line: a typed initializer, an arrow
		// body inside a typed array, a ternary after a comparison, an object
		// property value, a ternary else branch, a generic call argument, a class
		// property initializer, a return ternary, a nested object literal, a call
		// argument object, an array element, a union-typed initializer, a default
		// parameter, a generic arrow body, an explicit-return-type arrow body,
		// and then call arguments and ternaries inside the body of a function,
		// method or class whose signature carries a return type, an implements
		// clause or a generic bound the walk must not reach.
		"/repo/packages/app/src/runtimepos.ts": `${[
			'export const loaders: Array<() => Promise<unknown>> = [() => import("rt-a")];',
			'export const p: Promise<unknown> = import("rt-b");',
			'export const f = (n: number) => n < 2 ? import("rt-c") : null;',
			'export const m = { mod: import("rt-d") };',
			'export const g = (ok: boolean) => ok ? null : import("rt-e");',
			'export const load = Promise.all<unknown[]>([import("rt-f")]);',
			'export class Box { static mod = import("rt-g"); }',
			'export function h(flag: boolean) { return flag ? import("rt-h") : import("rt-i"); }',
			'export const nested = { inner: { deep: import("rt-j") } };',
			'export const call = Promise.resolve({ opt: import("rt-k") });',
			'export const arr = [1, import("rt-l")];',
			'export const o: Promise<unknown> | null = 3 > 2 ? import("rt-m") : null;',
			'export const dflt = (x = import("rt-n")) => x;',
			'export const generic = <T>(x: T): Promise<unknown> => import("rt-o");',
			'export const chain = (a?: { b: number }) => a?.b ? import("rt-p") : null;',
			'export function register(registry: Map<string, unknown>): Map<string, unknown> { registry.set("a", import("rt-q")); return registry; }',
			'export class Loader { init(): Promise<unknown> { loaders.push(1, import("rt-r")); return Promise.resolve(); } }',
			'export function go(flag: boolean): object { flag ? import("rt-s") : null; return {}; }',
			'export const api = { load(): object { registry.set("k", import("rt-t")); return {}; } };',
			'export class Svc implements Api { start() { run(1, import("rt-u")); } }',
			'export function bound<T extends object>(v: T) { use(v, import("rt-v")); }',
			'export default function (): object { return cond ? import("rt-w") : {}; }',
		].join("\n")}\n`,
		// TypeScript reads `import type from "x"` as a runtime default import of
		// a binding named `type`: flagged. Only the doubled `from` (or `=`) form
		// makes `type` the keyword: not flagged.
		"/repo/packages/app/src/typefrom.ts": 'import type from "types-only-pkg";\nexport const binding = type;\n',
		"/repo/packages/app/src/typefromfrom.ts": 'import type from from "types-only-pkg";\nexport type T = from;\n',
		// An optionalDependency IS declared: npm and pnpm install it by default.
		"/repo/packages/app/src/optional.ts": 'try { await import("fsevents"); } catch {}\nexport const o = 1;\n',
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
				// runtimepos.ts has its own line-by-line assertion below.
				assert.deepStrictEqual(
					scan.violations.filter((label) => !label.includes("src/runtimepos.ts")),
					[
						"@repo/app src/dynamic.ts:1:25 undeclared left-pad",
						"@repo/app src/dynamic.ts:2:31 undeclared undeclared-pkg",
						"@repo/app src/main.ts:7:21 undeclared left-pad",
						"@repo/app src/main.ts:8:21 undeclared undeclared-pkg",
						"@repo/app src/typefrom.ts:1:18 undeclared types-only-pkg",
						"@repo/app src/value.ts:1:23 undeclared types-only-pkg",
						"@repo/core src/index.ts:1:25 undeclared left-pad",
					],
				);
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
				// A runtime dynamic import in a value position IS checked.
				assert.include(files, "src/dynamic.ts");
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("never flags an import() in a type position: the compiler erases it", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules });
				assert.deepStrictEqual(
					scan.undeclared.filter((entry) => entry.file === "src/typepos.ts").map((entry) => entry.label),
					[],
				);
				// The check did read the file: it is in scope, just clean.
				assert.include(scan.files, "packages/app/src/typepos.ts");
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("flags every runtime import() whose enclosing construct is a value, one per fixture line", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules });
				const found = scan.undeclared
					.filter((entry) => entry.file === "src/runtimepos.ts")
					.map((entry) => `${entry.line}:${entry.dependency}`);
				// Line 8 holds two: the ternary's true and false branches.
				const expected = [
					"1:rt-a",
					"2:rt-b",
					"3:rt-c",
					"4:rt-d",
					"5:rt-e",
					"6:rt-f",
					"7:rt-g",
					"8:rt-h",
					"8:rt-i",
					"9:rt-j",
					"10:rt-k",
					"11:rt-l",
					"12:rt-m",
					"13:rt-n",
					"14:rt-o",
					"15:rt-p",
					"16:rt-q",
					"17:rt-r",
					"18:rt-s",
					"19:rt-t",
					"20:rt-u",
					"21:rt-v",
					"22:rt-w",
				];
				assert.deepStrictEqual(found, expected);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect('flags `import type from "x"`: TypeScript reads it as a runtime default import named type', () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules });
				assert.include(
					scan.undeclared.map((entry) => entry.label),
					"@repo/app src/typefrom.ts:1:18 undeclared types-only-pkg",
				);
				// The doubled-from form IS type-only: the first `from` is the binding.
				assert.notInclude(
					scan.undeclared.map((entry) => entry.file),
					"src/typefromfrom.ts",
				);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("counts optionalDependencies as declared: a packed install resolves it", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules });
				assert.notInclude(
					scan.undeclared.map((entry) => entry.dependency),
					"fsevents",
				);
				assert.include(scan.files, "packages/app/src/optional.ts");
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("reads only the include globs: test files and build output stay out of scope by default", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules });
				assert.deepStrictEqual(scan.packages, ["@repo/app", "@repo/core", "repo"]);
				assert.deepStrictEqual(scan.files, [
					"packages/app/src/computed.ts",
					"packages/app/src/dynamic.ts",
					"packages/app/src/local.ts",
					"packages/app/src/main.ts",
					"packages/app/src/optional.ts",
					"packages/app/src/runtimepos.ts",
					"packages/app/src/typefrom.ts",
					"packages/app/src/typefromfrom.ts",
					"packages/app/src/typepos.ts",
					"packages/app/src/types.ts",
					"packages/app/src/value.ts",
					"packages/core/src/index.ts",
				]);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("a root-wide glob checks each nested file once, against its innermost package only", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules, include: ["**/*.ts"] });
				// The root package walks the whole repository, but every file it
				// meets belongs to a nested package: none is attributed to `repo`.
				assert.deepStrictEqual(
					scan.undeclared.filter((entry) => entry.package === "repo"),
					[],
				);
				assert.deepStrictEqual(
					scan.files.filter((file) => file.includes("packages/app/src/main.ts")),
					["packages/app/src/main.ts"],
				);
				// No file is listed twice: once under its own package, never
				// again under the root walk.
				assert.strictEqual(new Set(scan.files).size, scan.files.length);
				// The nested packages' own violations are still reported, under
				// their own names.
				assert.include(
					scan.undeclared.map((entry) => entry.label),
					"@repo/app src/main.ts:7:21 undeclared left-pad",
				);
				assert.include(
					scan.undeclared.map((entry) => entry.label),
					"@repo/core src/index.ts:1:25 undeclared left-pad",
				);
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

	// The same shape with the package list reversed: `listPackages` promises no
	// order, and `app` sits directly under the root, where
	// `path.relative("/repo/app", "/repo")` answers `..`.
	const NESTED_TREE = {
		"/repo/src/index.ts": 'import { join } from "path";\nexport const i = join;\n',
		"/repo/app/src/main.ts": 'import { pad } from "left-pad";\nexport const m = pad;\n',
		"/repo/app/src/local.ts": "export const x = 1;\n",
	};
	const NESTED_PACKAGES = [pkg("@repo/app", "app"), pkg("repo", ".")];

	layer(
		Layer.mergeAll(
			MemoryFileSystem.layerWith(NESTED_TREE),
			Path.layer,
			WorkspaceDiscovery.layerTest({ listPackages: () => Effect.succeed(NESTED_PACKAGES) }),
		),
		LIVE_CLOCK,
	)((it) => {
		it.effect("the innermost package owns a nested file whichever order listPackages answers in", () =>
			Effect.gen(function* () {
				const scan = yield* ImportGraph.undeclared({ builtins: builtinModules, include: ["**/*.ts"] });
				// The root walks the whole repository here. Every file it meets
				// below `/repo/app` belongs to `app`, so the root reports none.
				assert.deepStrictEqual(
					scan.undeclared.filter((entry) => entry.package === "repo"),
					[],
				);
				// No file is listed twice, and `app`'s own violation is
				// reported under `app`'s name.
				assert.strictEqual(new Set(scan.files).size, scan.files.length);
				assert.include(
					scan.undeclared.map((entry) => entry.label),
					"@repo/app src/main.ts:1:21 undeclared left-pad",
				);
				// The root still owns and checks its own file.
				assert.include(scan.files, "src/index.ts");
			}).pipe(Effect.timeout("3 seconds")),
		);
	});
});

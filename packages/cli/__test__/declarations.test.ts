import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(PACKAGE, "src");
/** The dev build: the test pre-build refreshes it, and its declaration rollup is the one the prod build ships. */
const BUILT = join(PACKAGE, "dist", "dev");
const TSC = join(PACKAGE, "node_modules", ".bin", "tsc");

/** The public names a source entrypoint re-exports: every name in its `export { … } from` lines, aliases resolved. */
const sourceExports = (text: string): ReadonlyArray<string> =>
	[...text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}\s*from\s/gm)]
		.flatMap((match) => (match[1] ?? "").split(","))
		.map((name) =>
			(
				name
					.trim()
					.replace(/^type\s+/, "")
					.split(/\s+as\s+/)
					.at(-1) ?? ""
			).trim(),
		)
		.filter((name) => name !== "")
		.filter((name, index, names) => names.indexOf(name) === index)
		.sort();

const CONSUMER = `import { CliTheme } from "@effected/cli";
import type { KeyName, Screen } from "@effected/cli/ui";
import { CliUi } from "@effected/cli/ui";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Effect } from "effect";

const program = CliUi.run<number>(() => {
	throw new Error("never mounted");
}).pipe(Effect.provide(CliTheme.layerTest()));

export const provided: Effect.Effect<number, unknown, never> = program;
const screen: Screen<number> = () => {
	throw new Error("never mounted");
};
const keys: ReadonlyArray<KeyName> = ["up", "enter"];
export const driven: Effect.Effect<number, unknown, never> = Effect.scoped(
	Effect.flatMap(CliUiTest.render(screen), (handle) => Effect.andThen(handle.press(...keys), handle.result)),
);
`;

/** The live control: a requirement left unprovided must be reported, or the gate cannot fail. */
const UNPROVIDED = `import { CliUi } from "@effected/cli/ui";
import type { Effect } from "effect";

export const unprovided: Effect.Effect<number, unknown, never> = CliUi.run<number>(() => {
	throw new Error("never mounted");
});
`;

const TSCONFIG = {
	compilerOptions: {
		strict: true,
		exactOptionalPropertyTypes: true,
		module: "nodenext",
		moduleResolution: "nodenext",
		target: "es2022",
		noEmit: true,
		skipLibCheck: true,
		types: ["node"],
	},
	files: ["consumer.ts", "unprovided.ts"],
};

/** Compile the two consumers against the built declarations, in a scratch directory outside the repo. */
const compileConsumers = (): ReadonlyArray<string> => {
	const fixture = mkdtempSync(join(tmpdir(), "cli-declarations-"));
	try {
		mkdirSync(join(fixture, "node_modules", "@effected"), { recursive: true });
		mkdirSync(join(fixture, "node_modules", "@types"), { recursive: true });
		symlinkSync(join(BUILT, "pkg"), join(fixture, "node_modules", "@effected", "cli"), "dir");
		symlinkSync(realpathSync(join(PACKAGE, "node_modules", "effect")), join(fixture, "node_modules", "effect"), "dir");
		symlinkSync(
			realpathSync(join(PACKAGE, "node_modules", "@types", "node")),
			join(fixture, "node_modules", "@types", "node"),
			"dir",
		);
		writeFileSync(join(fixture, "consumer.ts"), CONSUMER);
		writeFileSync(join(fixture, "unprovided.ts"), UNPROVIDED);
		writeFileSync(join(fixture, "tsconfig.json"), JSON.stringify(TSCONFIG));
		// Run inside the fixture so tsc reports each file by its bare name.
		const result = spawnSync(TSC, ["-p", "."], { cwd: fixture, encoding: "utf8" });
		return `${result.stdout}${result.stderr}`
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "");
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
};

/** A top-level declaration in a rolled-up `.d.ts`: its name, and whether the line itself exports it. */
const TOP_LEVEL_DECLARATION =
	/^(export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|const|let|var|function|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm;
/** An `export { … }` or `export type { … }` list without a `from`: the names it exports from this file. */
const EXPORT_LIST = /^export\s+(?:type\s+)?\{([^}]*)\}\s*;?\s*$/gm;

/**
 * The top-level declarations a rolled-up `.d.ts` keeps but does not export. In a rollup a forgotten export shows up as
 * exactly this, a local `declare`, `interface` or `type` a public signature names. The `_base` constants a Schema
 * or Context class extends are the one sanctioned kind.
 */
const unexportedDeclarations = (dts: string): ReadonlyArray<string> => {
	const declared = new Map<string, boolean>();
	for (const match of dts.matchAll(TOP_LEVEL_DECLARATION)) declared.set(match[2] ?? "", match[1] !== undefined);
	const listed = new Set(
		[...dts.matchAll(EXPORT_LIST)].flatMap((match) =>
			(match[1] ?? "")
				.split(",")
				.map(
					(name) =>
						name
							.trim()
							.replace(/^type\s+/, "")
							.split(/\s+as\s+/)[0] ?? "",
				)
				.filter((name) => name !== ""),
		),
	);
	return [...declared]
		.filter(([name, inline]) => !inline && !listed.has(name) && !name.endsWith("_base"))
		.map(([name]) => name)
		.sort();
};

/** The names a rolled-up `.d.ts` exports: inline `export declare …` lines and `export { … }` lists, by public name. */
const builtExports = (dts: string): ReadonlyArray<string> => {
	const inline = [...dts.matchAll(TOP_LEVEL_DECLARATION)]
		.filter((match) => match[1] !== undefined)
		.map((match) => match[2] ?? "");
	const listed = [...dts.matchAll(EXPORT_LIST)].flatMap((match) =>
		(match[1] ?? "")
			.split(",")
			.map((name) =>
				(
					name
						.trim()
						.replace(/^type\s+/, "")
						.split(/\s+as\s+/)
						.at(-1) ?? ""
				).trim(),
			)
			.filter((name) => name !== ""),
	);
	// A name exported as both a type and a value (`export type UiKey` beside `export declare const UiKey`) is one name.
	return [...new Set([...inline, ...listed])].sort();
};

/** Each source entrypoint, the rolled-up declarations built from it, and the package import it must keep external. */
const ENTRIES: ReadonlyArray<{ readonly source: string; readonly built: string; readonly external: string }> = [
	{ source: "ui.ts", built: "ui.d.ts", external: "@effected/cli" },
	{ source: "ui-testing.ts", built: "ui-testing.d.ts", external: "@effected/cli/ui" },
];

/**
 * The exported names of a rolled-up `.d.ts` whose declaration carries no release tag. API Extractor's own
 * `ae-missing-release-tag` never reaches the build report for the ui entries (its per-module pass fails on the
 * self-referencing import), so this re-pins it: every declaration of every exported name must be preceded by a TSDoc
 * block with `@public`, `@beta`, `@alpha` or `@internal`.
 */
const untaggedExports = (dts: string): ReadonlyArray<string> => {
	// Each export by its public name, with the rollup-local name its declaration carries (`export { Foo$1 as Foo }`).
	const bindings = new Map<string, string>();
	for (const match of dts.matchAll(TOP_LEVEL_DECLARATION)) {
		if (match[1] !== undefined) bindings.set(match[2] ?? "", match[2] ?? "");
	}
	for (const match of dts.matchAll(EXPORT_LIST)) {
		for (const entry of (match[1] ?? "").split(",")) {
			const [local, exported] = entry
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/);
			if (local !== undefined && local !== "") bindings.set((exported ?? local).trim(), local.trim());
		}
	}
	const escapeRegex = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return [...bindings]
		.filter(([, local]) => {
			const declarations = [
				...dts.matchAll(
					new RegExp(
						`(\\/\\*\\*(?:(?!\\*\\/)[\\s\\S])*\\*\\/\\s*)?^(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:class|interface|type|const|let|var|function|enum|namespace)\\s+${escapeRegex(local)}(?![\\w$])`,
						"gm",
					),
				),
			];
			return (
				declarations.length === 0 ||
				declarations.some((match) => !/@(?:public|beta|alpha|internal)\b/.test(match[1] ?? ""))
			);
		})
		.map(([exported]) => exported)
		.sort();
};

describe("the built declarations", () => {
	it("match the source entrypoints they were built from, or the gates below would read a stale build", () => {
		for (const entry of ENTRIES) {
			const source = sourceExports(readFileSync(join(SRC, entry.source), "utf8"));
			const dts = readFileSync(join(BUILT, "pkg", entry.built), "utf8");
			assert.isNotEmpty(source, `${entry.source} was read`);
			assert.deepStrictEqual(
				builtExports(dts),
				source,
				`${entry.built} does not export what ${entry.source} does: run pnpm build --filter @effected/cli`,
			);
			assert.include(
				dts,
				`from "${entry.external}";`,
				`${entry.built} imports ${entry.external} instead of copying it`,
			);
		}
	});

	it("mutation control: an export missing from, or extra in, the built declarations is a mismatch", () => {
		const source = 'export { A, type B } from "./a.js";\nexport type { C as D } from "./c.js";\n';
		assert.deepStrictEqual(sourceExports(source), ["A", "B", "D"]);
		const built = "export declare class A {}\ninterface B {}\ntype D = string;\nexport type { B, D };\n";
		assert.deepStrictEqual(builtExports(built), sourceExports(source));
		assert.notDeepEqual(
			builtExports(built.replace("export type { B, D };", "export type { B };")),
			sourceExports(source),
		);
		assert.notDeepEqual(builtExports(`${built}export declare class E {}\n`), sourceExports(source));
		assert.deepStrictEqual(
			builtExports(`${built}export declare const D: unknown;\n`),
			sourceExports(source),
			"a name exported as both a type and a value counts once",
		);
	});

	it("let a consumer provide CliUi.run's CliTheme from the root entrypoint, leaving no requirement", () => {
		const diagnostics = compileConsumers();
		const consumer = diagnostics.filter((line) => line.startsWith("consumer.ts"));
		const unprovided = diagnostics.filter((line) => line.startsWith("unprovided.ts"));
		assert.deepStrictEqual(consumer, [], "the root's CliTheme layer satisfies ./ui's requirement");
		assert.isNotEmpty(unprovided, "live control: an unprovided CliTheme is reported, so the gate can fail");
		assert.isTrue(
			unprovided.some((line) => line.includes("CliTheme")),
			`the control fails for the requirement, not something else: ${unprovided.join(" | ")}`,
		);
	}, 60_000);

	it("leave no top-level declaration in ui.d.ts or ui-testing.d.ts unexported, so the scoped suppression hides nothing", () => {
		for (const entry of ["ui.d.ts", "ui-testing.d.ts"]) {
			const dts = readFileSync(join(BUILT, "pkg", entry), "utf8");
			assert.isAbove([...dts.matchAll(TOP_LEVEL_DECLARATION)].length, 0, `${entry} was read and parsed`);
			assert.deepStrictEqual(unexportedDeclarations(dts), [], entry);
		}
	});

	it("give every export of ui.d.ts and ui-testing.d.ts a release tag, which API Extractor does not report for them", () => {
		for (const entry of ENTRIES) {
			const dts = readFileSync(join(BUILT, "pkg", entry.built), "utf8");
			assert.isNotEmpty(builtExports(dts), `${entry.built} was read`);
			assert.deepStrictEqual(untaggedExports(dts), [], entry.built);
		}
	});

	it("mutation control: an untagged export, or an untagged second declaration of a name, is flagged", () => {
		const tagged = [
			"/**\n * A thing.\n *\n * @public\n */\nexport declare class A {}",
			"/** B. @public */\ninterface B {}",
			"/**\n * C, the type.\n * @public\n */\nexport type C = string;",
			"/**\n * C, the value.\n * @public\n */\nexport declare const C: unknown;",
			"export type { B };",
		].join("\n");
		assert.deepStrictEqual(untaggedExports(tagged), []);
		assert.deepStrictEqual(untaggedExports(`${tagged}\nexport declare const D: number;`), ["D"]);
		assert.deepStrictEqual(
			untaggedExports(`${tagged}\n/** E, documented but untagged. */\nexport declare function E(): void;`),
			["E"],
		);
		assert.deepStrictEqual(
			untaggedExports(tagged.replace("/**\n * C, the value.\n * @public\n */\n", "")),
			["C"],
			"every declaration of a name needs its own tag",
		);
		assert.deepStrictEqual(
			untaggedExports(tagged.replace("/** B. @public */\n", "/** B. @public */\n// spacer\n")),
			["B"],
			"a tag in a block that does not immediately precede the declaration does not count",
		);
	});

	it("mutation control: a name with regex characters, and an export renamed from a rollup-local name, resolve", () => {
		const dollar = "/** A dollar name. @public */\nexport declare const a$b: number;";
		assert.deepStrictEqual(untaggedExports(dollar), [], "a $ in a name is matched literally");
		assert.deepStrictEqual(untaggedExports("export declare const a$b: number;"), ["a$b"]);
		const aliased = "/**\n * Foo.\n * @public\n */\ndeclare class Foo$1 {}\nexport { Foo$1 as Foo };";
		assert.deepStrictEqual(untaggedExports(aliased), [], "the alias resolves to the local declaration");
		assert.deepStrictEqual(untaggedExports("declare class Foo$1 {}\nexport { Foo$1 as Foo };"), ["Foo"]);
	});

	it("mutation control: an unexported ui-local declaration is flagged, an exported or _base one is not", () => {
		const clean = [
			'import * as Cli from "@effected/cli";',
			"interface Shape {\n\treadonly a: Cli.StreamTheme;\n}",
			"type Alias<A> = (a: A) => void;",
			"declare const Thing_base: unknown;",
			"export declare class Thing extends Thing_base {}",
			"export declare function run(): void;",
			"export type { Alias, Shape as ShapeOut };",
		].join("\n");
		assert.deepStrictEqual(unexportedDeclarations(clean), []);
		assert.deepStrictEqual(unexportedDeclarations(`${clean}\ninterface Forgotten {}`), ["Forgotten"]);
		assert.deepStrictEqual(unexportedDeclarations(`${clean}\ndeclare class Cancelled {}`), ["Cancelled"]);
		assert.deepStrictEqual(unexportedDeclarations(`${clean}\ntype Leaked = string;`), ["Leaked"]);
		assert.deepStrictEqual(
			unexportedDeclarations(clean.replace("export type { Alias, Shape as ShapeOut };", "export type { Alias };")),
			["Shape"],
			"dropping a name from the export list is a forgotten export",
		);
	});
});

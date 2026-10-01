import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(PACKAGE, "src");
/** The dev build: the test pre-build refreshes it, and its declaration rollup is the one the prod build ships. */
const BUILT = join(PACKAGE, "dist", "dev");
const TSC = join(PACKAGE, "node_modules", ".bin", "tsc");

/** The newest modification time of any file under `dir`. */
const newestMtime = (dir: string): number =>
	Math.max(
		...(readdirSync(dir, { recursive: true }) as ReadonlyArray<string>).map(
			(file) => statSync(join(dir, file)).mtimeMs,
		),
	);

const CONSUMER = `import { CliTheme } from "@effected/cli";
import { CliUi } from "@effected/cli/ui";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Effect } from "effect";

const program = CliUi.run<number>(() => {
	throw new Error("never mounted");
}).pipe(Effect.provide(CliTheme.layerTest()));

export const provided: Effect.Effect<number, unknown, never> = program;
export const harness: typeof CliUiTest = CliUiTest;
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

describe("the built declarations", () => {
	it("are newer than every source file, or the gate below would read a stale build", () => {
		const { generatedAt } = JSON.parse(readFileSync(join(BUILT, "issues.json"), "utf8")) as { generatedAt: string };
		assert.isAtLeast(
			Date.parse(generatedAt),
			newestMtime(SRC),
			"dist/dev predates a source edit: run pnpm build --filter @effected/cli (the test pre-build does this)",
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

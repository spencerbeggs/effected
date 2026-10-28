import { existsSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";

describe("the @effected/env entrypoint", () => {
	it("exports exactly the public runtime surface", async () => {
		const main = await import("../src/index.js");
		assert.deepStrictEqual(Object.keys(main).sort(), [
			"Audience",
			"CurrentRuntimeEnv",
			"EnvOverride",
			"RuntimeEnv",
			"ShellExports",
			"ShellExportsError",
			"TerminalEnv",
		]);
	});
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * `stripTypeScriptTypes` is experimental and says so once per process. That one warning is held back from Node's
 * stderr printer for this file; every other warning is still forwarded, and the printer is restored afterwards.
 */
const STRIP_WARNING = /stripTypeScriptTypes is an experimental feature/;
let printers: Array<(warning: Error) => void> = [];
const onWarning = (warning: Error): void => {
	if (STRIP_WARNING.test(warning.message)) return;
	for (const print of printers) print.call(process, warning);
};
beforeAll(() => {
	printers = process.listeners("warning") as Array<(warning: Error) => void>;
	process.removeAllListeners("warning");
	process.on("warning", onWarning);
});
afterAll(async () => {
	await new Promise((resolve) => setImmediate(resolve));
	process.off("warning", onWarning);
	for (const print of printers) process.on("warning", print);
});

/** A static `import … from "x";` or `export … from "x";` statement, across lines as the formatter wraps it. */
const STATEMENT = /^(?:import|export)\b[^;]*?\bfrom\s*"[^"]+";/gm;

/**
 * The specifiers a module still imports once its types are erased: what a runtime loads.
 *
 * @remarks
 * Node's own type stripper judges each static statement alone (it refuses a whole file with a parameter property in
 * strip mode): a statement it erases entirely is type-only and is blanked. Every specifier left in the text, an
 * `import()` included, is then read by `SourceBoundary.importSpecifiers`. An `import type` and an all-`type` list are
 * gone; a list with one value specifier stays.
 */
const runtimeSpecifiers = (source: string): ReadonlyArray<string> =>
	SourceBoundary.importSpecifiers(
		source.replace(STATEMENT, (statement) =>
			stripTypeScriptTypes(statement, { mode: "strip" }).trim() === "" ? "" : statement,
		),
	);

/** Every source file reachable from `entry` through relative runtime imports, with the bare specifiers each loads. */
const runtimeReach = (entry: string) => {
	const files = new Map<string, { readonly raw: string; readonly bare: ReadonlyArray<string> }>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.shift() as string;
		if (files.has(file)) continue;
		const raw = readFileSync(file, "utf8");
		const specifiers = runtimeSpecifiers(raw);
		files.set(file, { raw, bare: specifiers.filter((specifier) => !specifier.startsWith(".")) });
		for (const specifier of specifiers.filter((s) => s.startsWith("."))) {
			const target = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
			assert.isTrue(existsSync(target), `${file} imports ${specifier}, which resolves to no file`);
			queue.push(target);
		}
	}
	return files;
};

describe("what @effected/env's root loads at runtime", () => {
	it("positive control: a value import of effect/cli is seen, and an import type is erased", () => {
		assert.deepStrictEqual(
			runtimeSpecifiers('import { TerminalCapabilities } from "effect/cli";\nTerminalCapabilities;'),
			["effect/cli"],
		);
		assert.deepStrictEqual(runtimeSpecifiers('import type { TerminalCapabilities } from "effect/cli";'), []);
		assert.deepStrictEqual(runtimeSpecifiers('import { type A, B } from "effect/cli";\nB;'), ["effect/cli"]);
	});

	it("`.` never loads effect/cli: its only reference to it is type-only", () => {
		const reach = runtimeReach(join(SRC, "index.ts"));
		const terminalEnv = reach.get(join(SRC, "TerminalEnv.ts"));
		assert.isDefined(terminalEnv, "the walk reached TerminalEnv.ts through the runtime graph");
		assert.isAbove(reach.size, 8, "the walk followed the relative imports");
		// The control that makes the next assertion mean something: the source does name effect/cli, as a type.
		assert.include(terminalEnv?.raw, 'from "effect/cli"');
		const loaders = [...reach].filter(([, { bare }]) =>
			bare.some((s) => s === "effect/cli" || s.startsWith("effect/cli/")),
		);
		assert.deepStrictEqual(
			loaders.map(([file]) => file),
			[],
			"effect/cli exports TerminalCapabilities only through its barrel; a value import loads it for every env consumer",
		);
	});
});

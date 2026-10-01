import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** The public names a source entrypoint re-exports, aliases resolved. */
const entryExports = (file: string): ReadonlyArray<string> =>
	[...readFileSync(join(SRC, file), "utf8").matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}\s*from\s/gm)]
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
		.filter((name) => name !== "");

/** Link targets outside this package that a ui doc may name. */
const EXTERNAL: ReadonlySet<string> = new Set(["effect", "Effect", "Layer", "Context", "Scope"]);

/**
 * The `{@link …}` targets in `text` whose first identifier names nothing a consumer can reach. A link inside an
 * `@internal` block is skipped: it never reaches a public declaration. URLs are skipped.
 */
const unresolvedLinks = (text: string, known: ReadonlySet<string>): ReadonlyArray<string> =>
	[...text.matchAll(/\/\*\*[\s\S]*?\*\//g)]
		.map((match) => match[0])
		.filter((block) => !/@internal\b/.test(block))
		.flatMap((block) => [...block.matchAll(/\{@link\s+([^}\s|]+)/g)].map((match) => match[1] ?? ""))
		.filter((target) => !target.includes("://"))
		.filter((target) => {
			const first = /^[A-Za-z_$][\w$]*/.exec(target)?.[0];
			return first === undefined || !(known.has(first) || EXTERNAL.has(first));
		});

/**
 * Why this exists: API Extractor's `ae-unresolved-link` never reaches the build report for the ui entries (their
 * per-module pass fails on the self-referencing import), so a dangling link in a ui doc would ship silently.
 */
describe("TSDoc links in the ui sources", () => {
	const known = new Set([...entryExports("ui.ts"), ...entryExports("ui-testing.ts"), ...entryExports("index.ts")]);

	it("name only what a consumer can reach: an export of ./ui, ./ui/testing or the root, or a known external", () => {
		const files = (readdirSync(SRC, { recursive: true }) as ReadonlyArray<string>)
			.map((file) => file.split(sep).join("/"))
			.filter((file) => file.endsWith(".ts") && /^ui(?:\.ts$|-testing\.ts$|\/)/.test(file));
		assert.include(files, "ui/CliUi.ts", "the walk read the ui tree");
		const offenders = files.flatMap((file) =>
			unresolvedLinks(readFileSync(join(SRC, file), "utf8"), known).map((target) => `${file} ${target}`),
		);
		assert.deepStrictEqual(offenders, []);
	});

	it("mutation control: a dangling link is flagged; an exported, external, internal-block or URL link is not", () => {
		assert.isTrue(known.has("CliUi") && known.has("CliUiTest") && known.has("Style"), "the export lists were read");
		const text = (doc: string): string => `/**\n * ${doc}\n */\nexport const x = 1;`;
		assert.deepStrictEqual(unresolvedLinks(text("See {@link NoSuchThing}."), known), ["NoSuchThing"]);
		assert.deepStrictEqual(
			unresolvedLinks(text("See {@link Cli.Style}."), known),
			["Cli.Style"],
			"a local import alias",
		);
		assert.deepStrictEqual(unresolvedLinks(text("See {@link CliUi.run} and {@link Style}."), known), []);
		assert.deepStrictEqual(unresolvedLinks(text("See {@link Effect.gen}."), known), []);
		assert.deepStrictEqual(unresolvedLinks(text("Internal: {@link loadInk}.\n * @internal"), known), []);
		assert.deepStrictEqual(unresolvedLinks(text("See {@link https://example.com | the site}."), known), []);
	});
});

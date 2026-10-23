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
 * The `{@link …}` targets in `text` that would not resolve from the ui entries. A target's first identifier, after any
 * `(Name:selector)` wrapper, must be an export of `./ui` or `./ui/testing`, the entries a ui doc ships in, or a known
 * external. A root-only name cannot be linked from a ui entry in any form: API Extractor models each entry on its own,
 * so a bare name and a package-qualified one (`@effected/cli#Style`) both report that the entry has no such export.
 * Write a root-only name as a code span instead. A link inside an `@internal` block is skipped, since it never reaches
 * a public declaration, and URLs are skipped.
 */
const unresolvedLinks = (text: string, ui: ReadonlySet<string>): ReadonlyArray<string> =>
	[...text.matchAll(/\/\*\*[\s\S]*?\*\//g)]
		.map((match) => match[0])
		.filter((block) => !/@internal\b/.test(block))
		.flatMap((block) => [...block.matchAll(/\{@link\s+([^}\s|]+)/g)].map((match) => match[1] ?? ""))
		.filter((target) => !target.includes("://"))
		.filter((target) => {
			const first = /^\(?([A-Za-z_$][\w$]*)/.exec(target)?.[1];
			return first === undefined || !(ui.has(first) || EXTERNAL.has(first));
		});

/**
 * Why this exists: a dangling link in a ui doc fails only the prod build's API Extractor gate, which `pnpm test` and
 * `types:check` never run, so this pins the rule where the suite sees it.
 */
describe("TSDoc links in the ui sources", () => {
	const ui = new Set([...entryExports("ui.ts"), ...entryExports("ui-testing.ts")]);
	const root = new Set(entryExports("index.ts"));

	it("name an export of ./ui or ./ui/testing (optionally selector-wrapped) or a known external; root-only names are code spans", () => {
		const files = (readdirSync(SRC, { recursive: true }) as ReadonlyArray<string>)
			.map((file) => file.split(sep).join("/"))
			.filter((file) => file.endsWith(".ts") && /^ui(?:\.ts$|-testing\.ts$|\/)/.test(file));
		assert.include(files, "ui/CliUi.ts", "the walk read the ui tree");
		const offenders = files.flatMap((file) =>
			unresolvedLinks(readFileSync(join(SRC, file), "utf8"), ui).map((target) => `${file} ${target}`),
		);
		assert.deepStrictEqual(offenders, []);
	});

	it("mutation control: dangling, alias and bare root-only links are flagged; the rest are not", () => {
		assert.isTrue(ui.has("CliUi") && ui.has("CliUiTest") && root.has("Style"), "the export lists were read");
		assert.isFalse(ui.has("Style"), "Style is root-only");
		const links = (doc: string): ReadonlyArray<string> =>
			unresolvedLinks(`/**\n * ${doc}\n */\nexport const x = 1;`, ui);
		assert.deepStrictEqual(links("See {@link NoSuchThing}."), ["NoSuchThing"]);
		assert.deepStrictEqual(links("See {@link Cli.Style}."), ["Cli.Style"], "a local import alias");
		assert.deepStrictEqual(links("See {@link Style}."), ["Style"], "a root-only name is not a ui export");
		assert.deepStrictEqual(links("See {@link @effected/cli#Style}."), ["@effected/cli#Style"], "nor package-qualified");
		assert.deepStrictEqual(links("See {@link (CliUi:class)}."), [], "a selector wraps a ui export");
		assert.deepStrictEqual(links("See {@link (NoSuch:type)}."), ["(NoSuch:type)"]);
		assert.deepStrictEqual(links("See {@link CliUi.run}."), []);
		assert.deepStrictEqual(links("See {@link Effect.gen}."), []);
		assert.deepStrictEqual(links("Internal: {@link loadInk}.\n * @internal"), []);
		assert.deepStrictEqual(links("See {@link https://example.com | the site}."), []);
	});
});

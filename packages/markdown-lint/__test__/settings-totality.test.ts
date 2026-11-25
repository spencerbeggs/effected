// Every rule is total over its settings, as the settings readers in `src/internal/settings.ts` promise: a value whose
// conversion to a primitive throws (an object with no prototype, a throwing `toString`), inside a list or not, and a
// frozen or prototype-less settings object, read as markdownlint would read a value it cannot use, never as a throw.
// Each rule's setting names come from markdownlint's own config schema, so a setting a port reads is covered.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { rules } from "../src/rules/all.js";

interface SchemaRule {
	readonly properties?: Readonly<Record<string, unknown>>;
	readonly oneOf?: ReadonlyArray<{ readonly properties?: Readonly<Record<string, unknown>> }>;
}

// The schema is not an export of the package; read it beside the installed copy the oracle loads.
const schemaPath = join(
	import.meta.dirname,
	"..",
	"node_modules",
	"markdownlint",
	"schema",
	"markdownlint-config-schema.json",
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
	readonly properties: Readonly<Record<string, SchemaRule>>;
};

// A rule's setting names, as markdownlint's schema lists them.
const settingNames = (name: string): ReadonlyArray<string> => {
	const entry = schema.properties[name];
	const properties = entry?.properties ?? entry?.oneOf?.find((each) => each.properties !== undefined)?.properties;
	return Object.keys(properties ?? {});
};

const throwing = { toString: () => assert.fail("converted"), valueOf: () => assert.fail("converted") };
const hostileValues: ReadonlyArray<readonly [string, () => unknown]> = [
	["a prototype-less object", () => Object.create(null)],
	["a throwing toString", () => throwing],
	["a list holding a prototype-less object", () => [Object.create(null)]],
	["a list holding a throwing toString", () => ["a", throwing]],
	["a frozen list of them", () => Object.freeze([Object.create(null), throwing])],
	["a symbol", () => Symbol("s")],
];

// Documents reaching every rule's reading of its settings: headings, lists, emphasis, code, HTML, links, tables.
const source = [
	"# Title",
	"",
	"* item *emphasis* and __strong__",
	"  - nested `code` <span>x</span>",
	"",
	"1. one",
	"3. three",
	"",
	"```js",
	"\tconst javascript = 1;",
	"```",
	"",
	"[link](#missing) [ref][r] https://example.com",
	"",
	"| a | b |",
	"|:--|--:|",
	"| c |",
	"",
	"[r]: https://example.com",
	"",
].join("\n");

describe("rule settings, hostile values", () => {
	it("covers every rule with settings", () => {
		const withSettings = rules.filter((rule) => settingNames(rule.names[0] as string).length > 0);
		assert.isAtLeast(withSettings.length, 30);
	});

	for (const rule of rules) {
		const name = rule.names[0] as string;
		const names = settingNames(name);
		if (names.length === 0) continue;
		it(`${name} is total over ${names.join(", ")}`, () => {
			for (const [label, value] of hostileValues) {
				for (const setting of names) {
					const settings = Object.freeze(Object.assign(Object.create(null), { [setting]: value() }));
					const config = Object.freeze({ default: false, [name]: settings });
					let threw: unknown;
					try {
						MarkdownLint.lint(source, [rule], { config });
					} catch (error) {
						threw = error;
					}
					assert.isUndefined(threw, `${name}.${setting} as ${label}`);
				}
			}
		});
	}
});

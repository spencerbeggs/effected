// The rule metadata gate and the root-purity gate. Every ported rule carries
// markdownlint's own names, description, tags and documentation link, sits in
// markdownlint's order, and every built-in rule is either ported or listed as
// uncovered; `./rules` exports exactly `./rules/all`'s rules. The package root
// never reaches a rule or config module, `node:` or a format engine.

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { rules, uncovered } from "../src/rules/all.js";
import * as ruleExports from "../src/rules/index.js";
import { oracleRules } from "./helpers/markdownlint-oracle.js";

const oracle = oracleRules();
const oracleByName = new Map(oracle.map((rule) => [rule.names[0], rule]));
const oracleOrder = oracle.map((rule) => rule.names[0] as string);

describe("the rule metadata gate", () => {
	it("reads markdownlint's 53 built-in rules", () => {
		assert.lengthOf(oracle, 53);
	});

	it("gives every ported rule markdownlint's names, description, tags and link", () => {
		for (const rule of rules) {
			const reference = oracleByName.get(rule.name);
			assert.isDefined(reference, rule.name);
			assert.deepStrictEqual([...rule.names], reference?.names, rule.name);
			assert.strictEqual(rule.description, reference?.description, rule.name);
			assert.deepStrictEqual([...rule.tags], reference?.tags, rule.name);
			assert.strictEqual(rule.information, reference?.information.href, rule.name);
		}
	});

	it("accounts for every built-in rule exactly once, ported or uncovered", () => {
		const accounted = [...rules.map((rule) => rule.name), ...uncovered];
		assert.deepStrictEqual([...accounted].sort(), [...oracleOrder].sort());
		assert.strictEqual(new Set(accounted).size, accounted.length);
	});

	it("keeps rules and uncovered in markdownlint's order", () => {
		const positions = (names: ReadonlyArray<string>) => names.map((name) => oracleOrder.indexOf(name));
		for (const list of [rules.map((rule) => rule.name), uncovered]) {
			const at = positions(list);
			assert.deepStrictEqual(
				at,
				[...at].sort((a, b) => a - b),
			);
		}
	});

	it("exports from ./rules exactly the rules ./rules/all lists", () => {
		const exported = new Set<unknown>(Object.values(ruleExports));
		const listed = new Set<unknown>(rules);
		assert.strictEqual(exported.size, Object.values(ruleExports).length);
		for (const value of exported) assert.isTrue(listed.has(value));
		for (const rule of listed) assert.isTrue(exported.has(rule));
	});
});

const srcDir = resolve(import.meta.dirname, "..", "src");

// Comments removed, so a TSDoc example's `import … from "…"` is not an edge.
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Every specifier a module names: static imports and re-exports (type-only
// ones too, the stricter reading), side-effect imports and dynamic imports.
const specifiersOf = (text: string): Array<string> => {
	const source = stripComments(text);
	const found: Array<string> = [];
	for (const match of source.matchAll(/(?:^|[\s;])(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']/g))
		found.push(match[1] as string);
	for (const match of source.matchAll(/(?:^|[\s;])import\s*["']([^"']+)["']/g)) found.push(match[1] as string);
	for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) found.push(match[1] as string);
	return found;
};

/** Walk the import graph from `entry`: every module reached, and every bare specifier named. */
const walk = (entry: string): { readonly modules: ReadonlySet<string>; readonly bare: ReadonlySet<string> } => {
	const modules = new Set<string>();
	const bare = new Set<string>();
	const pending = [resolve(srcDir, entry)];
	while (pending.length > 0) {
		const file = pending.pop() as string;
		if (modules.has(file)) continue;
		modules.add(file);
		for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
			if (specifier.startsWith(".")) pending.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
			else bare.add(specifier);
		}
	}
	return { modules, bare };
};

const under = (modules: ReadonlySet<string>, dir: string) =>
	[...modules].map((file) => relative(srcDir, file)).filter((file) => file.startsWith(`${dir}/`));

describe("the package root stays pure", () => {
	const root = walk("index.ts");

	it("reaches no rule or config module", () => {
		assert.deepStrictEqual(under(root.modules, "rules"), []);
		assert.deepStrictEqual(under(root.modules, "config"), []);
	});

	it("names no node: built-in and no format engine", () => {
		for (const specifier of root.bare) {
			assert.isFalse(specifier.startsWith("node:"), specifier);
			assert.notInclude(["@effected/jsonc", "@effected/yaml"], specifier.replace(/^(@[^/]+\/[^/]+).*$/, "$1"));
		}
	});

	it("walks the real graph: the root reaches the host, and rules/all reaches src/rules", () => {
		assert.include([...root.modules], join(srcDir, "internal", "host.ts"));
		assert.include([...root.bare], "@effected/markdown");
		assert.isAbove(under(walk("rules/all.ts").modules, "rules").length, 0);
	});
});

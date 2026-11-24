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

// After one of these, a `/` opens a regular expression literal rather than dividing.
const REGEX_PRECEDES = "(,=:[!&|?{};+-*%<>~^";

// Comments removed, so a TSDoc example's `import … from "…"` is not an edge.
// String-aware: a `"**/*.md"` or `"//x"` string opens no comment. A `/` after
// an operator or an opening bracket starts a regular expression literal, kept
// whole, so `/["']/` opens no string; a regex after a keyword (`return /x/`) is
// read as division, which src/ never writes.
const stripComments = (text: string): string => {
	let out = "";
	let prev = "";
	let at = 0;
	while (at < text.length) {
		const char = text[at] as string;
		const next = text[at + 1];
		if (char === "/" && next === "/") {
			const end = text.indexOf("\n", at);
			at = end === -1 ? text.length : end;
			continue;
		}
		if (char === "/" && next === "*") {
			const end = text.indexOf("*/", at + 2);
			at = end === -1 ? text.length : end + 2;
			out += " ";
			continue;
		}
		let end = -1;
		if (char === '"' || char === "'" || char === "`") {
			end = at + 1;
			while (end < text.length && text[end] !== char) end += text[end] === "\\" ? 2 : 1;
		} else if (char === "/" && (prev === "" || REGEX_PRECEDES.includes(prev))) {
			let inClass = false;
			end = at + 1;
			while (end < text.length && text[end] !== "\n") {
				const inner = text[end];
				if (inner === "\\") end++;
				else if (inner === "[") inClass = true;
				else if (inner === "]") inClass = false;
				else if (inner === "/" && !inClass) break;
				end++;
			}
		}
		if (end !== -1) {
			out += text.slice(at, end + 1);
			prev = char;
			at = end + 1;
			continue;
		}
		out += char;
		if (!/\s/.test(char)) prev = char;
		at++;
	}
	return out;
};

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

	it("names the package itself nowhere, type-only or not", () => {
		// The walk follows relative edges only, so a self-name edge (`export * from
		// "@effected/markdown-lint/rules/all"`) would reach a rule unwalked. The rule
		// subpaths name the root by its package name; the root never names itself.
		for (const specifier of root.bare) assert.isFalse(specifier.startsWith("@effected/markdown-lint"), specifier);
	});

	it("walks the real graph: the root reaches the host and names @effected/markdown", () => {
		assert.include([...root.modules], join(srcDir, "internal", "host.ts"));
		assert.include([...root.bare], "@effected/markdown");
	});
});

describe("the import walker's specifier reader", () => {
	it("finds every edge shape src/ writes", () => {
		const text = [
			'export * from "./star.js";',
			'export { x } from "./named.js";',
			'export type { T } from "./type-export.js";',
			'import type { U } from "./type-import.js";',
			"import {",
			"\ta,",
			"\tb,",
			'} from "./multi-line.js";',
			'import "./side-effect.js";',
			'const lazy = await import("./dynamic.js");',
		].join("\n");
		assert.deepStrictEqual([...specifiersOf(text)].sort(), [
			"./dynamic.js",
			"./multi-line.js",
			"./named.js",
			"./side-effect.js",
			"./star.js",
			"./type-export.js",
			"./type-import.js",
		]);
	});

	it("finds no specifier inside a comment", () => {
		const text = [
			'// import { z } from "./line-comment.js";',
			'/* export * from "./block-comment.js"; */',
			"/**",
			' * import { w } from "@effected/markdown-lint/rules/all";',
			" */",
			'import { kept } from "./kept.js";',
		].join("\n");
		assert.deepStrictEqual(specifiersOf(text), ["./kept.js"]);
	});

	it("opens no comment inside a string or a regular expression", () => {
		const text = [
			'const glob = "**/*.md";',
			'import { afterGlob } from "./after-glob.js";',
			"const url = 'https://example.com/x';",
			'import { afterUrl } from "./after-url.js";',
			"const quote = /[\"']/g;",
			'import { afterRegex } from "./after-regex.js";',
			"const ratio = width / 2 / 3;",
			'import { afterDivision } from "./after-division.js";',
		].join("\n");
		assert.deepStrictEqual(specifiersOf(text), [
			"./after-glob.js",
			"./after-url.js",
			"./after-regex.js",
			"./after-division.js",
		]);
	});
});

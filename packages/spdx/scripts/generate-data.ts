// Run by hand only:
//   pnpm --filter @effected/spdx exec tsx scripts/generate-data.ts
//
// Regenerates the vendored SPDX id arrays in src/internal/licenseIds.ts and
// src/internal/exceptions.ts from the installed spdx-license-ids and
// spdx-exceptions devDependencies. Locates each target array by its exported
// const identifier via oxc-parser and splices only the ArrayExpression's
// byte span, leaving the attribution header, types, and Set exports
// untouched. Never run in CI or the test suite — only scripts/** may import
// these devDeps; nothing under src/** may depend on spdx-license-ids,
// spdx-exceptions, spdx-expression-parse, or oxc-parser at runtime.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "oxc-parser";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));

// Minimal shape for the oxc ESTree nodes we traverse. oxc nodes carry
// numeric `start`/`end` byte offsets into the source string.
interface Node {
	readonly type: string;
	readonly start: number;
	readonly end: number;
	readonly [key: string]: unknown;
}

interface ArrayTarget {
	/** Name of the exported `const` whose array-literal initializer gets rewritten. */
	readonly exportName: string;
	readonly startMarker: string;
	readonly endMarker: string;
	readonly ids: readonly string[];
}

/** Sort ids by code point, not locale, so regeneration is stable across environments. */
function sortIds(ids: readonly string[]): string[] {
	return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Render a full bracketed array literal, one `"id",` element per line, framed by its marker comments. */
function renderArrayLiteral(target: ArrayTarget): string {
	const sorted = sortIds(target.ids);
	const lines = [
		"[",
		`\t// ${target.startMarker}`,
		...sorted.map((id) => `\t${JSON.stringify(id)},`),
		`\t// ${target.endMarker}`,
		"]",
	];
	return lines.join("\n");
}

/** Depth-first search for the `ArrayExpression` initializer of `export const <exportName> = [...] as const;`. */
function findArrayNode(program: Node, exportName: string): Node | undefined {
	let found: Node | undefined;
	const visit = (node: unknown): void => {
		if (found || node === null || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		const n = node as Node;
		if (n.type === "VariableDeclarator") {
			const id = n.id as Node | undefined;
			if (id?.type === "Identifier" && id.name === exportName) {
				const init = n.init as Node | undefined;
				if (init?.type === "ArrayExpression") {
					found = init;
					return;
				}
				if (init?.type === "TSAsExpression" && (init.expression as Node | undefined)?.type === "ArrayExpression") {
					found = init.expression as Node;
					return;
				}
			}
		}
		for (const value of Object.values(n)) {
			if (value && typeof value === "object") visit(value);
		}
	};
	visit(program);
	return found;
}

/** Parse `filePath`, splice each target's `ArrayExpression` span with freshly rendered content, and write the result back. */
function regenerateFile(filePath: string, targets: readonly ArrayTarget[]): void {
	const source = readFileSync(filePath, "utf8");
	const result = parseSync(filePath, source);
	if (result.errors.length > 0) {
		throw new Error(`${filePath}: ${result.errors.map((error) => error.message).join("; ")}`);
	}
	const program = result.program as unknown as Node;

	const edits: Array<{ start: number; end: number; text: string }> = [];
	for (const target of targets) {
		const node = findArrayNode(program, target.exportName);
		if (!node) {
			throw new Error(`${filePath}: could not find exported array "${target.exportName}"`);
		}
		edits.push({ start: node.start, end: node.end, text: renderArrayLiteral(target) });
	}

	// Splice from the end of the file backward so an earlier edit's length
	// change never invalidates the byte offsets captured for a later one.
	edits.sort((a, b) => b.start - a.start);
	let next = source;
	for (const edit of edits) {
		next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
	}

	if (next === source) {
		console.log(`unchanged ${filePath}`);
		return;
	}
	writeFileSync(filePath, next);
	console.log(`updated ${filePath}`);
}

const activeLicenseIds = require("spdx-license-ids/index.json") as readonly string[];
const deprecatedLicenseIds = require("spdx-license-ids/deprecated.json") as readonly string[];
const activeExceptionIds = require("spdx-exceptions/index.json") as readonly string[];
const deprecatedExceptionIds = require("spdx-exceptions/deprecated.json") as readonly string[];

regenerateFile(resolve(scriptDir, "../src/internal/licenseIds.ts"), [
	{
		exportName: "ACTIVE_LICENSE_IDS",
		startMarker: "spdx:license-ids:active:start",
		endMarker: "spdx:license-ids:active:end",
		ids: activeLicenseIds,
	},
	{
		exportName: "DEPRECATED_LICENSE_ID_LIST",
		startMarker: "spdx:license-ids:deprecated:start",
		endMarker: "spdx:license-ids:deprecated:end",
		ids: deprecatedLicenseIds,
	},
]);

regenerateFile(resolve(scriptDir, "../src/internal/exceptions.ts"), [
	{
		exportName: "ACTIVE_EXCEPTION_IDS",
		startMarker: "spdx:exceptions:active:start",
		endMarker: "spdx:exceptions:active:end",
		ids: activeExceptionIds,
	},
	{
		exportName: "DEPRECATED_EXCEPTION_ID_LIST",
		startMarker: "spdx:exceptions:deprecated:start",
		endMarker: "spdx:exceptions:deprecated:end",
		ids: deprecatedExceptionIds,
	},
]);

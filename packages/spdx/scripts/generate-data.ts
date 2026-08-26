// Run by hand only:
//   pnpm --filter @effected/spdx exec tsx scripts/generate-data.ts
//
// Regenerates the vendored SPDX id arrays in src/internal/licenseIds.ts and
// src/internal/exceptions.ts from the installed spdx-license-ids and
// spdx-exceptions devDependencies, and the metadata table in
// src/internal/licenseMeta.ts from the vendored SPDX catalog at
// lib/data/spdx-licenses.json — SPDX's own published catalog, committed rather
// than vendored as a submodule: the upstream repo is 1.86 GB and this is the one
// 332 KB file we read from it, so a submodule cost every clone and every CI
// checkout that entire history to reach a rounding error's worth of JSON.
// Locates each target array by its exported const identifier via oxc-parser
// and splices only the ArrayExpression's byte span, leaving the attribution
// header, types, and Set exports untouched. Never run in CI or the test suite
// — only scripts/** may import these devDeps; nothing under src/** may depend
// on spdx-license-ids, spdx-exceptions, spdx-expression-parse, or oxc-parser
// at runtime.
//
// The identifier set stays sourced from spdx-license-ids, NOT from the
// vendored catalog: that keeps the differential oracle test's id provenance
// untouched. The vendored catalog supplies metadata for exactly those ids,
// and this script fails loudly if it cannot.

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
	/** The rendered replacement literal, brackets and marker comments included. */
	readonly content: string;
}

/** Sort ids by code point, not locale, so regeneration is stable across environments. */
function sortIds(ids: readonly string[]): string[] {
	return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Frame already-rendered element lines in brackets and marker comments. */
function renderLiteral(startMarker: string, endMarker: string, elements: readonly string[]): string {
	return ["[", `\t// ${startMarker}`, ...elements.map((element) => `\t${element}`), `\t// ${endMarker}`, "]"].join(
		"\n",
	);
}

/** Render an id array: one `"id",` element per line, sorted by code point. */
function renderIdArray(startMarker: string, endMarker: string, ids: readonly string[]): string {
	return renderLiteral(
		startMarker,
		endMarker,
		sortIds(ids).map((id) => `${JSON.stringify(id)},`),
	);
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
		edits.push({ start: node.start, end: node.end, text: target.content });
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
		content: renderIdArray("spdx:license-ids:active:start", "spdx:license-ids:active:end", activeLicenseIds),
	},
	{
		exportName: "DEPRECATED_LICENSE_ID_LIST",
		content: renderIdArray(
			"spdx:license-ids:deprecated:start",
			"spdx:license-ids:deprecated:end",
			deprecatedLicenseIds,
		),
	},
]);

regenerateFile(resolve(scriptDir, "../src/internal/exceptions.ts"), [
	{
		exportName: "ACTIVE_EXCEPTION_IDS",
		content: renderIdArray("spdx:exceptions:active:start", "spdx:exceptions:active:end", activeExceptionIds),
	},
	{
		exportName: "DEPRECATED_EXCEPTION_ID_LIST",
		content: renderIdArray(
			"spdx:exceptions:deprecated:start",
			"spdx:exceptions:deprecated:end",
			deprecatedExceptionIds,
		),
	},
]);

// ── License metadata ────────────────────────────────────────────────────

/** The subset of an upstream `licenses.json` entry this generator reads. */
interface UpstreamLicense {
	readonly licenseId: string;
	readonly name: string;
	readonly reference: string;
	readonly isOsiApproved?: boolean;
	// Present only when true; absent means false, never "unknown".
	readonly isFsfLibre?: boolean;
}

const FLAG_OSI_APPROVED = 1;
const FLAG_FSF_LIBRE = 2;

/**
 * Read the vendored SPDX catalog and render one `[id, name, flags],` line per
 * cataloged id. Two invariants are enforced here rather than assumed, and both
 * abort regeneration rather than emitting something plausible-but-wrong:
 *
 *  - every vendored id must have an upstream metadata entry; and
 *  - every entry's upstream `reference` must equal the URL template
 *    `License.referenceUrl` builds, since the template is what ships.
 */
/**
 * Render a string literal the way Biome would, so the generator and the
 * formatter agree on the emitted file.
 *
 * @remarks
 * Biome prefers double quotes, but switches to single quotes when that avoids
 * escaping — three SPDX names carry a `"` (`BSD 2-Clause "Simplified" License`
 * and friends). Emitting `JSON.stringify`'s always-escaped form means the
 * formatter rewrites the file the generator just wrote, and the generator
 * rewrites it back: neither is a fixpoint and the two oscillate forever.
 * Regeneration then reports a spurious diff, which is how a "re-run and diff"
 * check stops meaning anything.
 */
function quoted(value: string): string {
	const escaped = JSON.stringify(value);
	if (!value.includes('"') || value.includes("'")) return escaped;
	// Reuse JSON's escaping for everything EXCEPT the quote character itself:
	// strip the outer double quotes, unescape `\"` back to `"` (legal unescaped
	// inside single quotes), and re-wrap. Building the single-quoted form from
	// the raw value instead would emit literal control characters — a TAB
	// separator lands in the file as an actual tab byte, which makes the source
	// binary to `grep` and is exactly the hazard the escape sequence avoids.
	return `'${escaped.slice(1, -1).replaceAll('\\"', '"')}'`;
}

function renderLicenseMeta(ids: readonly string[]): string {
	const catalogPath = resolve(scriptDir, "../lib/data/spdx-licenses.json");
	const upstream = JSON.parse(readFileSync(catalogPath, "utf8")) as { readonly licenses: readonly UpstreamLicense[] };
	const byId = new Map(upstream.licenses.map((license) => [license.licenseId, license]));

	const missing: string[] = [];
	const badReference: string[] = [];
	const elements: string[] = [];

	for (const id of sortIds(ids)) {
		const license = byId.get(id);
		if (license === undefined) {
			missing.push(id);
			continue;
		}
		const expected = `https://spdx.org/licenses/${id}.html`;
		if (license.reference !== expected) {
			badReference.push(`${id}: expected ${expected}, upstream has ${license.reference}`);
			continue;
		}
		const flags =
			(license.isOsiApproved === true ? FLAG_OSI_APPROVED : 0) | (license.isFsfLibre === true ? FLAG_FSF_LIBRE : 0);
		// One string per row, not a tuple of three: a formatter cannot break a
		// string literal, so a long name (the longest here is 88 characters, which
		// overflows the 120-column limit once the id and flags are added) stays on
		// one line instead of being re-wrapped into a shape the generator would
		// then undo. `decodeRow` splits it back; TAB cannot occur in an SPDX name.
		elements.push(`${quoted(`${id}\t${license.name}\t${flags}`)},`);
	}

	if (missing.length > 0) {
		throw new Error(
			`${catalogPath}: no metadata for ${missing.length} vendored id(s): ${missing.join(", ")}. ` +
				"Refresh lib/data/spdx-licenses.json from the SPDX release that covers the installed spdx-license-ids.",
		);
	}
	if (badReference.length > 0) {
		throw new Error(
			`${catalogPath}: upstream reference URL deviates from the templated form for ${badReference.length} id(s): ` +
				`${badReference.join("; ")}. License.referenceUrl templates that URL — vendor the reference as data instead.`,
		);
	}

	return renderLiteral("spdx:license-meta:start", "spdx:license-meta:end", elements);
}

regenerateFile(resolve(scriptDir, "../src/internal/licenseMeta.ts"), [
	{
		exportName: "LICENSE_META_ROWS",
		content: renderLicenseMeta([...activeLicenseIds, ...deprecatedLicenseIds]),
	},
]);

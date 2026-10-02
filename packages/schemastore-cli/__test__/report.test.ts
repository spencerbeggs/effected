import { assert, describe, it } from "@effect/vitest";
import type { SchemaVersion } from "@effected/schemastore";
import { PipelineFinding } from "@effected/schemastore";
import { Report } from "../src/Report.js";
import type { CatalogReport, RunReport, SchemaReport } from "../src/Runner.js";

const version = (label: string): SchemaVersion => label as SchemaVersion;

// ── Fixture A: a clean build ────────────────────────────────────────────────

const writtenSchema: SchemaReport = {
	$id: "https://example.com/schemas/1.2/okfit-1.2.json",
	path: "schemas/1.2/okfit-1.2.json",
	name: "okfit",
	version: version("1.2"),
	published: true,
	change: "created",
	verdict: "write",
	policy: "semantic",
	outcome: "written",
	findings: [],
	frozen: [],
};

const unchangedSchema: SchemaReport = {
	$id: "https://example.com/schemas/plain.json",
	path: "schemas/plain.json",
	name: "plain",
	published: false,
	change: "none",
	verdict: "write",
	policy: "semantic",
	outcome: "unchanged",
	findings: [],
	frozen: [],
};

const writtenCatalog: CatalogReport = {
	slice: { path: "schemas/catalogs/okfit.json", entries: 1, outcome: "written" },
	merged: {
		path: "schemas/catalog.json",
		entries: 2,
		outcome: "written",
		slices: ["schemas/catalogs/okfit.json", "schemas/catalogs/other.json"],
		conflicts: [],
		invalid: [],
	},
};

const cleanBuild: RunReport = {
	mode: "build",
	configPath: "/repo/schemastore.config.ts",
	onDrift: "error",
	schemas: [writtenSchema, unchangedSchema],
	catalog: writtenCatalog,
	drifted: false,
	gateFailed: false,
	wrote: true,
};

// ── Fixture B: contract drift + a held schema + a gate failure ─────────────

const driftSchema: SchemaReport = {
	$id: "https://example.com/schemas/1.2/okfit-1.2.json",
	path: "schemas/1.2/okfit-1.2.json",
	name: "okfit",
	version: version("1.2"),
	published: true,
	change: "contract",
	verdict: "drift",
	policy: "strict",
	outcome: "drift",
	nextVersion: version("1.3"),
	findings: [],
	frozen: [],
};

const heldSchema: SchemaReport = {
	$id: "https://example.com/schemas/held.json",
	path: "schemas/held.json",
	name: "held",
	published: true,
	change: "none",
	verdict: "write",
	policy: "strict",
	outcome: "held",
	findings: [],
	frozen: [],
};

const gateFailedSchema: SchemaReport = {
	$id: "https://example.com/schemas/broken.json",
	path: "schemas/broken.json",
	name: "broken",
	published: false,
	change: "none",
	verdict: "write",
	policy: "strict",
	outcome: "gate-failed",
	findings: [
		PipelineFinding.make({
			source: "lint",
			severity: "warning",
			check: "UnresolvedRef",
			path: "#/properties/x",
			message: "ref not found",
		}),
		PipelineFinding.make({
			source: "validator",
			severity: "warning",
			path: "#/properties/y",
			message: "invalid",
		}),
	],
	frozen: [],
};

const heldCatalog: CatalogReport = {
	slice: { path: "schemas/catalogs/okfit.json", entries: 1, outcome: "held" },
	merged: {
		path: "schemas/catalog.json",
		entries: 1,
		outcome: "held",
		slices: ["schemas/catalogs/okfit.json"],
		conflicts: [],
		invalid: [],
	},
};

const driftAndGate: RunReport = {
	mode: "build",
	configPath: "/repo/schemastore.config.ts",
	policy: "strict",
	onDrift: "error",
	schemas: [driftSchema, heldSchema, gateFailedSchema],
	catalog: heldCatalog,
	drifted: true,
	gateFailed: true,
	wrote: false,
};

// ── Fixture C: a warn-mode drift that WAS written ───────────────────────────

const warnDriftSchema: SchemaReport = {
	$id: "https://example.com/schemas/1.2/okfit-1.2.json",
	path: "schemas/1.2/okfit-1.2.json",
	name: "okfit",
	version: version("1.2"),
	published: true,
	change: "contract",
	verdict: "drift",
	policy: "semantic",
	outcome: "written",
	nextVersion: version("1.3"),
	findings: [],
	frozen: [],
};

const warnBuild: RunReport = {
	mode: "build",
	configPath: "/repo/schemastore.config.ts",
	onDrift: "warn",
	schemas: [warnDriftSchema],
	drifted: true,
	gateFailed: false,
	wrote: true,
};

// ── Fixture D: a prerelease published contract change carries no suggestion,
// so the drift line has no `suggest` clause. ────────────────────────────────

const prereleaseDriftSchema: SchemaReport = {
	$id: "https://example.com/schemas/pre-2.0.0-beta.1.json",
	path: "schemas/pre-2.0.0-beta.1.json",
	name: "pre",
	version: version("2.0.0-beta.1"),
	published: true,
	change: "contract",
	verdict: "drift",
	policy: "semantic",
	outcome: "drift",
	findings: [],
	frozen: [],
};

const prereleaseDriftBuild: RunReport = {
	mode: "build",
	configPath: "/repo/schemastore.config.ts",
	onDrift: "error",
	schemas: [prereleaseDriftSchema],
	drifted: true,
	gateFailed: false,
	wrote: false,
};

// ── Fixture E: a schema carrying a policy and frozen labels, under a
// per-schema (no flag-forced) report ────────────────────────────────────────

const frozenSchema: SchemaReport = {
	$id: "https://example.com/schemas/pinned-4.1.0.json",
	path: "schemas/pinned-4.1.0.json",
	name: "pinned",
	version: version("4.1.0"),
	published: true,
	change: "none",
	verdict: "write",
	policy: "allow",
	outcome: "unchanged",
	findings: [],
	frozen: [version("4.0.0"), version("4.1.0")],
};

const frozenBuild: RunReport = {
	mode: "build",
	configPath: "/repo/schemastore.config.ts",
	onDrift: "error",
	schemas: [frozenSchema],
	drifted: false,
	gateFailed: false,
	wrote: false,
};

// ── Fixture F: a check that found documents at sibling shapes of derived
// paths (#747) — one line per orphan, in config order, remedy on the line.
// The renderer does not interpret the paths; these are just two shapes. ────

const orphanedCheck: RunReport = {
	mode: "check",
	configPath: "/repo/schemastore.config.ts",
	onDrift: "error",
	schemas: [unchangedSchema],
	orphaned: ["schemas/1.2/okfit.json", "schemas/okfit-1.2.json"],
	drifted: false,
	gateFailed: false,
	wrote: false,
};

// A merge blocked by a URL two slices advertise and a slice that is not a
// catalog entry array; an orphaned slice beside it.
const blockedCheck: RunReport = {
	mode: "check",
	configPath: "/repo/schemastore.config.ts",
	onDrift: "error",
	schemas: [unchangedSchema],
	catalog: {
		slice: { path: "schemas/catalogs/okfit.json", entries: 0, outcome: "orphaned" },
		merged: {
			path: "schemas/catalog.json",
			entries: 2,
			outcome: "blocked",
			slices: ["schemas/catalogs/a.json", "schemas/catalogs/b.json"],
			conflicts: [
				{
					kind: "url",
					url: "https://example.com/a.json",
					slices: ["schemas/catalogs/a.json", "schemas/catalogs/b.json"],
				},
				{ kind: "name", name: "tool.toml", slices: ["schemas/catalogs/a.json", "schemas/catalogs/c.json"] },
			],
			invalid: [{ path: "schemas/catalogs/broken.json", reason: 'Expected no excess property at [0]["extra"]' }],
		},
	},
	drifted: false,
	gateFailed: false,
	wrote: false,
};

describe("Report.human", () => {
	it("renders an orphaned slice and a blocked merge with one line per problem", () => {
		assert.deepStrictEqual(Report.human(blockedCheck), [
			"unchanged schemas/plain.json [policy semantic]",
			"orphaned catalog slice schemas/catalogs/okfit.json (no schema declares a catalog; the merged catalog keeps advertising its entries until it is deleted — delete it by hand; build never will)",
			"CATALOG BLOCKED schemas/catalog.json (not written: fix the slices below)",
			"  url https://example.com/a.json advertised by schemas/catalogs/a.json, schemas/catalogs/b.json",
			"  name tool.toml advertised by schemas/catalogs/a.json, schemas/catalogs/c.json",
			'  slice schemas/catalogs/broken.json is invalid: Expected no excess property at [0]["extra"]',
			"1 schema(s): 0 written, 1 unchanged, 0 drift, 0 gate failed — drift per schema (config), on-drift error",
		]);
	});

	it("renders a case-folded slice claim on the slice line, in JSON and in the step summary", () => {
		const report: RunReport = {
			...cleanBuild,
			catalog: {
				slice: {
					path: "schemas/catalogs/Docs.json",
					entries: 1,
					outcome: "written",
					caseFoldedMatch: "schemas/catalogs/docs.json",
				},
			},
		};
		assert.include(
			Report.human(report),
			'written catalog slice schemas/catalogs/Docs.json (1 entries; claimed schemas/catalogs/docs.json by case-folded match for "Docs")',
		);
		const doc = JSON.parse(Report.json(report)) as { catalog: { slice: Record<string, unknown> } };
		assert.strictEqual(doc.catalog.slice.caseFoldedMatch, "schemas/catalogs/docs.json");
		assert.include(
			Report.markdown(report),
			"| slice | schemas/catalogs/Docs.json | 1 | written (case-folded match: schemas/catalogs/docs.json) |",
		);
		const plain = JSON.parse(Report.json(cleanBuild)) as { catalog: { slice: Record<string, unknown> } };
		assert.isFalse(Object.hasOwn(plain.catalog.slice, "caseFoldedMatch"));
	});

	it("renders an orphaned merged catalog", () => {
		const report: RunReport = {
			...orphanedCheck,
			catalog: {
				merged: {
					path: "schemas/catalog.json",
					entries: 0,
					outcome: "orphaned",
					slices: [],
					conflicts: [],
					invalid: [],
				},
			},
		};
		assert.include(
			Report.human(report),
			"orphaned catalog schemas/catalog.json (no catalog slice remains — delete it by hand; build never will)",
		);
	});

	it("renders a clean build", () => {
		assert.deepStrictEqual(Report.human(cleanBuild), [
			"written (created) schemas/1.2/okfit-1.2.json [policy semantic]",
			"unchanged schemas/plain.json [policy semantic]",
			"written catalog slice schemas/catalogs/okfit.json (1 entries)",
			"written catalog schemas/catalog.json (2 entries from 2 slice(s))",
			"2 schema(s): 1 written, 1 unchanged, 0 drift, 0 gate failed — drift per schema (config), on-drift error",
		]);
	});

	it("appends the policy and frozen suffixes in per-schema mode", () => {
		assert.deepStrictEqual(Report.human(frozenBuild), [
			"unchanged schemas/pinned-4.1.0.json [policy allow] (frozen: 4.0.0, 4.1.0)",
			"1 schema(s): 0 written, 1 unchanged, 0 drift, 0 gate failed — drift per schema (config), on-drift error",
		]);
	});

	it("renders a contract drift, a held schema and a gate failure", () => {
		assert.deepStrictEqual(Report.human(driftAndGate), [
			"DRIFT contract at published 1.2 → suggest 1.3 — schemas/1.2/okfit-1.2.json",
			"held (gate failed elsewhere) schemas/held.json",
			"GATE FAILED schemas/broken.json (2 blocking finding(s))",
			'  UnresolvedRef at "#/properties/x": ref not found',
			'  validator at "#/properties/y": invalid',
			"held catalog slice schemas/catalogs/okfit.json (1 entries)",
			"held catalog schemas/catalog.json (1 entries from 1 slice(s))",
			"3 schema(s): 0 written, 0 unchanged, 1 drift, 1 gate failed — drift strict (flag), on-drift error",
		]);
	});

	it("renders a prerelease contract drift with no suggest clause", () => {
		assert.deepStrictEqual(Report.human(prereleaseDriftBuild), [
			"DRIFT contract at published 2.0.0-beta.1 — schemas/pre-2.0.0-beta.1.json [policy semantic]",
			"1 schema(s): 0 written, 0 unchanged, 1 drift, 0 gate failed — drift per schema (config), on-drift error",
		]);
	});

	it("renders one line per orphaned document, before the summary", () => {
		assert.deepStrictEqual(Report.human(orphanedCheck), [
			"unchanged schemas/plain.json [policy semantic]",
			"orphaned document schemas/1.2/okfit.json (no target, frozen version, or catalog entry claims it — delete it by hand; build never will)",
			"orphaned document schemas/okfit-1.2.json (no target, frozen version, or catalog entry claims it — delete it by hand; build never will)",
			"1 schema(s): 0 written, 1 unchanged, 0 drift, 0 gate failed — drift per schema (config), on-drift error",
		]);
	});
});

describe("Report.warnings", () => {
	it("is empty when nothing drifted under warn", () => {
		assert.deepStrictEqual(Report.warnings(cleanBuild), []);
	});

	it("is empty when a drift was refused under onDrift: error", () => {
		assert.deepStrictEqual(Report.warnings(driftAndGate), []);
	});

	it("is empty when the gate failed under onDrift: warn — nothing was written", () => {
		const gateAndWarn: RunReport = {
			...warnBuild,
			schemas: [{ ...warnDriftSchema, outcome: "held" }, gateFailedSchema],
			gateFailed: true,
			wrote: false,
		};
		assert.deepStrictEqual(Report.warnings(gateAndWarn), []);
	});

	it("carries one line per drifted-and-written schema under onDrift: warn", () => {
		assert.deepStrictEqual(Report.warnings(warnBuild), [
			"warning: DRIFT contract at published 1.2 written under --on-drift=warn — schemas/1.2/okfit-1.2.json",
		]);
	});

	it("says what a build would write when the report came from check", () => {
		const warnCheck: RunReport = {
			...warnBuild,
			mode: "check",
			schemas: [{ ...warnDriftSchema, outcome: "would-write" }],
			wrote: false,
		};
		assert.deepStrictEqual(Report.warnings(warnCheck), [
			"warning: DRIFT contract at published 1.2 would write under --on-drift=warn — schemas/1.2/okfit-1.2.json",
		]);
	});
});

describe("Report.json", () => {
	it("round-trips the clean build", () => {
		const doc = JSON.parse(Report.json(cleanBuild)) as Record<string, unknown>;
		assert.strictEqual(doc.mode, "build");
		assert.strictEqual(doc.configPath, "/repo/schemastore.config.ts");
		assert.deepStrictEqual(doc.drift, { onDrift: "error" });
		assert.strictEqual(Array.isArray(doc.schemas), true);
		const schemas = doc.schemas as ReadonlyArray<Record<string, unknown>>;
		assert.strictEqual(schemas.length, 2);
		assert.deepStrictEqual(schemas[0], {
			$id: "https://example.com/schemas/1.2/okfit-1.2.json",
			path: "schemas/1.2/okfit-1.2.json",
			name: "okfit",
			version: "1.2",
			published: true,
			change: "created",
			verdict: "write",
			policy: "semantic",
			outcome: "written",
			findings: [],
		});
		assert.deepStrictEqual(doc.catalog, {
			slice: { path: "schemas/catalogs/okfit.json", entries: 1, outcome: "written" },
			merged: {
				path: "schemas/catalog.json",
				entries: 2,
				outcome: "written",
				slices: ["schemas/catalogs/okfit.json", "schemas/catalogs/other.json"],
			},
		});
		assert.strictEqual(doc.drifted, false);
		assert.strictEqual(doc.gateFailed, false);
		assert.strictEqual(doc.wrote, true);
	});

	it("maps findings to plain objects and includes nextVersion when present", () => {
		const doc = JSON.parse(Report.json(driftAndGate)) as {
			drift: Record<string, unknown>;
			schemas: ReadonlyArray<Record<string, unknown>>;
		};
		assert.deepStrictEqual(doc.drift, { onDrift: "error", policy: "strict" });
		assert.deepStrictEqual(doc.schemas[0], {
			$id: "https://example.com/schemas/1.2/okfit-1.2.json",
			path: "schemas/1.2/okfit-1.2.json",
			name: "okfit",
			version: "1.2",
			published: true,
			change: "contract",
			verdict: "drift",
			policy: "strict",
			outcome: "drift",
			nextVersion: "1.3",
			findings: [],
		});
		assert.deepStrictEqual(doc.schemas[2]?.findings, [
			{ source: "lint", severity: "warning", check: "UnresolvedRef", path: "#/properties/x", message: "ref not found" },
			{ source: "validator", severity: "warning", path: "#/properties/y", message: "invalid" },
		]);
	});

	it("carries conflicts and invalid only on a merge that has them", () => {
		const doc = JSON.parse(Report.json(blockedCheck)) as { catalog: { merged: Record<string, unknown> } };
		assert.deepStrictEqual(doc.catalog.merged.conflicts, [
			{
				kind: "url",
				url: "https://example.com/a.json",
				slices: ["schemas/catalogs/a.json", "schemas/catalogs/b.json"],
			},
			{ kind: "name", name: "tool.toml", slices: ["schemas/catalogs/a.json", "schemas/catalogs/c.json"] },
		]);
		assert.deepStrictEqual(doc.catalog.merged.invalid, [
			{ path: "schemas/catalogs/broken.json", reason: 'Expected no excess property at [0]["extra"]' },
		]);
		const clean = JSON.parse(Report.json(cleanBuild)) as { catalog: { merged: Record<string, unknown> } };
		assert.isFalse(Object.hasOwn(clean.catalog.merged, "conflicts"));
		assert.isFalse(Object.hasOwn(clean.catalog.merged, "invalid"));
	});

	it("omits catalog when the report has none", () => {
		const doc = JSON.parse(Report.json(warnBuild)) as Record<string, unknown>;
		assert.isFalse(Object.hasOwn(doc, "catalog"));
	});

	it("carries orphaned when present and omits it when absent", () => {
		const orphaned = JSON.parse(Report.json(orphanedCheck)) as Record<string, unknown>;
		assert.deepStrictEqual(orphaned.orphaned, ["schemas/1.2/okfit.json", "schemas/okfit-1.2.json"]);
		const clean = JSON.parse(Report.json(cleanBuild)) as Record<string, unknown>;
		assert.isFalse(Object.hasOwn(clean, "orphaned"));
	});

	it("carries policy on every schema and frozen only when non-empty", () => {
		const doc = JSON.parse(Report.json(frozenBuild)) as { schemas: ReadonlyArray<Record<string, unknown>> };
		assert.deepStrictEqual(doc.schemas[0], {
			$id: "https://example.com/schemas/pinned-4.1.0.json",
			path: "schemas/pinned-4.1.0.json",
			name: "pinned",
			version: "4.1.0",
			published: true,
			change: "none",
			verdict: "write",
			policy: "allow",
			outcome: "unchanged",
			frozen: ["4.0.0", "4.1.0"],
			findings: [],
		});
		const clean = JSON.parse(Report.json(cleanBuild)) as { schemas: ReadonlyArray<Record<string, unknown>> };
		assert.isFalse(Object.hasOwn(clean.schemas[0] as object, "frozen"));
	});
});

describe("Report.markdown", () => {
	it("carries the header, the schema table and a clean verdict line", () => {
		const markdown = Report.markdown(cleanBuild);
		assert.include(markdown, "### schemastore build");
		assert.include(markdown, "| schema | version | frozen | published | change | outcome |");
		assert.include(markdown, "**Drift:** none");
	});

	it("renders the frozen column, comma-joined when populated and empty when not", () => {
		const markdown = Report.markdown(frozenBuild);
		assert.include(markdown, "| pinned | 4.1.0 | 4.0.0, 4.1.0 | yes | none | unchanged |");
		assert.include(Report.markdown(cleanBuild), "| okfit | 1.2 |  | yes | created | written |");
	});

	it("ends with exactly one newline so a later append starts on its own line", () => {
		const markdown = Report.markdown(cleanBuild);
		assert.isTrue(markdown.endsWith("**Drift:** none\n"), JSON.stringify(markdown.slice(-24)));
		assert.isFalse(markdown.endsWith("\n\n"));
	});

	it("reports the gate verdict when the run failed its gate", () => {
		const markdown = Report.markdown(driftAndGate);
		assert.include(markdown, "**Gate:** 1 schema(s) failed");
	});

	it("reports the drift verdict when the run drifted but did not fail its gate", () => {
		const markdown = Report.markdown(warnBuild);
		assert.include(markdown, "**Drift:** 1 schema(s) drifted — drift per schema (config), on-drift warn");
	});

	it("renders a slice row and a merged row when the report has a catalog", () => {
		const markdown = Report.markdown(cleanBuild);
		assert.include(markdown, "| catalog | file | entries | outcome |");
		assert.include(markdown, "| slice | schemas/catalogs/okfit.json | 1 | written |");
		assert.include(markdown, "| merged | schemas/catalog.json | 2 | written |");
		assert.notInclude(markdown, "| catalog problem |");
	});

	it("renders a blocked merge's conflicts and invalid slices", () => {
		const markdown = Report.markdown(blockedCheck);
		assert.include(markdown, "| merged | schemas/catalog.json | 2 | blocked |");
		assert.include(markdown, "| url https://example.com/a.json | schemas/catalogs/a.json, schemas/catalogs/b.json |");
		assert.include(markdown, "| name tool.toml | schemas/catalogs/a.json, schemas/catalogs/c.json |");
		assert.include(markdown, '| invalid: Expected no excess property at [0]["extra"] | schemas/catalogs/broken.json |');
	});

	it("escapes pipes and newlines in every table cell, so an untrusted key cannot add a column", () => {
		const report: RunReport = {
			...blockedCheck,
			catalog: {
				merged: {
					path: "schemas/catalog.json",
					entries: 0,
					outcome: "blocked",
					slices: [],
					conflicts: [],
					invalid: [
						{ path: "schemas/catalogs/a|b.json", reason: 'Expected no excess property at [0]["x|y"]\nsecond line' },
					],
				},
			},
		};
		const markdown = Report.markdown(report);
		assert.include(
			markdown,
			'| invalid: Expected no excess property at [0]["x\\|y"] second line | schemas/catalogs/a\\|b.json |',
		);
		// Every row of the problem table keeps exactly its two columns.
		const row = markdown.split("\n").find((line) => line.startsWith("| invalid:"));
		assert.isDefined(row);
		assert.strictEqual(row.replace(/\\\|/g, "").split("|").length - 2, 2);
	});

	it("escapes a backslash before a pipe, so an input `\\|` cannot turn into an escaped backslash and a live pipe", () => {
		const report: RunReport = {
			...blockedCheck,
			catalog: {
				merged: {
					path: "schemas/catalog.json",
					entries: 0,
					outcome: "blocked",
					slices: [],
					conflicts: [],
					invalid: [{ path: "schemas/catalogs/a\\|b.json", reason: 'Expected no excess property at [0]["x\\|y"]' }],
				},
			},
		};
		const markdown = Report.markdown(report);
		// `\` → `\\` first, then `|` → `\|`: the input `\|` renders `\\\|`.
		assert.include(
			markdown,
			'| invalid: Expected no excess property at [0]["x\\\\\\|y"] | schemas/catalogs/a\\\\\\|b.json |',
		);
		// Strip escaped backslashes, then escaped pipes: what remains are the
		// live column separators, exactly three for two columns.
		const row = markdown.split("\n").find((line) => line.startsWith("| invalid:"));
		assert.isDefined(row);
		assert.strictEqual(row.replace(/\\\\/g, "").replace(/\\\|/g, "").split("|").length - 2, 2);
	});

	it("omits the catalog table when the report has none", () => {
		const markdown = Report.markdown(warnBuild);
		assert.notInclude(markdown, "| catalog |");
	});

	it("renders one orphaned-document row each when the report has them", () => {
		const markdown = Report.markdown(orphanedCheck);
		assert.include(markdown, "| orphaned document | claimed by |");
		assert.include(markdown, "| schemas/1.2/okfit.json | nothing — delete by hand |");
		assert.include(markdown, "| schemas/okfit-1.2.json | nothing — delete by hand |");
	});

	it("omits the orphaned table when the report has none", () => {
		assert.notInclude(Report.markdown(cleanBuild), "| orphaned document |");
	});
});

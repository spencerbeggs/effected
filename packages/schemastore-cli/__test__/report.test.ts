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
	path: "schemas/catalog.json",
	entries: 1,
	outcome: "written",
};

const cleanBuild: RunReport = {
	mode: "build",
	configPath: "/repo/schemastore.config.ts",
	onDrift: "error",
	source: "config",
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
	path: "schemas/catalog.json",
	entries: 1,
	outcome: "held",
};

const driftAndGate: RunReport = {
	mode: "build",
	configPath: "/repo/schemastore.config.ts",
	policy: "strict",
	onDrift: "error",
	source: "flag",
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
	source: "config",
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
	source: "config",
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
	source: "config",
	schemas: [frozenSchema],
	drifted: false,
	gateFailed: false,
	wrote: false,
};

describe("Report.human", () => {
	it("renders a clean build", () => {
		assert.deepStrictEqual(Report.human(cleanBuild), [
			"written (created) schemas/1.2/okfit-1.2.json [policy semantic]",
			"unchanged schemas/plain.json [policy semantic]",
			"written catalog schemas/catalog.json (1 entries)",
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
			"held catalog schemas/catalog.json (1 entries)",
			"3 schema(s): 0 written, 0 unchanged, 1 drift, 1 gate failed — drift strict (flag), on-drift error",
		]);
	});

	it("renders a prerelease contract drift with no suggest clause", () => {
		assert.deepStrictEqual(Report.human(prereleaseDriftBuild), [
			"DRIFT contract at published 2.0.0-beta.1 — schemas/pre-2.0.0-beta.1.json [policy semantic]",
			"1 schema(s): 0 written, 0 unchanged, 1 drift, 0 gate failed — drift per schema (config), on-drift error",
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
		assert.deepStrictEqual(doc.drift, { onDrift: "error", source: "config" });
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
		assert.deepStrictEqual(doc.catalog, { path: "schemas/catalog.json", entries: 1, outcome: "written" });
		assert.strictEqual(doc.drifted, false);
		assert.strictEqual(doc.gateFailed, false);
		assert.strictEqual(doc.wrote, true);
	});

	it("maps findings to plain objects and includes nextVersion when present", () => {
		const doc = JSON.parse(Report.json(driftAndGate)) as {
			drift: Record<string, unknown>;
			schemas: ReadonlyArray<Record<string, unknown>>;
		};
		assert.deepStrictEqual(doc.drift, { onDrift: "error", source: "flag", policy: "strict" });
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

	it("omits catalog when the report has none", () => {
		const doc = JSON.parse(Report.json(warnBuild)) as Record<string, unknown>;
		assert.isFalse(Object.hasOwn(doc, "catalog"));
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

	it("renders the single catalog row when the report has one", () => {
		const markdown = Report.markdown(cleanBuild);
		assert.include(markdown, "| catalog | entries | outcome |");
		assert.include(markdown, "| schemas/catalog.json | 1 | written |");
	});

	it("omits the catalog table when the report has none", () => {
		const markdown = Report.markdown(warnBuild);
		assert.notInclude(markdown, "| catalog |");
	});
});

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
	outcome: "written",
	findings: [],
};

const unchangedSchema: SchemaReport = {
	$id: "https://example.com/schemas/plain.json",
	path: "schemas/plain.json",
	published: false,
	change: "none",
	verdict: "write",
	outcome: "unchanged",
	findings: [],
};

const writtenCatalog: CatalogReport = {
	name: "main",
	path: "schemas/catalog-entry.json",
	outcome: "written",
};

const cleanBuild: RunReport = {
	mode: "build",
	configPath: "/repo/schemastore.config.ts",
	drift: { policy: "semantic", onDrift: "error", source: "config" },
	schemas: [writtenSchema, unchangedSchema],
	catalog: [writtenCatalog],
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
	outcome: "drift",
	nextVersion: version("1.3"),
	findings: [],
};

const heldSchema: SchemaReport = {
	$id: "https://example.com/schemas/held.json",
	path: "schemas/held.json",
	name: "held",
	published: true,
	change: "none",
	verdict: "write",
	outcome: "held",
	findings: [],
};

const gateFailedSchema: SchemaReport = {
	$id: "https://example.com/schemas/broken.json",
	path: "schemas/broken.json",
	published: false,
	change: "none",
	verdict: "write",
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
};

const heldCatalog: CatalogReport = {
	name: "main",
	path: "schemas/catalog-entry.json",
	outcome: "held",
};

const driftAndGate: RunReport = {
	mode: "build",
	configPath: "/repo/schemastore.config.ts",
	drift: { policy: "strict", onDrift: "error", source: "flag" },
	schemas: [driftSchema, heldSchema, gateFailedSchema],
	catalog: [heldCatalog],
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
	outcome: "written",
	nextVersion: version("1.3"),
	findings: [],
};

const warnBuild: RunReport = {
	mode: "build",
	configPath: "/repo/schemastore.config.ts",
	drift: { policy: "semantic", onDrift: "warn", source: "config" },
	schemas: [warnDriftSchema],
	catalog: [],
	drifted: true,
	gateFailed: false,
	wrote: true,
};

describe("Report.human", () => {
	it("renders a clean build", () => {
		assert.deepStrictEqual(Report.human(cleanBuild), [
			"written (created) schemas/1.2/okfit-1.2.json",
			"unchanged schemas/plain.json",
			"written catalog schemas/catalog-entry.json",
			"2 schema(s): 1 written, 1 unchanged, 0 drift, 0 gate failed — drift policy semantic/error (config)",
		]);
	});

	it("renders a contract drift, a held schema and a gate failure", () => {
		assert.deepStrictEqual(Report.human(driftAndGate), [
			"DRIFT contract at published 1.2 → suggest 1.3 — schemas/1.2/okfit-1.2.json",
			"held (gate failed elsewhere) schemas/held.json",
			"GATE FAILED schemas/broken.json (2 blocking finding(s))",
			'  UnresolvedRef at "#/properties/x": ref not found',
			'  validator at "#/properties/y": invalid',
			"held catalog schemas/catalog-entry.json",
			"3 schema(s): 0 written, 0 unchanged, 1 drift, 1 gate failed — drift policy strict/error (flag)",
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
			catalog: [],
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
		assert.deepStrictEqual(doc.drift, { policy: "semantic", onDrift: "error", source: "config" });
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
			outcome: "written",
			findings: [],
		});
		assert.deepStrictEqual(doc.catalog, [{ name: "main", path: "schemas/catalog-entry.json", outcome: "written" }]);
		assert.strictEqual(doc.drifted, false);
		assert.strictEqual(doc.gateFailed, false);
		assert.strictEqual(doc.wrote, true);
	});

	it("maps findings to plain objects and includes nextVersion when present", () => {
		const doc = JSON.parse(Report.json(driftAndGate)) as {
			schemas: ReadonlyArray<Record<string, unknown>>;
		};
		assert.deepStrictEqual(doc.schemas[0], {
			$id: "https://example.com/schemas/1.2/okfit-1.2.json",
			path: "schemas/1.2/okfit-1.2.json",
			name: "okfit",
			version: "1.2",
			published: true,
			change: "contract",
			verdict: "drift",
			outcome: "drift",
			nextVersion: "1.3",
			findings: [],
		});
		assert.deepStrictEqual(doc.schemas[2]?.findings, [
			{ source: "lint", severity: "warning", check: "UnresolvedRef", path: "#/properties/x", message: "ref not found" },
			{ source: "validator", severity: "warning", path: "#/properties/y", message: "invalid" },
		]);
	});
});

describe("Report.markdown", () => {
	it("carries the header, the schema table and a clean verdict line", () => {
		const markdown = Report.markdown(cleanBuild);
		assert.include(markdown, "### schemastore build");
		assert.include(markdown, "| schema | version | published | change | outcome |");
		assert.include(markdown, "**Drift:** none");
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
		assert.include(markdown, "**Drift:** 1 schema(s) drifted under semantic/warn");
	});
});

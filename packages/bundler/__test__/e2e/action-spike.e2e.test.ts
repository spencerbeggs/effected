/**
 * The action spike: can rolldown bundle a real GitHub Action's entries, one self-contained file each?
 *
 * Run it with
 * `EFFECTED_ACTION_SPIKE=/path/to/silk-release-action pnpm exec vitest run --project @effected/bundler --coverage.enabled=false action-spike`.
 * `EFFECTED_ACTION_SPIKE_DIR` keeps the bundles and a `report.json` of their sizes and rolldown logs somewhere to
 * inspect.
 *
 * Recorded 2026-11-06 on silk-release-action 5.10.6, rolldown 1.2.16, Node 26.13.0, Apple Silicon. The rspack column
 * is that repository's committed `dist/`:
 *
 * | Entry | rolldown | rspack | Build |
 * | --- | --- | --- | --- |
 * | `pre` | 348,634 B | 406,590 B | 161-174 ms |
 * | `main` | 2,368,768 B | 2,452,915 B | 324-352 ms |
 * | `post` | 348,553 B | 406,398 B | 115-152 ms |
 * | `changelog-silk` | 1,072,406 B | 1,095,259 B | 149-155 ms |
 * | `changelog-default` | 1,072,413 B | 1,095,266 B | 144-149 ms |
 *
 * Every bundle imports from outside the checkout with no `GITHUB_*` variable set, carries no build-machine path, and
 * comes out byte-identical from a second build. With `GITHUB_ACTIONS` set, `pre`, `main` and `post` exit as the rspack
 * bundles do and report the same `::error::` lines, which is as far as a run with no input, state or token gets.
 *
 * Logs. With rolldown's default checks a build logs nothing at all, including for the broken bundle below, and for
 * `import.meta`, a `require` of a builtin, and a computed `import()`. With `checks.circularDependency` on it logs only
 * `CIRCULAR_DEPENDENCY`: 17 for `pre`, 18 for `main`, 17 for `post` and 2 for each worker, all in third-party packages
 * (apache-arrow, `@redis/client`, semver, jju).
 *
 * What the numbers rest on:
 *
 * - **`resolve.mainFields` must lead with `module`.** Rolldown's node default leads with `main`, which takes
 *   jsonc-parser's UMD build. Its factory receives `require` as a value, so its relative requires stay runtime calls:
 *   `Cannot find module './impl/format'` at import, in `main` and both workers, and nothing at build time.
 * - **`__dirname` and `__filename` are left bare.** They die at the call rather than at import, so an import check does
 *   not catch them. No bundle here references either, and the fixture shows `transform.define` to `import.meta.dirname`
 *   and `import.meta.filename` works.
 * - **The other rspack workarounds have no counterpart.** A CJS `require` of a builtin goes through
 *   `createRequire(import.meta.url)` and so has real CommonJS semantics, `import.meta.url` stays a runtime expression,
 *   and a computed `import()`, including the one in `@changesets/apply-release-plan`, stays native.
 */
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import type { Plugin } from "rolldown";
import { rolldown } from "rolldown";
import { checkImport } from "../../src/action/import-check.js";

const TARGET = process.env.EFFECTED_ACTION_SPIKE;
const KEEP_DIR = process.env.EFFECTED_ACTION_SPIKE_DIR;
const SPIKE_TIMEOUT = 300_000;
const NODE_TIMEOUT = 60_000;

/** The entries of silk-release-action's `action.config.ts`. */
const ENTRIES: Readonly<Record<string, string>> = {
	pre: "src/pre.ts",
	main: "src/main.ts",
	post: "src/post.ts",
	"changelog-silk": "src/changelog/silk.ts",
	"changelog-default": "src/changelog/default.ts",
};

/** The `build.ignore` of silk-release-action's `action.config.ts`. */
const IGNORE: ReadonlyArray<string> = ["supports-color", "kerberos"];

const STUB_PREFIX = "\0effected-action-ignore:";

/** Aliases each ignored package to a virtual module that throws when it is loaded. */
const ignoreStub = (ignored: ReadonlyArray<string>): Plugin => ({
	name: "effected-action-ignore",
	resolveId(source) {
		return ignored.includes(source) ? { id: `${STUB_PREFIX}${source}`, moduleSideEffects: true } : null;
	},
	load(id) {
		return id.startsWith(STUB_PREFIX)
			? `throw new Error(${JSON.stringify(`${id.slice(STUB_PREFIX.length)} is excluded by build.ignore and was loaded at runtime.`)});\n`
			: null;
	},
});

interface LoggedWarning {
	readonly entry: string;
	readonly level: string;
	readonly code: string;
	readonly message: string;
}

interface BundleOptions {
	readonly mainFields?: ReadonlyArray<string>;
	readonly define?: Readonly<Record<string, string>>;
}

/** One entry through rolldown, into one file. */
const bundle = async (
	entry: string,
	input: string,
	cwd: string,
	out: string,
	warnings: Array<LoggedWarning>,
	options?: BundleOptions,
) => {
	const build = await rolldown({
		input: { [entry]: input },
		cwd,
		platform: "node",
		treeshake: true,
		external: [/^node:/],
		resolve: { mainFields: [...(options?.mainFields ?? ["module", "main"])] },
		checks: { circularDependency: true },
		...(options?.define !== undefined ? { transform: { define: { ...options.define } } } : {}),
		plugins: [ignoreStub(IGNORE)],
		onLog(level, log) {
			warnings.push({ entry, level, code: log.code ?? "UNKNOWN", message: log.message });
		},
	});
	const output = await build.write({
		dir: out,
		format: "esm",
		entryFileNames: "[name].js",
		minify: true,
		codeSplitting: false,
		comments: { legal: true, annotation: false, jsdoc: false },
	});
	await build.close();
	return output;
};

interface NodeRun {
	readonly exitCode: number | null;
	readonly output: string;
}

/** Runs Node with only `PATH`, a scratch `HOME` and `env`, so no `GITHUB_*` variable or `NODE_OPTIONS` leaks in. */
const runNode = (args: ReadonlyArray<string>, cwd: string, env?: Readonly<Record<string, string>>): Promise<NodeRun> =>
	new Promise((done) => {
		execFile(
			process.execPath,
			[...args],
			{ cwd, env: { PATH: process.env.PATH ?? "", HOME: cwd, ...env }, timeout: NODE_TIMEOUT },
			(error, stdout, stderr) =>
				done({
					exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : null,
					output: `${stdout}${stderr}`,
				}),
		);
	});

const importArguments = (file: string): ReadonlyArray<string> => [
	"--input-type=module",
	"-e",
	`await import(${JSON.stringify(pathToFileURL(file).href)});`,
];

/** The `::error::` lines a run reported. */
const errorLines = (output: string): ReadonlyArray<string> =>
	output.split("\n").filter((line) => line.startsWith("::error::"));

const writeTree = (root: string, files: Readonly<Record<string, string>>): void => {
	for (const [name, source] of Object.entries(files)) {
		mkdirSync(dirname(join(root, name)), { recursive: true });
		writeFileSync(join(root, name), source);
	}
};

const ESM_MANIFEST = '{ "type": "module" }';

/** A package in the shape the rspack builder's workarounds were written for, and an entry that reports what it sees. */
const LEGACY_FIXTURE: Readonly<Record<string, string>> = {
	"package.json": ESM_MANIFEST,
	"node_modules/legacy/package.json": '{ "name": "legacy", "version": "1.0.0", "main": "index.js" }',
	"node_modules/legacy/index.js": [
		'"use strict";',
		"var __importDefault = (mod) => (mod && mod.__esModule ? mod : { default: mod });",
		'const fs = __importDefault(require("node:fs"));',
		'const Events = require("node:events");',
		"class Emitter extends Events {}",
		"exports.report = () => ({",
		"\tdirname: __dirname,",
		"\tfilename: __filename,",
		"\tinterop: typeof fs.default.existsSync,",
		"\temitter: new Emitter() instanceof Events,",
		"});",
		"",
	].join("\n"),
	"entry.js": [
		'import { report } from "legacy";',
		'const name = process.argv[2] ?? "sibling.js";',
		"const sibling = await import(new URL(name, import.meta.url).href);",
		"console.log(JSON.stringify({ ...report(), url: import.meta.url, computed: sibling.default }));",
		"",
	].join("\n"),
};

describe.skipIf(TARGET === undefined)("the action spike", () => {
	const target = TARGET ?? "";

	it("rolldown leaves __dirname bare, and keeps require, import.meta.url and a computed import working", async () => {
		const dir = mkdtempSync(join(tmpdir(), "effected-action-legacy-"));
		try {
			writeTree(dir, LEGACY_FIXTURE);
			const out = join(dir, "out");
			writeTree(out, { "package.json": ESM_MANIFEST, "sibling.js": 'export default "loaded";\n' });

			await bundle("plain", join(dir, "entry.js"), dir, out, []);
			const plain = await runNode([join(out, "plain.js")], out);
			assert.notStrictEqual(plain.exitCode, 0);
			assert.include(plain.output, "ReferenceError");
			assert.include(plain.output, "__dirname");

			await bundle("defined", join(dir, "entry.js"), dir, out, [], {
				define: { __dirname: "import.meta.dirname", __filename: "import.meta.filename" },
			});
			const defined = await runNode([join(out, "defined.js")], out);
			assert.strictEqual(defined.exitCode, 0, defined.output);
			const report = JSON.parse(defined.output) as Record<string, unknown>;
			assert.deepStrictEqual(report, {
				dirname: report.dirname,
				filename: report.filename,
				interop: "function",
				emitter: true,
				url: pathToFileURL(join(String(report.dirname), "defined.js")).href,
				computed: "loaded",
			});
			assert.strictEqual(dirname(String(report.filename)), String(report.dirname));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it(
		"bundles every entry into one file that imports with no GITHUB_ variable set",
		async () => {
			assert.isTrue(existsSync(join(target, "node_modules")), `${target} has no node_modules`);
			const scratch = KEEP_DIR ?? mkdtempSync(join(tmpdir(), "effected-action-spike-"));
			const out = join(scratch, "rolldown");
			const again = join(scratch, "rolldown-again");
			const umd = join(scratch, "rolldown-umd");
			const baselineDir = join(scratch, "rspack");
			for (const dir of [out, again, umd, baselineDir]) rmSync(dir, { recursive: true, force: true });
			for (const dir of [out, again, umd]) writeTree(dir, { "package.json": ESM_MANIFEST });

			// The baseline runs through the same checks from outside the checkout, so a difference below is rolldown's.
			const hasBaseline = existsSync(join(target, "dist"));
			if (hasBaseline) cpSync(join(target, "dist"), baselineDir, { recursive: true });

			const warnings: Array<LoggedWarning> = [];
			const rows = [];
			for (const [entry, source] of Object.entries(ENTRIES)) {
				const started = performance.now();
				const output = await bundle(entry, join(target, source), target, out, warnings);
				const ms = Math.round(performance.now() - started);
				await bundle(entry, join(target, source), target, again, []);
				const baseline = join(baselineDir, `${entry}.js`);
				const hasEntryBaseline = hasBaseline && existsSync(baseline);
				rows.push({
					entry,
					bytes: statSync(join(out, `${entry}.js`)).size,
					rspackBytes: hasEntryBaseline ? statSync(baseline).size : null,
					chunks: output.output.filter((item) => item.type === "chunk").length,
					ms,
					verdict: await checkImport(join(out, `${entry}.js`), { cwd: out }),
					rspackVerdict: hasEntryBaseline ? await checkImport(baseline, { cwd: baselineDir }) : null,
				});
			}

			const codeOf = (dir: string, entry: string): string => readFileSync(join(dir, `${entry}.js`), "utf-8");
			const scans = Object.fromEntries(
				rows.map(({ entry }) => {
					const code = codeOf(out, entry);
					const count = (pattern: RegExp): number => code.match(pattern)?.length ?? 0;
					return [
						entry,
						{
							computedImports: count(/\bimport\((?!["'`])/g),
							importMetaUrl: count(/import\.meta\.url/g),
							dirnameReferences: count(/\b__dirname\b/g),
							filenameReferences: count(/\b__filename\b/g),
							createRequire: count(/\bcreateRequire\b/g),
							legalComments: count(/\/\*!/g),
							stubs: IGNORE.filter((name) => code.includes(`${name} is excluded by build.ignore`)),
							buildPaths: count(new RegExp(target.replaceAll("/", "\\/"), "g")),
							reproducible: code === codeOf(again, entry),
						},
					];
				}),
			);

			// Rolldown's own default for the node platform.
			const umdEntry = await bundle("main", join(target, "src/main.ts"), target, umd, [], {
				mainFields: ["main", "module"],
			});
			const umdVerdict = await checkImport(join(umd, "main.js"), { cwd: umd });

			// With GITHUB_ACTIONS set the entries run for real, as far as they get with no input, state or token.
			const runtime = [];
			if (hasBaseline) {
				for (const entry of ["pre", "main", "post"]) {
					const env = { GITHUB_ACTIONS: "true" };
					const rolldownRun = await runNode(importArguments(join(out, `${entry}.js`)), out, env);
					const rspackRun = await runNode(importArguments(join(baselineDir, `${entry}.js`)), baselineDir, env);
					runtime.push({ entry, rolldownRun, rspackRun });
				}
			}

			writeFileSync(
				join(scratch, "report.json"),
				`${JSON.stringify({ rows, scans, warnings, umdVerdict, runtime }, null, "\t")}\n`,
			);
			if (KEEP_DIR === undefined) rmSync(scratch, { recursive: true, force: true });

			for (const row of rows) {
				assert.strictEqual(row.chunks, 1, `${row.entry} did not bundle into one file`);
				assert.notStrictEqual(row.verdict.kind, "failed", `${row.entry}: ${JSON.stringify(row.verdict)}`);
				if (row.rspackVerdict !== null) {
					assert.notStrictEqual(row.rspackVerdict.kind, "failed", `the baseline ${row.entry} is broken`);
				}
				const scan = scans[row.entry];
				assert.strictEqual(scan?.buildPaths, 0, `${row.entry} carries a build-machine path`);
				assert.isTrue(scan?.reproducible, `${row.entry} differs between two builds`);
			}
			assert.deepStrictEqual([...new Set(warnings.map((warning) => warning.code))], ["CIRCULAR_DEPENDENCY"]);
			assert.deepStrictEqual(scans.main?.stubs, IGNORE, "the ignore stubs did not reach main");

			// A computed import stays native, and rolldown's default resolution is the broken one.
			assert.isAbove(scans.main?.computedImports ?? 0, 0);
			assert.lengthOf(
				umdEntry.output.filter((item) => item.type === "chunk"),
				1,
			);
			assert.strictEqual(umdVerdict.kind, "failed");
			assert.include(umdVerdict.kind === "failed" ? umdVerdict.message : "", "./impl/format");

			for (const { entry, rolldownRun, rspackRun } of runtime) {
				assert.strictEqual(rolldownRun.exitCode, rspackRun.exitCode, entry);
				assert.deepStrictEqual(errorLines(rolldownRun.output), errorLines(rspackRun.output), entry);
			}
			if (hasBaseline) {
				// Read directly rather than through checkImport's predicate, so it can catch that predicate being wrong.
				const mainRun = runtime.find(({ entry }) => entry === "main");
				const mainErrors = errorLines(mainRun?.rolldownRun.output ?? "");
				assert.lengthOf(mainErrors, 1);
				assert.include(mainErrors[0] ?? "", 'at ["INPUT_APP-CLIENT-ID"]');
			}
		},
		SPIKE_TIMEOUT,
	);
});

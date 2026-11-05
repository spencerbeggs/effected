import { assert, describe, it } from "@effect/vitest";
import { RunReport } from "@effected/engine/schema";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import type { HostedSchema, SchemastoreConfig } from "@effected/schemastore";
import {
	CatalogEntry,
	InstanceFinding,
	InstanceValidator,
	SchemaValidator,
	SchemaValidatorError,
	SchemastoreVersion,
	StoreDocument,
	ValidationFinding,
	defineConfig,
} from "@effected/schemastore";
import { Effect, Result, Schema } from "effect";
import { CLI_VERSION } from "../../src/version.js";
import {
	BASIC_ID,
	BASIC_PATH,
	CATALOG_PATH,
	CONFIG_PATH,
	Config,
	SLICE_PATH,
	Wider,
	basicConfig,
	depsFor,
	emitted,
	runCli,
} from "./harness.js";

// The published document on disk was generated from the wider contract, so regenerating from `Config` is a contract
// change at a published version.
const driftedSeed: MemoryFileSystemSeed = { [CONFIG_PATH]: "", [BASIC_PATH]: emitted(Wider, BASIC_ID) };

const rejectEverything = SchemaValidator.layerTest({
	validate: () => Effect.succeed([ValidationFinding.make({ path: "/type", message: "rejected", keyword: "type" })]),
});

const catalogEntryOf = (config: SchemastoreConfig): CatalogEntry => {
	const entry = config.schemas[0]?.catalog;
	assert.isDefined(entry, "the basic config always declares a catalog entry");
	return entry;
};

// The fresh-volume seed plus the exact documents a `build` writes, so a `check` over it is clean.
const builtSeed: MemoryFileSystemSeed = {
	[CONFIG_PATH]: "",
	[BASIC_PATH]: emitted(Config, BASIC_ID),
	[SLICE_PATH]: `${JSON.stringify([Schema.encodeSync(CatalogEntry)(catalogEntryOf(basicConfig()))])}\n`,
	[CATALOG_PATH]: `${JSON.stringify([Schema.encodeSync(CatalogEntry)(catalogEntryOf(basicConfig()))])}\n`,
};

const deps = depsFor(basicConfig());
const schema = (...args: ReadonlyArray<string>) => ["schema", ...args];
const report = (err: ReadonlyArray<string>) => err.join("\n");

// A HostedSchema from another copy of the package: the brand and its own stamp, and none of this copy's methods.
const foreignHosted = (version: string) =>
	Object.defineProperties(
		{ name: "app", baseUrl: "https://example.com/schemas" },
		{
			[Symbol.for("@effected/schemastore/HostedSchema")]: { value: true },
			[Symbol.for("@effected/schemastore/version")]: { value: version },
		},
	) as HostedSchema;

const foreignConfig = defineConfig({
	name: "test",
	outputDir: "schemas",
	schemas: { app: { schema: Config, hosted: foreignHosted("0.0.1") } },
});

describe("effected schema", () => {
	it.effect("the built schemastore carries a real version, or the mismatch tests below prove nothing", () =>
		Effect.sync(() => assert.notStrictEqual(SchemastoreVersion.current, "0.0.0")),
	);

	it.effect("check on a fresh volume reports what build would write and fails stale at exit 1", () =>
		Effect.gen(function* () {
			const { code, out, err, volume } = yield* runCli(schema("check"), { deps, seed: { [CONFIG_PATH]: "" } });
			assert.strictEqual(code, 1);
			assert.match(report(err), /^✗ StaleError: 3 document\(s\) are stale; run `effected schema build`/m);
			assert.include(out, `would write (created) ${BASIC_PATH} [policy semantic]`);
			assert.include(out, `would write catalog slice ${SLICE_PATH} (1 entries)`);
			assert.include(out, `would write catalog ${CATALOG_PATH} (1 entries from 1 slice(s))`);
			assert.include(
				out,
				"1 schema(s): 0 written, 0 unchanged, 0 drift, 0 gate failed — drift per schema (config), on-drift error",
			);
			assert.isFalse(volume.has(BASIC_PATH), "check never writes");
		}),
	);

	it.effect("check over the exact generated documents exits 0", () =>
		Effect.gen(function* () {
			const { code, out } = yield* runCli(schema("check"), { deps, seed: builtSeed });
			assert.strictEqual(code, 0);
			assert.include(out, `unchanged ${BASIC_PATH} [policy semantic]`);
			assert.include(out, `unchanged catalog ${CATALOG_PATH} (1 entries from 1 slice(s))`);
		}),
	);

	it.effect("check with only a stale merged catalog fails stale at exit 1", () =>
		Effect.gen(function* () {
			const { code, out, err } = yield* runCli(schema("check"), {
				deps,
				seed: { ...builtSeed, [CATALOG_PATH]: '{"name":"basic","description":"old"}\n' },
			});
			assert.strictEqual(code, 1);
			assert.include(report(err), "1 document(s) are stale");
			assert.include(out, `unchanged ${BASIC_PATH} [policy semantic]`);
			assert.include(out, `unchanged catalog slice ${SLICE_PATH} (1 entries)`);
			assert.include(out, `would write catalog ${CATALOG_PATH} (1 entries from 1 slice(s))`);
		}),
	);

	it.effect("build over the exact generated documents changes nothing and exits 0", () =>
		Effect.gen(function* () {
			const { code, out } = yield* runCli(schema("build"), { deps, seed: builtSeed });
			assert.strictEqual(code, 0);
			assert.include(out, `unchanged ${BASIC_PATH} [policy semantic]`);
			assert.include(out, `unchanged catalog ${CATALOG_PATH} (1 entries from 1 slice(s))`);
		}),
	);

	it.effect("build with an explicit config path resolves a relative outputDir against the config's directory", () =>
		Effect.gen(function* () {
			const { code, out, volume } = yield* runCli(schema("build", "lib/schemastore.config.ts"), {
				deps: depsFor(basicConfig({ outputDir: "schemas" })),
				seed: { "/repo/lib/schemastore.config.ts": "" },
			});
			assert.strictEqual(code, 0);
			assert.isTrue(volume.has("/repo/lib/schemas/basic-1.0.json"));
			assert.isTrue(volume.has("/repo/lib/schemas/catalogs/test.json"));
			assert.isTrue(volume.has("/repo/lib/schemas/catalog.json"));
			assert.include(out, "written (created) /repo/lib/schemas/basic-1.0.json [policy semantic]");
		}),
	);

	it.effect("no config exits 2 and names the file names, where it looked and an example", () =>
		Effect.gen(function* () {
			const { code, out, err } = yield* runCli(schema("build"), { deps, seed: { "/repo/.keep": "" } });
			assert.strictEqual(code, 2);
			assert.deepStrictEqual(out, []);
			const text = report(err);
			assert.match(text, /^✗ /m);
			assert.include(text, "schemastore.config.ts");
			assert.include(text, "schemastore.config.mjs");
			assert.include(text, "/repo", "where it looked");
			assert.include(text, "effected schema build lib/schemastore.config.ts", "an example using a path");
		}),
	);

	it.effect("the example names the command that was run", () =>
		Effect.gen(function* () {
			const { code, err } = yield* runCli(schema("check"), { deps, seed: { "/repo/.keep": "" } });
			assert.strictEqual(code, 2);
			assert.include(report(err), "effected schema check lib/schemastore.config.ts");
		}),
	);

	it.effect("a config module that throws exits 2, with the first stack line in the message alone", () =>
		Effect.gen(function* () {
			const { code, err } = yield* runCli(schema("build"), {
				deps: depsFor(basicConfig(), { importModule: () => Promise.reject(new Error("boom\n    at somewhere")) }),
				seed: { [CONFIG_PATH]: "" },
			});
			assert.strictEqual(code, 2);
			assert.include(report(err), "boom");
			assert.notInclude(report(err), "at somewhere");
		}),
	);

	it.effect("a version mismatch exits 2 naming both versions, and writes nothing", () =>
		Effect.gen(function* () {
			const { code, out, err, volume } = yield* runCli(schema("build"), {
				deps: depsFor(foreignConfig),
				seed: { [CONFIG_PATH]: "" },
			});
			assert.strictEqual(code, 2);
			assert.deepStrictEqual(out, []);
			assert.include(report(err), SchemastoreVersion.current);
			assert.include(report(err), "0.0.1");
			assert.deepStrictEqual(volume.paths(), [CONFIG_PATH]);
		}),
	);

	it.effect("--ignore-version-mismatch warns on stderr and proceeds", () =>
		Effect.gen(function* () {
			const { code, out, err, volume } = yield* runCli(schema("build", "--ignore-version-mismatch"), {
				deps: depsFor(foreignConfig),
				seed: { [CONFIG_PATH]: "" },
			});
			assert.strictEqual(code, 0, report(err));
			const warning = err.find((line) => line.includes("0.0.1"));
			assert.isDefined(warning, report(err));
			assert.include(warning, SchemastoreVersion.current);
			assert.isTrue(volume.paths().length > 1, "it wrote");
			assert.notInclude(out.join("\n"), "0.0.1", "the warning stays off stdout");
		}),
	);

	it.effect("--ignore-version-mismatch warns before the walk, so a run that later fails still shows it", () =>
		Effect.gen(function* () {
			const { code, err } = yield* runCli(schema("build", "--ignore-version-mismatch"), {
				deps: depsFor(foreignConfig, {
					validator: SchemaValidator.layerTest({
						validate: () => Effect.fail(new SchemaValidatorError({ cause: new Error("engine exploded") })),
					}),
				}),
				seed: { [CONFIG_PATH]: "" },
			});
			assert.strictEqual(code, 3);
			const warning = err.findIndex((line) => line.includes("0.0.1"));
			const failure = err.findIndex((line) => line.startsWith("✗ "));
			assert.isAtLeast(warning, 0, report(err));
			assert.isBelow(warning, failure, report(err));
		}),
	);

	it.effect("build refuses published contract drift under onDrift error: exit 1, file unchanged", () =>
		Effect.gen(function* () {
			const { code, out, err, volume } = yield* runCli(schema("build"), { deps, seed: driftedSeed });
			assert.strictEqual(code, 1);
			assert.match(report(err), /^✗ DriftError: 1 published schema\(s\) drifted; nothing was written\.$/m);
			assert.include(report(err), `${BASIC_ID}: contract at published 1.0 → suggest 1.1`);
			assert.include(report(err), "--force");
			assert.match(report(err), /^in: .*effected\.schema\.execute/m);
			assert.strictEqual(volume.text(BASIC_PATH), emitted(Wider, BASIC_ID));
			assert.isTrue(
				out.some((line) => line.startsWith("DRIFT contract at published 1.0 → suggest 1.1")),
				out.join("\n"),
			);
		}),
	);

	it.effect("--on-drift=warn writes the drifted schema, exits 0 and warns on stderr", () =>
		Effect.gen(function* () {
			const { code, out, err, volume } = yield* runCli(schema("build", "--on-drift=warn"), { deps, seed: driftedSeed });
			assert.strictEqual(code, 0);
			assert.strictEqual(volume.text(BASIC_PATH), emitted(Config, BASIC_ID));
			assert.include(out, `written (contract) ${BASIC_PATH} [policy semantic]`);
			assert.include(
				out,
				"1 schema(s): 1 written, 0 unchanged, 1 drift, 0 gate failed — drift per schema (config), on-drift warn",
			);
			assert.isTrue(
				err.some((line) => line.includes("warning: DRIFT contract at published 1.0 written under --on-drift=warn")),
				report(err),
			);
		}),
	);

	it.effect("check refuses published contract drift like build and holds the catalog rather than would-write", () =>
		Effect.gen(function* () {
			const { code, out, volume } = yield* runCli(schema("check"), { deps, seed: driftedSeed });
			assert.strictEqual(code, 1);
			assert.strictEqual(volume.text(BASIC_PATH), emitted(Wider, BASIC_ID));
			assert.isFalse(volume.has(CATALOG_PATH), "check never writes");
			assert.include(out, `held catalog ${CATALOG_PATH} (1 entries from 1 slice(s))`);
			assert.notInclude(out, `would write catalog ${CATALOG_PATH} (1 entries from 1 slice(s))`);
		}),
	);

	it.effect("check --on-drift=warn writes nothing, says what a build would write, and still fails stale", () =>
		Effect.gen(function* () {
			const { code, out, err, volume } = yield* runCli(schema("check", "--on-drift=warn"), { deps, seed: driftedSeed });
			assert.strictEqual(code, 1);
			assert.include(report(err), "StaleError");
			assert.strictEqual(volume.text(BASIC_PATH), emitted(Wider, BASIC_ID), "check never writes");
			assert.include(out, `would write catalog ${CATALOG_PATH} (1 entries from 1 slice(s))`);
			assert.isTrue(
				err.some((line) => line.includes("warning: DRIFT contract at published 1.0 would write under --on-drift=warn")),
				report(err),
			);
		}),
	);

	it.effect("--force rewrites the published document and warns about it in today's words", () =>
		Effect.gen(function* () {
			const { code, out, err, volume } = yield* runCli(schema("build", "--force"), { deps, seed: driftedSeed });
			assert.strictEqual(code, 0);
			assert.strictEqual(volume.text(BASIC_PATH), emitted(Config, BASIC_ID));
			assert.include(
				out,
				"1 schema(s): 1 written, 0 unchanged, 0 drift, 0 gate failed — drift allow (flag), on-drift error",
			);
			assert.isTrue(
				err.some((line) =>
					line.includes(
						"--force: drift policy is allow for this run; a published document may be rewritten in place, which breaks every consumer pinned to its URL.",
					),
				),
				report(err),
			);
		}),
	);

	for (const command of ["build", "check"]) {
		it.effect(`${command} --force with --drift=strict is a usage error (exit 64) and writes nothing`, () =>
			Effect.gen(function* () {
				const { code, err, volume } = yield* runCli(schema(command, "--force", "--drift=strict"), {
					deps,
					seed: driftedSeed,
				});
				assert.strictEqual(code, 64);
				assert.include(report(err), "--force conflicts with --drift=strict");
				assert.strictEqual(volume.text(BASIC_PATH), emitted(Wider, BASIC_ID), "nothing written");
			}),
		);
	}

	it.effect("--force with --drift=allow is accepted (redundant, not conflicting)", () =>
		Effect.gen(function* () {
			const { code, volume } = yield* runCli(schema("build", "--force", "--drift=allow"), { deps, seed: driftedSeed });
			assert.strictEqual(code, 0);
			assert.strictEqual(volume.text(BASIC_PATH), emitted(Config, BASIC_ID));
		}),
	);

	it.effect("a gate failure exits 1 even under --on-drift=warn, writing nothing", () =>
		Effect.gen(function* () {
			const { code, out, err, volume } = yield* runCli(schema("build", "--on-drift=warn"), {
				deps: depsFor(basicConfig(), { validator: rejectEverything }),
				seed: { [CONFIG_PATH]: "" },
			});
			assert.strictEqual(code, 1);
			assert.include(report(err), "GateError: 1 schema(s) failed");
			assert.isFalse(volume.has(BASIC_PATH));
			assert.isFalse(volume.has(CATALOG_PATH));
			assert.isTrue(
				out.some((line) => line.startsWith(`GATE FAILED ${BASIC_PATH}`)),
				out.join("\n"),
			);
		}),
	);

	it.effect("a stale check prints the diff on stdout under human format", () =>
		Effect.gen(function* () {
			const { code, out } = yield* runCli(schema("check", "--on-drift=warn"), { deps, seed: driftedSeed });
			assert.strictEqual(code, 1);
			assert.include(out, `@@ ${BASIC_PATH} @@`);
			assert.isTrue(
				out.some((line) => line.startsWith("-") && line.includes("extra")),
				out.join("\n"),
			);
			// The summary closes the report, below every diff.
			assert.match(out.at(-1) ?? "", /^1 schema\(s\):/);
		}),
	);

	it.effect("--format=json stdout parses as RunReport with nothing else on stdout", () =>
		Effect.gen(function* () {
			const { code, stdoutCalls, err } = yield* runCli(schema("check", "--format=json"), {
				deps,
				seed: { [CONFIG_PATH]: "" },
			});
			assert.strictEqual(code, 1);
			assert.lengthOf(stdoutCalls, 1);
			const parsed = Schema.decodeUnknownSync(RunReport.Json)(JSON.parse(stdoutCalls[0] as string));
			assert.strictEqual(parsed.mode, "check");
			assert.strictEqual(parsed.schemas[0]?.outcome, "would-write");
			assert.include(err, `would write (created) ${BASIC_PATH} [policy semantic]`);
		}),
	);

	it.effect("--format=json keeps stdout to one document even with a warning in play", () =>
		Effect.gen(function* () {
			const { stdoutCalls, err } = yield* runCli(schema("check", "--format=json", "--force"), {
				deps,
				seed: driftedSeed,
			});
			assert.lengthOf(stdoutCalls, 1);
			const parsed = JSON.parse(stdoutCalls[0] as string) as { drift: { policy?: string } };
			assert.strictEqual(parsed.drift.policy, "allow");
			assert.isTrue(
				err.some((line) => line.includes("--force") && line.includes("would be rewritten")),
				report(err),
			);
		}),
	);

	it.effect("appends the markdown summary when GITHUB_STEP_SUMMARY is set", () =>
		Effect.gen(function* () {
			const { volume } = yield* runCli(schema("check"), {
				deps,
				seed: { [CONFIG_PATH]: "" },
				env: { GITHUB_STEP_SUMMARY: "/summary.md" },
			});
			assert.include(volume.text("/summary.md") ?? "", "### effected schema check");
		}),
	);

	it.effect("writes no summary when GITHUB_STEP_SUMMARY is unset", () =>
		Effect.gen(function* () {
			const { volume } = yield* runCli(schema("check"), { deps, seed: { [CONFIG_PATH]: "" } });
			assert.isFalse(volume.has("/summary.md"));
		}),
	);

	it.effect("the config's own onDrift is honoured when no flag overrides it", () =>
		Effect.gen(function* () {
			const { code, out } = yield* runCli(schema("build"), {
				deps: depsFor(basicConfig({ onDrift: "warn" })),
				seed: driftedSeed,
			});
			assert.strictEqual(code, 0);
			assert.include(
				out,
				"1 schema(s): 1 written, 0 unchanged, 1 drift, 0 gate failed — drift per schema (config), on-drift warn",
			);
		}),
	);

	it.effect("a missing frozen version exits 1, writing nothing", () =>
		Effect.gen(function* () {
			const { code, err, volume } = yield* runCli(schema("build"), {
				deps: depsFor(basicConfig({ versions: ["0.9", "1.0"] })),
				seed: { [CONFIG_PATH]: "" },
			});
			assert.strictEqual(code, 1);
			assert.include(report(err), "FrozenVersionMissingError");
			assert.include(report(err), "/repo/schemas/basic-0.9.json");
			assert.isFalse(volume.has(BASIC_PATH), "nothing is written before the frozen check clears");
		}),
	);

	it.effect("a frozen file whose $id disagrees with its URL exits 1, writing nothing", () =>
		Effect.gen(function* () {
			const { code, err, volume } = yield* runCli(schema("build"), {
				deps: depsFor(basicConfig({ versions: ["0.9", "1.0"] })),
				seed: {
					[CONFIG_PATH]: "",
					"/repo/schemas/basic-0.9.json": emitted(Config, "https://old.example.com/basic-0.9.json"),
				},
			});
			assert.strictEqual(code, 1);
			assert.include(report(err), "FrozenVersionIdMismatchError");
			assert.include(report(err), "https://old.example.com/basic-0.9.json");
			assert.isFalse(volume.has(BASIC_PATH), "nothing is written before the frozen check clears");
		}),
	);

	for (const command of ["build", "check"]) {
		it.effect(`a url another config's slice advertises fails ${command} at exit 1, naming both slices`, () =>
			Effect.gen(function* () {
				const other = "/repo/schemas/catalogs/other.json";
				const { code, out, err } = yield* runCli(schema(command), {
					deps,
					seed: { ...builtSeed, [other]: builtSeed[SLICE_PATH] as string },
				});
				assert.strictEqual(code, 1);
				assert.include(report(err), "CatalogMergeError");
				assert.include(report(err), `url ${BASIC_ID} is advertised by ${other}, ${SLICE_PATH}`);
				assert.include(out, `CATALOG BLOCKED ${CATALOG_PATH} (not written: fix the slices below)`);
			}),
		);

		it.effect(`a catalogDir that is a file is a config error at exit 2 under ${command}`, () =>
			Effect.gen(function* () {
				const { code, err } = yield* runCli(schema(command), {
					deps,
					seed: { [CONFIG_PATH]: "", "/repo/schemas/catalogs": "not a directory\n" },
				});
				assert.strictEqual(code, 2);
				assert.include(report(err), "catalogDir /repo/schemas/catalogs cannot be listed (not a directory)");
			}),
		);
	}

	it.effect("a catalog name conflict is reported in JSON on stdout and in the failure on stderr", () =>
		Effect.gen(function* () {
			const other = "/repo/schemas/catalogs/other.json";
			const { code, stdoutCalls, err } = yield* runCli(schema("check", "--format=json"), {
				deps,
				seed: {
					...builtSeed,
					[other]: `${JSON.stringify([{ name: "basic", description: "d", fileMatch: [], url: "https://example.com/other.json" }])}\n`,
				},
			});
			assert.strictEqual(code, 1);
			assert.include(report(err), `name basic is advertised by ${other}, ${SLICE_PATH}`);
			assert.include(report(err), "Give each catalog URL and name to exactly one config");
			assert.lengthOf(stdoutCalls, 1);
			const parsed = JSON.parse(stdoutCalls[0] as string) as { catalog: { merged: Record<string, unknown> } };
			assert.strictEqual(parsed.catalog.merged.outcome, "blocked");
		}),
	);

	it.effect("CatalogMergeError names why each invalid slice is invalid", () =>
		Effect.gen(function* () {
			const { code, err } = yield* runCli(schema("check"), {
				deps,
				seed: {
					...builtSeed,
					"/repo/schemas/catalogs/extra.json": `${JSON.stringify([{ name: "e", description: "d", fileMatch: [], url: "https://example.com/e.json", extra: 1 }])}\n`,
					"/repo/schemas/catalogs/text.json": "not json\n",
				},
			});
			assert.strictEqual(code, 1);
			assert.include(
				report(err),
				'/repo/schemas/catalogs/extra.json is invalid: Expected no excess property at [0]["extra"]',
			);
			assert.include(report(err), "/repo/schemas/catalogs/text.json is invalid: not JSON");
		}),
	);

	it.effect("an orphaned slice is stale under check, and reported but kept under build", () =>
		Effect.gen(function* () {
			const uncataloged = depsFor(
				defineConfig({
					name: "test",
					outputDir: "/repo/schemas",
					baseUrl: "https://example.com/schemas",
					schemas: { basic: { schema: Config, layout: "flat", published: true, versions: ["1.0"] } },
				}),
			);
			const checked = yield* runCli(schema("check"), { deps: uncataloged, seed: builtSeed });
			assert.strictEqual(checked.code, 1);
			assert.include(report(checked.err), "1 orphaned output(s) must be deleted by hand; build never will.");
			assert.notInclude(report(checked.err), "effected schema build", "a build cannot clear it");
			const built = yield* runCli(schema("build"), { deps: uncataloged, seed: builtSeed });
			assert.strictEqual(built.code, 0);
			assert.isTrue(built.volume.has(SLICE_PATH), "build reports the orphaned slice but never deletes it");
		}),
	);

	it.effect("an orphaned document at a sibling shape is stale under check, and reported but kept under build", () =>
		Effect.gen(function* () {
			const orphan = "/repo/schemas/1.0/basic-1.0.json";
			const seed = { ...builtSeed, [orphan]: emitted(Config, "https://example.com/schemas/1.0/basic-1.0.json") };
			const checked = yield* runCli(schema("check"), { deps, seed });
			assert.strictEqual(checked.code, 1);
			assert.include(
				checked.out,
				`orphaned document ${orphan} (no target, frozen version, or catalog entry claims it — delete it by hand; build never will)`,
			);
			const built = yield* runCli(schema("build"), { deps, seed });
			assert.strictEqual(built.code, 0);
			assert.isTrue(built.volume.has(orphan), "build reports the orphan but never deletes it");
		}),
	);

	it.effect("a typed error with no code of its own (an engine mechanism failure) exits 3", () =>
		Effect.gen(function* () {
			const { code, err } = yield* runCli(schema("build"), {
				deps: depsFor(basicConfig(), {
					validator: SchemaValidator.layerTest({
						validate: () => Effect.fail(new SchemaValidatorError({ cause: new Error("engine exploded") })),
					}),
				}),
				seed: { [CONFIG_PATH]: "" },
			});
			assert.strictEqual(code, 3);
			assert.isTrue(
				err.some((line) => line.startsWith("✗ ")),
				report(err),
			);
		}),
	);

	describe("usage", () => {
		it.effect("--bogus is a usage error at exit 64", () =>
			Effect.gen(function* () {
				const { code, out } = yield* runCli(schema("build", "--bogus"), { deps, seed: { [CONFIG_PATH]: "" } });
				assert.strictEqual(code, 64);
				assert.deepStrictEqual(out, []);
			}),
		);

		it.effect("--drift=loose is a usage error at exit 64", () =>
			Effect.gen(function* () {
				const { code } = yield* runCli(schema("build", "--drift=loose"), { deps, seed: { [CONFIG_PATH]: "" } });
				assert.strictEqual(code, 64);
			}),
		);

		it.effect("schema with no subcommand shows help at exit 0, naming all three", () =>
			Effect.gen(function* () {
				const { code, out } = yield* runCli(schema(), { deps });
				assert.strictEqual(code, 0);
				for (const command of ["build", "check", "validate"]) assert.include(out.join("\n"), command);
			}),
		);

		it.effect("help beside a parse error still exits 0: build --bogus --help", () =>
			Effect.gen(function* () {
				const { code, err } = yield* runCli(schema("build", "--bogus", "--help"), { deps });
				assert.strictEqual(code, 0);
				assert.isFalse(err.some((line) => line.startsWith("✗ ")));
			}),
		);

		it.effect("--wizard on a run nobody can answer is a usage error at exit 64", () =>
			Effect.gen(function* () {
				const { code } = yield* runCli(schema("build", "--wizard"), { deps, seed: { [CONFIG_PATH]: "" } });
				assert.strictEqual(code, 64);
			}),
		);

		it.effect("subcommand help summarizes inherited flags", () =>
			Effect.gen(function* () {
				const { code, out } = yield* runCli(schema("build", "--help"), { deps });
				assert.strictEqual(code, 0);
				const help = out.join("\n");
				assert.include(help, "--force", "its own flags are listed");
				assert.include(help, "--ignore-version-mismatch");
				assert.notInclude(help, "--audience", "the shared flags are one line, not a list");
				assert.include(help.toLowerCase(), "inherited");
			}),
		);

		it.effect("effected --version is unchanged", () =>
			Effect.gen(function* () {
				const { code, out } = yield* runCli(["--version"], { deps });
				assert.strictEqual(code, 0);
				assert.deepStrictEqual(out, [`effected ${CLI_VERSION}`]);
			}),
		);
	});

	describe("validate", () => {
		const PAYLOAD_PATH = "/repo/payload.json";

		const payloadSeed = (payload: unknown): MemoryFileSystemSeed => ({
			...builtSeed,
			[PAYLOAD_PATH]: `${JSON.stringify(payload)}\n`,
		});

		it.effect("a conforming payload validates against its $schema identity at exit 0", () =>
			Effect.gen(function* () {
				const { code, out } = yield* runCli(schema("validate", "payload.json"), {
					deps,
					seed: payloadSeed({ $schema: BASIC_ID, name: "x" }),
				});
				assert.strictEqual(code, 0);
				assert.include(out, `valid ${PAYLOAD_PATH} against ${BASIC_PATH}`);
			}),
		);

		it.effect("a document declaring $schema validates the payload verbatim, self-reference included", () =>
			Effect.gen(function* () {
				const SelfReferencing = Schema.Struct({ $schema: Schema.Literal(BASIC_ID), name: Schema.String });
				const { code, out } = yield* runCli(schema("validate", "payload.json"), {
					deps,
					seed: {
						...builtSeed,
						[BASIC_PATH]: emitted(SelfReferencing, BASIC_ID),
						[PAYLOAD_PATH]: `${JSON.stringify({ $schema: BASIC_ID, name: "x" })}\n`,
					},
				});
				assert.strictEqual(code, 0);
				assert.include(out, `valid ${PAYLOAD_PATH} against ${BASIC_PATH}`);
			}),
		);

		it.effect("a rootAnnotations-wrapped shared $ref root declaring $schema validates verbatim", () =>
			Effect.gen(function* () {
				class Shared extends Schema.Class<Shared>("Shared")({
					$schema: Schema.Literal(BASIC_ID),
					name: Schema.String,
					children: Schema.Array(Schema.suspend((): Schema.Codec<Shared> => Shared)),
				}) {}
				const wrapped = Result.getOrThrow(
					Result.getOrThrow(
						StoreDocument.fromSchemaResult(Shared, { $id: BASIC_ID, rootAnnotations: { title: "T" } }),
					).serializeResult(),
				);
				const { code } = yield* runCli(schema("validate", "payload.json"), {
					deps,
					seed: {
						...builtSeed,
						[BASIC_PATH]: wrapped,
						[PAYLOAD_PATH]: `${JSON.stringify({ $schema: BASIC_ID, name: "x", children: [] })}\n`,
					},
				});
				assert.strictEqual(code, 0);
			}),
		);

		it.effect("validate prints file:line:col for each finding", () =>
			Effect.gen(function* () {
				const { code, out, err } = yield* runCli(schema("validate", "payload.json"), {
					deps,
					seed: {
						...builtSeed,
						[PAYLOAD_PATH]: `{\n  "$schema": "${BASIC_ID}",\n  "name": 42\n}\n`,
					},
				});
				assert.strictEqual(code, 1);
				assert.include(report(err), "ValidationFailedError");
				const finding = out.find((line) => line.includes("/name"));
				assert.isDefined(finding, out.join("\n"));
				assert.include(finding, `${PAYLOAD_PATH}:3:11:`);
				assert.include(finding, "[type]");
				assert.include(out, `1 finding(s): ${PAYLOAD_PATH} does not conform to ${BASIC_ID}`);
			}),
		);

		it.effect("a frozen version's $id resolves to its committed document", () =>
			Effect.gen(function* () {
				const { code, out } = yield* runCli(schema("validate", "payload.json"), {
					deps: depsFor(basicConfig({ versions: ["1.0", "2.0"] })),
					seed: {
						[CONFIG_PATH]: "",
						[BASIC_PATH]: emitted(Config, BASIC_ID),
						[PAYLOAD_PATH]: `${JSON.stringify({ $schema: BASIC_ID, name: "x" })}\n`,
					},
				});
				assert.strictEqual(code, 0);
				assert.include(out, `valid ${PAYLOAD_PATH} against ${BASIC_PATH}`);
			}),
		);

		it.effect("--schema names a file directly and needs no config", () =>
			Effect.gen(function* () {
				const { code, out } = yield* runCli(schema("validate", "payload.json", "--schema", "local/basic.schema.json"), {
					// No importModule: reaching for a config would fail discovery.
					deps: { cwd: "/repo" },
					seed: {
						"/repo/local/basic.schema.json": `${JSON.stringify({
							type: "object",
							properties: { name: { type: "string" } },
							required: ["name"],
						})}\n`,
						[PAYLOAD_PATH]: `${JSON.stringify({ name: "x" })}\n`,
					},
				});
				assert.strictEqual(code, 0);
				assert.include(out, `valid ${PAYLOAD_PATH} against /repo/local/basic.schema.json`);
			}),
		);

		it.effect("a --schema document that is a JSON array, not an object, exits 2", () =>
			Effect.gen(function* () {
				const { code, err } = yield* runCli(schema("validate", "payload.json", "--schema", "local/array.schema.json"), {
					deps: { cwd: "/repo" },
					seed: {
						"/repo/local/array.schema.json": `${JSON.stringify([{ type: "object" }])}\n`,
						[PAYLOAD_PATH]: `${JSON.stringify({ name: "x" })}\n`,
					},
				});
				assert.strictEqual(code, 2);
				assert.include(report(err), "is not a JSON object");
			}),
		);

		it.effect("an unresolvable $schema exits 2", () =>
			Effect.gen(function* () {
				const { code, err } = yield* runCli(schema("validate", "payload.json"), {
					deps,
					seed: payloadSeed({ $schema: "https://example.com/schemas/nope.json", name: "x" }),
				});
				assert.strictEqual(code, 2);
				assert.include(report(err), "no schema in the config derives this $id or url");
			}),
		);

		it.effect("a payload naming nothing is a usage error at exit 64", () =>
			Effect.gen(function* () {
				const { code, err } = yield* runCli(schema("validate", "payload.json"), {
					deps,
					seed: payloadSeed({ name: "x" }),
				});
				assert.strictEqual(code, 64);
				assert.include(report(err), "--schema");
			}),
		);

		it.effect("a malformed payload exits 2", () =>
			Effect.gen(function* () {
				const { code, err } = yield* runCli(schema("validate", "payload.json"), {
					deps,
					seed: { ...builtSeed, [PAYLOAD_PATH]: "not json\n" },
				});
				assert.strictEqual(code, 2);
				assert.include(report(err), "PayloadError");
			}),
		);

		it.effect("a missing payload exits 2", () =>
			Effect.gen(function* () {
				const { code, err } = yield* runCli(schema("validate", "payload.json"), { deps, seed: builtSeed });
				assert.strictEqual(code, 2);
				assert.include(report(err), "PayloadError");
			}),
		);

		it.effect(
			"a version mismatch on an identity reference exits 2, and --ignore-version-mismatch warns and proceeds",
			() =>
				Effect.gen(function* () {
					const seed = {
						[CONFIG_PATH]: "",
						[PAYLOAD_PATH]: `${JSON.stringify({ $schema: "https://nope", name: "x" })}\n`,
					};
					const refused = yield* runCli(schema("validate", "payload.json"), { deps: depsFor(foreignConfig), seed });
					assert.strictEqual(refused.code, 2);
					assert.include(report(refused.err), "0.0.1");
					const ignored = yield* runCli(schema("validate", "payload.json", "--ignore-version-mismatch"), {
						deps: depsFor(foreignConfig),
						seed,
					});
					// It went on past the mismatch, warned, and then the reference failed to resolve.
					assert.strictEqual(ignored.code, 2);
					assert.isTrue(
						ignored.err.some((line) => line.includes("0.0.1")),
						report(ignored.err),
					);
					assert.include(report(ignored.err), "SchemaResolutionError");
				}),
		);

		it.effect("--format json writes the report to stdout and the human lines to stderr", () =>
			Effect.gen(function* () {
				const { code, stdoutCalls, err } = yield* runCli(schema("validate", "payload.json", "--format", "json"), {
					deps,
					seed: payloadSeed({ $schema: BASIC_ID, name: 42 }),
				});
				assert.strictEqual(code, 1);
				assert.lengthOf(stdoutCalls, 1, "exactly one JSON document on stdout");
				const parsed = JSON.parse(stdoutCalls[0] ?? "") as {
					payload: string;
					schema: string;
					document: string;
					valid: boolean;
					findings: ReadonlyArray<{ path: string; keyword?: string; location?: { line: number } }>;
				};
				assert.isFalse(parsed.valid);
				assert.strictEqual(parsed.payload, PAYLOAD_PATH);
				assert.strictEqual(parsed.schema, BASIC_ID);
				assert.strictEqual(parsed.document, BASIC_PATH);
				assert.lengthOf(parsed.findings, 1);
				assert.strictEqual(parsed.findings[0]?.path, "/name");
				assert.strictEqual(parsed.findings[0]?.keyword, "type");
				assert.strictEqual(parsed.findings[0]?.location?.line, 1);
				assert.isTrue(
					err.some((line) => line.includes("/name")),
					`the human finding lines move to stderr:\n${report(err)}`,
				);
			}),
		);

		it.effect("the instanceValidator seam replaces the engine", () =>
			Effect.gen(function* () {
				const { code, out } = yield* runCli(schema("validate", "payload.json"), {
					deps: depsFor(basicConfig(), {
						instanceValidator: InstanceValidator.layerTest({
							validate: () => Effect.succeed([InstanceFinding.make({ path: "/stubbed", message: "from the double" })]),
						}),
					}),
					seed: payloadSeed({ $schema: BASIC_ID, name: "x" }),
				});
				assert.strictEqual(code, 1);
				assert.isTrue(
					out.some((line) => line.includes("/stubbed") && line.includes("from the double")),
					out.join("\n"),
				);
			}),
		);
	});
});

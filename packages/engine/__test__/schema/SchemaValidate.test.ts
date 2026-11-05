import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { HostedSchema, SchemastoreConfig } from "@effected/schemastore";
import { InstanceFinding, InstanceValidator, StoreDocument, defineConfig } from "@effected/schemastore";
import { Effect, Layer, Path, Result, Schema } from "effect";
import type { SchemaProgress, SchemaRunDeps } from "../../src/schema/SchemaRun.js";
import type { SchemaValidateInput } from "../../src/schema/SchemaValidate.js";
import {
	MissingSchemaRefError,
	PayloadError,
	SchemaResolutionError,
	SchemaValidate,
	ValidateReport,
} from "../../src/schema/SchemaValidate.js";
import { VersionMismatch, VersionMismatchError } from "../../src/schema/VersionCheck.js";

const volume = (seed: MemoryFileSystemSeed = {}) => Layer.merge(Path.layer, MemoryFileSystem.layerWith(seed));

const Config = Schema.Struct({ name: Schema.String });
const emitted = (schema: Schema.Constraint, $id: string): string =>
	Result.getOrThrow(Result.getOrThrow(StoreDocument.fromSchemaResult(schema, { $id })).serializeResult());

const BASIC_ID = "https://example.com/schemas/basic-1.0.json";
const BASIC_PATH = "/repo/schemas/basic-1.0.json";
const CONFIG_PATH = "/repo/schemastore.config.ts";
const PAYLOAD_PATH = "/repo/payload.json";
const LOCAL_DOC = "/repo/local/doc.schema.json";

const basicConfig = (versions: ReadonlyArray<string> = ["1.0"]) =>
	defineConfig({
		name: "test",
		outputDir: "/repo/schemas",
		baseUrl: "https://example.com/schemas",
		schemas: { basic: { schema: Config, layout: "flat", published: true, versions } },
	});

const deps = (config?: SchemastoreConfig, overrides: Partial<SchemaRunDeps> = {}): SchemaRunDeps => ({
	cwd: "/repo",
	...(config !== undefined ? { importModule: () => Promise.resolve({ default: config }) } : {}),
	...overrides,
});

const input = (overrides: Partial<SchemaValidateInput> = {}): SchemaValidateInput => ({
	payload: "payload.json",
	versionMismatch: "fail",
	...overrides,
});

const configSeed = (payload: unknown): MemoryFileSystemSeed => ({
	[CONFIG_PATH]: "",
	[BASIC_PATH]: emitted(Config, BASIC_ID),
	[PAYLOAD_PATH]: `${JSON.stringify(payload)}\n`,
});

// A hand-written document and a raw payload text: the located cases need exact
// control over whitespace, line breaks and BOMs, so they bypass JSON.stringify.
const located = (document: object, payload: string): MemoryFileSystemSeed => ({
	[LOCAL_DOC]: JSON.stringify(document),
	[PAYLOAD_PATH]: payload,
});
const viaFile = input({ schema: "local/doc.schema.json" });

const Rows = {
	type: "object",
	properties: {
		rows: {
			type: "array",
			items: { type: "object", properties: { tags: { type: "array", items: { type: "number" } } }, required: ["tags"] },
		},
	},
};

describe("SchemaValidate.run", () => {
	it.effect("a conforming payload validates against its $schema identity", () =>
		Effect.gen(function* () {
			const report = yield* SchemaValidate.run(input(), deps(basicConfig()));
			assert.isTrue(report.valid);
			assert.strictEqual(report.payload, PAYLOAD_PATH);
			assert.strictEqual(report.$ref, BASIC_ID);
			assert.strictEqual(report.source, BASIC_PATH);
			assert.lengthOf(report.findings, 0);
			assert.isFalse("versionMismatch" in report);
		}).pipe(Effect.provide(volume(configSeed({ $schema: BASIC_ID, name: "x" })))),
	);

	it.effect("a document declaring $schema validates the payload verbatim, self-reference included", () => {
		const SelfReferencing = Schema.Struct({ $schema: Schema.Literal(BASIC_ID), name: Schema.String });
		return Effect.gen(function* () {
			const report = yield* SchemaValidate.run(input(), deps(basicConfig()));
			assert.isTrue(report.valid);
		}).pipe(
			Effect.provide(
				volume({ ...configSeed({ $schema: BASIC_ID, name: "x" }), [BASIC_PATH]: emitted(SelfReferencing, BASIC_ID) }),
			),
		);
	});

	it.effect("a Schema.Class root declaring $schema behind its local $ref validates verbatim", () => {
		class Hosted extends Schema.Class<Hosted>("Hosted")({ $schema: Schema.Literal(BASIC_ID), name: Schema.String }) {}
		return Effect.gen(function* () {
			assert.isTrue((yield* SchemaValidate.run(input(), deps(basicConfig()))).valid);
		}).pipe(
			Effect.provide(
				volume({ ...configSeed({ $schema: BASIC_ID, name: "x" }), [BASIC_PATH]: emitted(Hosted, BASIC_ID) }),
			),
		);
	});

	it.effect("an identifier-annotated struct root declaring $schema validates verbatim", () => {
		const Identified = Schema.Struct({ $schema: Schema.Literal(BASIC_ID), name: Schema.String }).annotate({
			identifier: "Output",
		});
		return Effect.gen(function* () {
			assert.isTrue((yield* SchemaValidate.run(input(), deps(basicConfig()))).valid);
		}).pipe(
			Effect.provide(
				volume({ ...configSeed({ $schema: BASIC_ID, name: "x" }), [BASIC_PATH]: emitted(Identified, BASIC_ID) }),
			),
		);
	});

	it.effect("a rootAnnotations-wrapped shared $ref root declaring $schema validates verbatim", () => {
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
		return Effect.gen(function* () {
			assert.isTrue((yield* SchemaValidate.run(input(), deps(basicConfig()))).valid);
		}).pipe(
			Effect.provide(
				volume({
					...configSeed({ $schema: BASIC_ID, name: "x", children: [] }),
					[BASIC_PATH]: wrapped,
				}),
			),
		);
	});

	it.effect("a closed $ref-rooted document without a declared $schema still strips the pointer", () => {
		const Plain = Schema.Struct({ name: Schema.String }).annotate({ identifier: "Plain" });
		return Effect.gen(function* () {
			assert.isTrue((yield* SchemaValidate.run(input(), deps(basicConfig()))).valid);
		}).pipe(
			Effect.provide(
				volume({ ...configSeed({ $schema: BASIC_ID, name: "x" }), [BASIC_PATH]: emitted(Plain, BASIC_ID) }),
			),
		);
	});

	it.effect("a non-conforming payload is an ordinary result with pointer-and-keyword findings", () =>
		Effect.gen(function* () {
			const report = yield* SchemaValidate.run(input(), deps(basicConfig()));
			assert.isFalse(report.valid);
			assert.lengthOf(report.findings, 1);
			assert.strictEqual(report.findings[0]?.path, "/name");
			assert.strictEqual(report.findings[0]?.keyword, "type");
		}).pipe(Effect.provide(volume(configSeed({ $schema: BASIC_ID, name: 42 })))),
	);

	it.effect("a frozen version's $id resolves to its committed document", () =>
		Effect.gen(function* () {
			const report = yield* SchemaValidate.run(input(), deps(basicConfig(["1.0", "2.0"])));
			assert.isTrue(report.valid);
			assert.strictEqual(report.source, BASIC_PATH);
		}).pipe(Effect.provide(volume(configSeed({ $schema: BASIC_ID, name: "x" })))),
	);

	it.effect("--schema names a file directly and needs no config", () =>
		Effect.gen(function* () {
			// No importModule: reaching for the config would fail the test.
			const report = yield* SchemaValidate.run(viaFile, deps());
			assert.isTrue(report.valid);
			assert.strictEqual(report.source, LOCAL_DOC);
			assert.strictEqual(report.$ref, "local/doc.schema.json");
		}).pipe(Effect.provide(volume(located({ type: "object" }, '{"name":"x"}')))),
	);

	it.effect("a --schema document that is a JSON array, not an object, fails SchemaResolutionError", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(SchemaValidate.run(viaFile, deps()));
			assert.instanceOf(error, SchemaResolutionError);
			assert.include(error.message, "is not a JSON object");
		}).pipe(Effect.provide(volume({ [LOCAL_DOC]: "[{}]", [PAYLOAD_PATH]: "{}" }))),
	);

	it.effect("an unresolvable $schema fails SchemaResolutionError", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(SchemaValidate.run(input(), deps(basicConfig())));
			assert.instanceOf(error, SchemaResolutionError);
			assert.include(error.message, "no schema in the config derives this $id or url");
		}).pipe(Effect.provide(volume(configSeed({ $schema: "https://example.com/schemas/nope.json", name: "x" })))),
	);

	it.effect("a payload naming nothing fails MissingSchemaRefError", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(SchemaValidate.run(input(), deps(basicConfig())));
			assert.instanceOf(error, MissingSchemaRefError);
			assert.include(error.message, "--schema");
		}).pipe(Effect.provide(volume(configSeed({ name: "x" })))),
	);

	it.effect("a malformed payload fails PayloadError", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(SchemaValidate.run(input(), deps(basicConfig())));
			assert.instanceOf(error, PayloadError);
			assert.strictEqual(error.path, PAYLOAD_PATH);
		}).pipe(Effect.provide(volume({ ...configSeed({}), [PAYLOAD_PATH]: "not json\n" }))),
	);

	it.effect("a missing payload fails PayloadError", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(SchemaValidate.run(input(), deps(basicConfig())));
			assert.instanceOf(error, PayloadError);
		}).pipe(Effect.provide(volume({ [CONFIG_PATH]: "" }))),
	);

	it.effect("the instanceValidator seam replaces the engine", () =>
		Effect.gen(function* () {
			const report = yield* SchemaValidate.run(
				input(),
				deps(basicConfig(), {
					instanceValidator: InstanceValidator.layerTest({
						validate: () => Effect.succeed([InstanceFinding.make({ path: "/stubbed", message: "from the double" })]),
					}),
				}),
			);
			assert.isFalse(report.valid);
			assert.strictEqual(report.findings[0]?.message, "from the double");
		}).pipe(Effect.provide(volume(configSeed({ $schema: BASIC_ID, name: "x" })))),
	);

	describe("payload locations", () => {
		it.effect("a wrong type in a nested array points at its line and column", () =>
			Effect.gen(function* () {
				const report = yield* SchemaValidate.run(viaFile, deps());
				const finding = report.findings[0];
				assert.strictEqual(finding?.path, "/rows/0/tags/1");
				assert.deepStrictEqual({ ...finding?.location }, { file: PAYLOAD_PATH, line: 3, column: 19 });
			}).pipe(Effect.provide(volume(located(Rows, '{\n  "rows": [\n    { "tags": [1, "a"] }\n  ]\n}\n')))),
		);

		it.effect("a missing required property points at the nearest existing parent", () =>
			Effect.gen(function* () {
				const report = yield* SchemaValidate.run(viaFile, deps());
				assert.strictEqual(report.findings[0]?.path, "/rows/0");
				assert.deepStrictEqual({ ...report.findings[0]?.location }, { file: PAYLOAD_PATH, line: 3, column: 5 });
			}).pipe(Effect.provide(volume(located(Rows, '{\n  "rows": [\n    {}\n  ]\n}\n')))),
		);

		it.effect("a pointer that does not resolve falls back to the deepest node that does", () =>
			Effect.gen(function* () {
				const report = yield* SchemaValidate.run(
					viaFile,
					deps(undefined, {
						instanceValidator: InstanceValidator.layerTest({
							validate: () =>
								Effect.succeed([
									InstanceFinding.make({ path: "/rows/5/tags", message: "gone" }),
									InstanceFinding.make({ path: "/rows/x", message: "not an index" }),
								]),
						}),
					}),
				);
				// /rows is the array: line 2, column 11.
				assert.deepStrictEqual({ ...report.findings[0]?.location }, { file: PAYLOAD_PATH, line: 2, column: 11 });
				assert.deepStrictEqual({ ...report.findings[1]?.location }, { file: PAYLOAD_PATH, line: 2, column: 11 });
			}).pipe(Effect.provide(volume(located(Rows, '{\n  "rows": [\n    {}\n  ]\n}\n')))),
		);

		it.effect("the root pointer points at line 1", () =>
			Effect.gen(function* () {
				const report = yield* SchemaValidate.run(viaFile, deps());
				assert.strictEqual(report.findings[0]?.path, "");
				assert.deepStrictEqual({ ...report.findings[0]?.location }, { file: PAYLOAD_PATH, line: 1, column: 1 });
			}).pipe(Effect.provide(volume(located({ type: "array" }, '{"a":1}')))),
		);

		it.effect("CRLF payloads count lines correctly", () =>
			Effect.gen(function* () {
				const report = yield* SchemaValidate.run(viaFile, deps());
				assert.deepStrictEqual({ ...report.findings[0]?.location }, { file: PAYLOAD_PATH, line: 3, column: 11 });
			}).pipe(
				Effect.provide(
					volume(
						located({ type: "object", properties: { name: { type: "string" } } }, '{\r\n  "n": 1,\r\n  "name": 5\r\n}'),
					),
				),
			),
		);

		it.effect("a BOM doesn't shift column 1", () =>
			Effect.gen(function* () {
				const root = yield* SchemaValidate.run(viaFile, deps());
				assert.deepStrictEqual({ ...root.findings[0]?.location }, { file: PAYLOAD_PATH, line: 1, column: 1 });
			}).pipe(Effect.provide(volume(located({ type: "object" }, "﻿[]")))),
		);

		it.effect("a BOM payload still validates and locates a nested value", () =>
			Effect.gen(function* () {
				const report = yield* SchemaValidate.run(viaFile, deps());
				assert.deepStrictEqual({ ...report.findings[0]?.location }, { file: PAYLOAD_PATH, line: 1, column: 9 });
			}).pipe(
				Effect.provide(volume(located({ type: "object", properties: { name: { type: "string" } } }, '﻿{"name":5}'))),
			),
		);

		it.effect("non-ASCII text before the value gives the editor's column", () =>
			Effect.gen(function* () {
				const report = yield* SchemaValidate.run(viaFile, deps());
				// The emoji is two UTF-16 units; LineIndex counts units, as editors do.
				assert.deepStrictEqual({ ...report.findings[0]?.location }, { file: PAYLOAD_PATH, line: 1, column: 20 });
			}).pipe(
				Effect.provide(
					volume(located({ type: "object", properties: { name: { type: "string" } } }, '{"é😀": 1, "name": 5}')),
				),
			),
		);

		it.effect("escaped pointer segments ~0 and ~1 resolve", () =>
			Effect.gen(function* () {
				const report = yield* SchemaValidate.run(viaFile, deps());
				assert.deepStrictEqual(
					report.findings.map((finding) => [finding.path, finding.location?.column]),
					[
						["/a~1b", 9],
						["/m~0n", 19],
					],
				);
			}).pipe(
				Effect.provide(
					volume(
						located(
							{ type: "object", properties: { "a/b": { type: "string" }, "m~n": { type: "string" } } },
							'{"a/b": 1, "m~n": 2}',
						),
					),
				),
			),
		);

		it.effect("a payload the tree builder rejects keeps its findings without locations", () =>
			Effect.gen(function* () {
				// Valid JSON the JSONC tree builder refuses: it nests past the depth cap.
				const report = yield* SchemaValidate.run(viaFile, deps());
				assert.isFalse(report.valid);
				assert.isTrue(report.findings.length > 0);
				assert.isTrue(report.findings.every((finding) => !("location" in finding)));
			}).pipe(Effect.provide(volume(located({ type: "string" }, `${"[".repeat(5000)}${"]".repeat(5000)}`)))),
		);
	});

	describe("version mismatch", () => {
		const STAMP = Symbol.for("@effected/schemastore/version");
		const BRAND = Symbol.for("@effected/schemastore/HostedSchema");
		const foreign = (version: string) =>
			Object.defineProperties(
				{ name: "basic", baseUrl: "https://example.com/schemas" },
				{
					[BRAND]: { value: true },
					[STAMP]: { value: version },
				},
			) as HostedSchema;
		const mismatched = () =>
			defineConfig({
				name: "test",
				outputDir: "/repo/schemas",
				schemas: { basic: { schema: Config, hosted: foreign("9.9.9") } },
			});
		const target = mismatched().schemas[0]?.target;
		const TARGET_ID = target?.$id ?? "";
		const seed: MemoryFileSystemSeed = {
			[CONFIG_PATH]: "",
			[target?.path ?? ""]: emitted(Config, TARGET_ID),
			[PAYLOAD_PATH]: '{"name":"x"}',
		};

		it.effect("fail refuses before validating", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(SchemaValidate.run(input({ schema: TARGET_ID }), deps(mismatched())));
				assert.instanceOf(error, VersionMismatchError);
			}).pipe(Effect.provide(volume(seed))),
		);

		it.effect("warn carries the mismatch on the report and on Started", () =>
			Effect.gen(function* () {
				const events: Array<SchemaProgress> = [];
				const report = yield* SchemaValidate.run(
					input({ schema: TARGET_ID, versionMismatch: "warn" }),
					deps(mismatched(), { onProgress: (event) => Effect.sync(() => void events.push(event)) }),
				);
				assert.isTrue(report.valid);
				assert.strictEqual(report.versionMismatch?.found[0]?.version, "9.9.9");
				const started = events.find((event) => event._tag === "Started");
				assert.strictEqual(
					started?._tag === "Started" ? started.versionMismatch?.found[0]?.version : undefined,
					"9.9.9",
				);
			}).pipe(Effect.provide(volume(seed))),
		);

		it.effect("warn then fail leaves the mismatch recoverable from Started", () =>
			Effect.gen(function* () {
				const events: Array<SchemaProgress> = [];
				const error = yield* Effect.flip(
					SchemaValidate.run(
						input({ schema: "https://example.com/schemas/nope.json", versionMismatch: "warn" }),
						deps(mismatched(), { onProgress: (event) => Effect.sync(() => void events.push(event)) }),
					),
				);
				assert.instanceOf(error, SchemaResolutionError);
				const started = events.find((event) => event._tag === "Started");
				assert.strictEqual(
					started?._tag === "Started" ? started.versionMismatch?.found[0]?.version : undefined,
					"9.9.9",
				);
			}).pipe(Effect.provide(volume(seed))),
		);
	});
});

describe("ValidateReport.Json", () => {
	const located = ValidateReport.make({
		payload: PAYLOAD_PATH,
		$ref: BASIC_ID,
		source: BASIC_PATH,
		valid: false,
		findings: [
			{
				path: "/name",
				message: "must be string",
				keyword: "type",
				location: { file: PAYLOAD_PATH, line: 3, column: 11 },
			},
			{ path: "", message: "no location" },
		],
	});

	it("encodes today's document: $ref as schema, source as document, in today's key order", () => {
		const encoded = Schema.encodeSync(ValidateReport.Json)(located);
		assert.strictEqual(
			JSON.stringify(encoded),
			JSON.stringify({
				payload: PAYLOAD_PATH,
				schema: BASIC_ID,
				document: BASIC_PATH,
				valid: false,
				findings: [
					{
						path: "/name",
						message: "must be string",
						keyword: "type",
						location: { file: PAYLOAD_PATH, line: 3, column: 11 },
					},
					{ path: "", message: "no location" },
				],
			}),
		);
	});

	it("a mismatch comes last, and decoding gives back the same report", () => {
		const report = ValidateReport.make({
			...located,
			versionMismatch: VersionMismatch.make({
				tool: "2.0.0",
				found: [{ where: "config", version: "1.0.0" }],
				message: "m",
			}),
		});
		const encoded = Schema.encodeSync(ValidateReport.Json)(report) as Record<string, unknown>;
		assert.strictEqual(Object.keys(encoded).at(-1), "versionMismatch");
		const decoded = Schema.decodeUnknownSync(ValidateReport.Json)(JSON.parse(JSON.stringify(encoded)));
		assert.deepStrictEqual(Schema.encodeSync(ValidateReport)(decoded), Schema.encodeSync(ValidateReport)(report));
	});
});

import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, Layer, Result, Schema } from "effect";
import { SchemaFile, SchemaFileNotFoundError, StoreDocument } from "../../src/index.js";

// The integration boundary: the file service over a real platform (the only
// tests that provide FileSystem / Path).
const TestLayer = SchemaFile.layer.pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));

const Config = Schema.Struct({
	name: Schema.String.annotate({ "x-taplo": { hidden: true } }),
	port: Schema.optionalKey(Schema.Int),
});

const $id = "https://example.com/config.schema.json";

describe("SchemaFile (integration)", () => {
	layer(TestLayer)((it) => {
		it.effect("write → written, identical write → unchanged (and the file is untouched)", () =>
			Effect.gen(function* () {
				const directory = mkdtempSync(join(tmpdir(), "schemastore-int-"));
				try {
					const files = yield* SchemaFile;
					const document = yield* StoreDocument.fromSchema(Config, { $id });
					// The destination's parent does not exist yet — write creates it.
					const target = join(directory, "schemas", "json", "config.schema.json");

					const first = yield* files.write(target, document);
					assert.deepStrictEqual(first, { outcome: "written", change: "created" });
					const bytes = readFileSync(target, "utf8");
					assert.strictEqual(bytes, Result.getOrThrow(document.serializeResult()));
					// The carried annotation reached the committed file.
					assert.include(bytes, '"x-taplo"');

					// Pin an ancient mtime so an accidental rewrite is detectable.
					// Compare against the mtime the filesystem actually stored,
					// not the literal epoch — not every filesystem stores the
					// requested timestamp exactly.
					utimesSync(target, new Date(0), new Date(0));
					const pinnedMtimeMs = statSync(target).mtimeMs;
					const second = yield* files.write(target, document);
					assert.deepStrictEqual(second, { outcome: "unchanged", change: "none" });
					assert.strictEqual(statSync(target).mtimeMs, pinnedMtimeMs);
				} finally {
					rmSync(directory, { recursive: true, force: true });
				}
			}),
		);

		it.effect("a drifted file is rewritten, and read answers the exact committed bytes", () =>
			Effect.gen(function* () {
				const directory = mkdtempSync(join(tmpdir(), "schemastore-int-"));
				try {
					const files = yield* SchemaFile;
					const document = yield* StoreDocument.fromSchema(Config, { $id });
					const target = join(directory, "config.schema.json");
					writeFileSync(target, '{"drifted": true}\n');

					const outcome = yield* files.write(target, document);
					assert.strictEqual(outcome.outcome, "written");

					// The drift-test recipe: read the file back and compare with
					// the canonical serialization of the freshly built document.
					const onDisk = yield* files.read(target);
					assert.strictEqual(onDisk, Result.getOrThrow(document.serializeResult()));
				} finally {
					rmSync(directory, { recursive: true, force: true });
				}
			}),
		);

		it.effect("reading a missing file fails with SchemaFileNotFoundError", () =>
			Effect.gen(function* () {
				const directory = mkdtempSync(join(tmpdir(), "schemastore-int-"));
				try {
					const files = yield* SchemaFile;
					const error = yield* Effect.flip(files.read(join(directory, "nope.schema.json")));
					assert.instanceOf(error, SchemaFileNotFoundError);
				} finally {
					rmSync(directory, { recursive: true, force: true });
				}
			}),
		);
	});
});

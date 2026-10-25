// `MemoryFileSystem.wrapFile`: decorating the `File` an `open` returns. A
// memfs `File` is a class instance (its members live on the prototype), so a
// spread copies none of them; the wrapper forwards every member and lets a
// handler replace one, delegate-by-default like the fault map.

import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Stream } from "effect";
import { MemoryFileSystem } from "../src/index.js";
import { denied } from "./helpers.js";

const encoder = new TextEncoder();

describe("MemoryFileSystem.wrapFile", () => {
	it.effect("an empty override map forwards every member to the wrapped file", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* MemoryFileSystem.makeWith({ "/f.txt": "hello" });
				const file = MemoryFileSystem.wrapFile(yield* fs.open("/f.txt", { flag: "r+" }), {});
				assert.isTrue(FileSystem.isFile(file));
				assert.strictEqual(Number((yield* file.stat).size), 5);
				const read = yield* file.readAlloc(5);
				assert.strictEqual(new TextDecoder().decode(Option.getOrThrow(read)), "hello");
				assert.strictEqual(yield* file.seek(BigInt(0), "start"), BigInt(0));
				yield* file.writeAll(encoder.encode("HE"));
				yield* file.sync;
				yield* file.truncate(4);
				assert.strictEqual(yield* fs.readFileString("/f.txt"), "HEll");
			}),
		),
	);

	it.effect("a handler replaces one member; returning undefined delegates", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* MemoryFileSystem.makeWith({ "/f.txt": "" });
				const file = MemoryFileSystem.wrapFile(yield* fs.open("/f.txt", { flag: "w" }), {
					writeAll: (buffer) => (buffer.length > 3 ? Effect.fail(denied("writeAll", "/f.txt")) : undefined),
				});
				yield* file.writeAll(encoder.encode("ok"));
				const error = yield* Effect.flip(file.writeAll(encoder.encode("too long")));
				assert.strictEqual(error.reason._tag, "PermissionDenied");
				assert.strictEqual(yield* fs.readFileString("/f.txt"), "ok");
			}),
		),
	);

	it.effect("stat and sync take thunk handlers, consulted per execution", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* MemoryFileSystem.makeWith({ "/f.txt": "x" });
				let syncs = 0;
				const file = MemoryFileSystem.wrapFile(yield* fs.open("/f.txt"), {
					sync: () => {
						syncs++;
						return syncs === 1 ? Effect.fail(denied("sync", "/f.txt")) : undefined;
					},
				});
				const sync = file.sync;
				assert.strictEqual(syncs, 0, "reading the member builds nothing");
				yield* Effect.flip(sync);
				yield* sync;
				assert.strictEqual(syncs, 2);
			}),
		),
	);

	it.effect("accepts failTimes, armed per wrapFile call", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* MemoryFileSystem.makeWith({ "/f.txt": "" });
				const file = MemoryFileSystem.wrapFile(yield* fs.open("/f.txt", { flag: "w" }), {
					write: MemoryFileSystem.failTimes(1, denied("write", "/f.txt")),
				});
				yield* Effect.flip(file.write(encoder.encode("a")));
				assert.strictEqual(yield* file.write(encoder.encode("a")), 1);
			}),
		),
	);

	it.effect("decorates every handle `open` returns through an open fault — and so stream and sink", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith(
				{ "/log.txt": "" },
				{
					faults: (base) => ({
						open: (path, options) =>
							Effect.map(base.open(path, options), (file) =>
								MemoryFileSystem.wrapFile(file, {
									writeAll: () => Effect.fail(denied("writeAll", path)),
								}),
							),
					}),
				},
			);
			const error = yield* Effect.flip(Stream.make(encoder.encode("line\n")).pipe(Stream.run(fs.sink("/log.txt"))));
			assert.strictEqual(error.reason._tag, "PermissionDenied");
			assert.strictEqual(yield* fs.readFileString("/log.txt"), "");
		}),
	);

	it.effect("members are intercepted independently: a write handler does not reach writeAll", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* MemoryFileSystem.makeWith({ "/f.txt": "" });
				const file = MemoryFileSystem.wrapFile(yield* fs.open("/f.txt", { flag: "w" }), {
					write: () => Effect.fail(denied("write", "/f.txt")),
				});
				yield* file.writeAll(encoder.encode("all"));
				assert.strictEqual(yield* fs.readFileString("/f.txt"), "all");
			}),
		),
	);

	it("an unknown override key is a wiring bug: RangeError naming it", () => {
		const file = { [FileSystem.FileTypeId]: FileSystem.FileTypeId } as unknown as FileSystem.File;
		assert.throws(() => MemoryFileSystem.wrapFile(file, { writeAl: () => undefined } as never), RangeError, /writeAl/);
	});

	it.effect("wraps any File, not only memfs's", () =>
		Effect.gen(function* () {
			const fake: FileSystem.File = {
				[FileSystem.FileTypeId]: FileSystem.FileTypeId,
				stat: Effect.die("unused"),
				seek: () => Effect.die("unused"),
				sync: Effect.void,
				read: () => Effect.succeed(7),
				readAlloc: () => Effect.succeed(Option.none()),
				truncate: () => Effect.void,
				write: (buffer) => Effect.succeed(buffer.length),
				writeAll: () => Effect.void,
			};
			const file = MemoryFileSystem.wrapFile(fake, {
				readAlloc: () => Effect.succeed(Option.some(new Uint8Array([1]))),
			});
			assert.strictEqual(yield* file.read(new Uint8Array(1)), 7);
			assert.deepStrictEqual(Option.getOrThrow(yield* file.readAlloc(1)), new Uint8Array([1]));
		}),
	);
});

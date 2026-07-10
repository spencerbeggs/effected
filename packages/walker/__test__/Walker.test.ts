import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, FileSystem, Option, Path, PlatformError, Ref } from "effect";
import { Walker } from "../src/Walker.js";

layer(Path.layer)("Walker.ascend", (it) => {
	it.effect("yields each directory from start to the root, nearest first", () =>
		Effect.gen(function* () {
			const dirs = yield* Walker.ascend("/a/b/c");
			assert.deepStrictEqual(dirs, ["/a/b/c", "/a/b", "/a", "/"]);
		}),
	);

	it.effect("terminates at the root fixpoint without exhausting maxDepth", () =>
		Effect.gen(function* () {
			const dirs = yield* Walker.ascend("/a");
			assert.deepStrictEqual(dirs, ["/a", "/"]);
		}),
	);

	it.effect("stops at stopAt, inclusive", () =>
		Effect.gen(function* () {
			const dirs = yield* Walker.ascend("/a/b/c", { stopAt: "/a" });
			assert.deepStrictEqual(dirs, ["/a/b/c", "/a/b", "/a"]);
		}),
	);

	it.effect("truncates a chain longer than maxDepth", () =>
		Effect.gen(function* () {
			const dirs = yield* Walker.ascend("/a/b/c", { maxDepth: 2 });
			assert.deepStrictEqual(dirs, ["/a/b/c", "/a/b"]);
		}),
	);

	// `ascend`'s error channel is `never`, so a Failure exit can only be a defect.
	it.effect("dies when maxDepth is below 1, rather than returning an empty chain", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(Walker.ascend("/a", { maxDepth: 0 }));
			assert.strictEqual(exit._tag, "Failure");
		}),
	);

	it.effect("dies when maxDepth is NaN, rather than returning an empty chain", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(Walker.ascend("/a", { maxDepth: Number.NaN }));
			assert.strictEqual(exit._tag, "Failure");
		}),
	);

	it.effect("dies when maxDepth is not an integer", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(Walker.ascend("/a", { maxDepth: 2.5 }));
			assert.strictEqual(exit._tag, "Failure");
		}),
	);
});

describe("Walker.firstMatch", () => {
	it.effect("returns the first candidate whose predicate reports true", () =>
		Effect.gen(function* () {
			const found = yield* Walker.firstMatch(["a", "b", "c"], (c) => Effect.succeed(c === "b"));
			assert.deepStrictEqual(found, Option.some("b"));
		}),
	);

	it.effect("returns none when nothing matches", () =>
		Effect.gen(function* () {
			const found = yield* Walker.firstMatch(["a", "b"], () => Effect.succeed(false));
			assert.deepStrictEqual(found, Option.none());
		}),
	);

	it.effect("returns none for an empty candidate list", () =>
		Effect.gen(function* () {
			const found = yield* Walker.firstMatch([], () => Effect.succeed(true));
			assert.deepStrictEqual(found, Option.none());
		}),
	);

	// THE regression test. A failing probe must not abort the scan, or a
	// permission error deep in the tree hides a valid match above it.
	it.effect("absorbs a failing predicate per candidate and keeps scanning", () =>
		Effect.gen(function* () {
			const probed = yield* Ref.make<ReadonlyArray<string>>([]);
			const predicate = (c: string) =>
				Effect.gen(function* () {
					yield* Ref.update(probed, (seen) => [...seen, c]);
					if (c === "b") return yield* Effect.fail("EACCES");
					return c === "c";
				});

			const found = yield* Walker.firstMatch(["a", "b", "c"], predicate);

			assert.deepStrictEqual(found, Option.some("c"));
			assert.deepStrictEqual(yield* Ref.get(probed), ["a", "b", "c"]);
		}),
	);

	// Pins the short-circuit. If `firstMatch` ever probes exhaustively and then
	// selects the first hit, this is the only test that notices: "c" must never
	// be probed once "b" matches.
	it.effect("short-circuits at the first match and probes no further", () =>
		Effect.gen(function* () {
			const probed = yield* Ref.make<ReadonlyArray<string>>([]);
			const predicate = (c: string) =>
				Effect.gen(function* () {
					yield* Ref.update(probed, (seen) => [...seen, c]);
					return c === "b";
				});

			const found = yield* Walker.firstMatch(["a", "b", "c"], predicate);

			assert.deepStrictEqual(found, Option.some("b"));
			assert.deepStrictEqual(yield* Ref.get(probed), ["a", "b"]);
		}),
	);

	// No other test's winning match is the FIRST candidate, so an implementation
	// that drops an index-0 match passes all of them. This is the only test that
	// probes the nearest directory actually winning — the most ordinary case.
	it.effect("matches the very first candidate", () =>
		Effect.gen(function* () {
			const probed = yield* Ref.make<ReadonlyArray<string>>([]);
			const predicate = (c: string) =>
				Effect.gen(function* () {
					yield* Ref.update(probed, (seen) => [...seen, c]);
					return c === "a";
				});

			const found = yield* Walker.firstMatch(["a", "b"], predicate);

			assert.deepStrictEqual(found, Option.some("a"));
			assert.deepStrictEqual(yield* Ref.get(probed), ["a"]);
		}),
	);

	// The catch-not-catchCause boundary. A predicate that dies is programmer
	// error and must not be reinterpreted as "this candidate didn't match".
	// `firstMatch`'s error channel is `never`, so a Failure exit can only be a defect.
	it.effect("propagates a defect rather than absorbing it", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Walker.firstMatch(["a", "b"], (c) => (c === "b" ? Effect.die(new Error("boom")) : Effect.succeed(false))),
			);
			assert.strictEqual(exit._tag, "Failure");
		}),
	);
});

/** A FileSystem whose `exists` consults a fixed set. Core-only: no platform package. */
const FsWith = (present: ReadonlyArray<string>) =>
	FileSystem.layerNoop({
		exists: (path: string) => Effect.succeed(present.includes(path)),
	});

/** A FileSystem whose `exists` denies permission on one path and consults a set for the rest. */
const FsDenying = (denied: string, present: ReadonlyArray<string>) =>
	FileSystem.layerNoop({
		exists: (path: string) =>
			path === denied
				? Effect.fail(
						PlatformError.systemError({
							_tag: "PermissionDenied",
							module: "FileSystem",
							method: "exists",
							pathOrDescriptor: path,
						}),
					)
				: Effect.succeed(present.includes(path)),
	});

layer(FsWith(["/a/b/.apprc", "/a/.apprc"]))("findUpward, config in both directories", (it) => {
	it.effect("prefers the nearer directory", () =>
		Effect.gen(function* () {
			const found = yield* Walker.findUpward(["/a/b", "/a"], (dir) => [`${dir}/.apprc`]);
			assert.deepStrictEqual(found, Option.some("/a/b/.apprc"));
		}),
	);
});

layer(FsWith(["/a/.apprc"]))("findUpward, config only in the further directory", (it) => {
	it.effect("falls through to the further directory", () =>
		Effect.gen(function* () {
			const found = yield* Walker.findUpward(["/a/b", "/a"], (dir) => [`${dir}/.apprc`]);
			assert.deepStrictEqual(found, Option.some("/a/.apprc"));
		}),
	);
});

layer(FsWith(["/a/second.json"]))("findUpward, only the second candidate exists", (it) => {
	it.effect("honours candidate order within a single directory", () =>
		Effect.gen(function* () {
			const found = yield* Walker.findUpward(["/a"], (dir) => [`${dir}/first.json`, `${dir}/second.json`]);
			assert.deepStrictEqual(found, Option.some("/a/second.json"));
		}),
	);
});

layer(FsWith([]))("findUpward, empty filesystem", (it) => {
	it.effect("returns none when no candidate exists", () =>
		Effect.gen(function* () {
			const found = yield* Walker.findUpward(["/a/b", "/a"], (dir) => [`${dir}/.apprc`]);
			assert.deepStrictEqual(found, Option.none());
		}),
	);
});

// Directory-major, not candidate-major: every candidate in the nearest directory
// is exhausted before ascending. No other test has BOTH several directories AND
// several candidates per directory, so an interleaving implementation passes all
// of them while letting a distant ancestor's `.apprc` beat a nearer
// `config/.apprc`. That is exactly the shape config-file's `subpaths` option uses.
layer(FsWith(["/a/b/config/.apprc", "/a/.apprc"]))("findUpward, near subpath vs far root file", (it) => {
	it.effect("exhausts the nearer directory's candidates before ascending", () =>
		Effect.gen(function* () {
			const found = yield* Walker.findUpward(["/a/b", "/a"], (dir) => [`${dir}/.apprc`, `${dir}/config/.apprc`]);
			assert.deepStrictEqual(found, Option.some("/a/b/config/.apprc"));
		}),
	);
});

// Absorption through findUpward's OWN seam. Every other fs fixture succeeds, so a
// findUpward that lets one failing `exists` abort the whole walk passes all of them.
// This is the concrete failure config-file's resolvers depend on not happening: an
// unreadable directory must not hide a config above it.
layer(FsDenying("/a/b/.apprc", ["/a/.apprc"]))("findUpward, unreadable nearer candidate", (it) => {
	it.effect("absorbs a denied probe and keeps ascending", () =>
		Effect.gen(function* () {
			const found = yield* Walker.findUpward(["/a/b", "/a"], (dir) => [`${dir}/.apprc`]);
			assert.deepStrictEqual(found, Option.some("/a/.apprc"));
		}),
	);
});

describe("Walker.findRoot", () => {
	it.effect("returns the nearest directory the marker predicate accepts", () =>
		Effect.gen(function* () {
			const found = yield* Walker.findRoot(["/a/b/c", "/a/b", "/a"], (dir) => Effect.succeed(dir === "/a/b"));
			assert.deepStrictEqual(found, Option.some("/a/b"));
		}),
	);

	// The concrete failure the per-probe absorption rule exists to prevent.
	it.effect("does not let an unreadable ancestor hide a valid root above it", () =>
		Effect.gen(function* () {
			const isRoot = (dir: string) => (dir === "/a/b" ? Effect.fail("EACCES" as const) : Effect.succeed(dir === "/a"));
			const found = yield* Walker.findRoot(["/a/b/c", "/a/b", "/a", "/"], isRoot);
			assert.deepStrictEqual(found, Option.some("/a"));
		}),
	);

	it.effect("returns none when no directory is a root", () =>
		Effect.gen(function* () {
			const found = yield* Walker.findRoot(["/a/b", "/a"], () => Effect.succeed(false));
			assert.deepStrictEqual(found, Option.none());
		}),
	);

	// No other test's winning directory is the FIRST candidate among several
	// accepting directories, so an implementation that returns the LAST match
	// instead of the first passes all of them. This is the only test that pins
	// "first wins" when more than one directory accepts.
	it.effect("prefers the nearest directory when multiple directories accept", () =>
		Effect.gen(function* () {
			const found = yield* Walker.findRoot(["/a/b", "/a"], () => Effect.succeed(true));
			assert.deepStrictEqual(found, Option.some("/a/b"));
		}),
	);

	// Short-circuit through findRoot's OWN seam. The other findRoot tests assert only
	// the returned Option, so a full linear scan that evaluates isRoot on every
	// directory passes all of them. A marker predicate can be expensive — isWorkspaceRoot
	// reads and parses package.json — so ancestors above the root must never be probed.
	it.effect("stops probing at the first accepting directory", () =>
		Effect.gen(function* () {
			const probed = yield* Ref.make<ReadonlyArray<string>>([]);
			const isRoot = (dir: string) =>
				Effect.gen(function* () {
					yield* Ref.update(probed, (seen) => [...seen, dir]);
					return dir === "/a/b";
				});

			const found = yield* Walker.findRoot(["/a/b/c", "/a/b", "/a"], isRoot);

			assert.deepStrictEqual(found, Option.some("/a/b"));
			assert.deepStrictEqual(yield* Ref.get(probed), ["/a/b/c", "/a/b"]);
		}),
	);
});

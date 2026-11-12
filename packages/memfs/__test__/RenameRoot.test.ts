// rename involving the root (#1339), on memfs alone. Linux `renameat2`
// resolves both parents, then checks EXDEV, then refuses a path with no
// ordinary leaf — the root, `.` or `..` — with EBUSY, before it looks the
// source up. A real-disk run of these shapes answers EXDEV whenever the temp
// directory is its own mount (a tmpfs `/tmp`), so they cannot ride the
// differential ErrnoParityContract, which pins the mount-independent ones.
// memfs is one mount: it answers what Linux answers on a shared mount. Probed
// on node 26 in a Linux container (EBUSY; EXDEV with `--tmpfs`); macOS answers
// EISDIR, or EINVAL for a directory renamed onto the root.

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { MemoryFileSystem } from "../src/index.js";

const busy = (error: PlatformError, path: string) => {
	assert.strictEqual(error.reason._tag, "Busy");
	assert.strictEqual(error.reason.method, "rename");
	assert.strictEqual((error.reason.cause as { readonly code?: unknown } | undefined)?.code, "EBUSY");
	if (error.reason._tag !== "BadArgument") assert.strictEqual(error.reason.pathOrDescriptor, path);
};

describe("rename involving the root", () => {
	const seeded = MemoryFileSystem.makeWith({ "/file": "x", "/dir": MemoryFileSystem.directory() });

	it.effect("renaming the root is EBUSY, whatever the destination", () =>
		Effect.gen(function* () {
			const fs = yield* seeded;
			busy(yield* Effect.flip(fs.rename("/", "/moved")), "/");
			busy(yield* Effect.flip(fs.rename("//", "/dir/moved")), "//");
		}),
	);

	it.effect("renaming onto the root is EBUSY, for a file, a directory, or nothing at all", () =>
		Effect.gen(function* () {
			const fs = yield* seeded;
			busy(yield* Effect.flip(fs.rename("/file", "/")), "/");
			busy(yield* Effect.flip(fs.rename("/dir", "/")), "/");
			busy(yield* Effect.flip(fs.rename("/missing", "/")), "/");
			// Nothing moved.
			assert.strictEqual(yield* fs.readFileString("/file"), "x");
			assert.isTrue(yield* fs.exists("/dir"));
		}),
	);

	it.effect("a source parent that does not resolve fails before the root is refused", () =>
		Effect.gen(function* () {
			const fs = yield* seeded;
			const error = yield* Effect.flip(fs.rename("/missing/x", "/"));
			assert.strictEqual(error.reason._tag, "NotFound");
		}),
	);
});

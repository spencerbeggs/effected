import * as nodePath from "node:path";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, PlatformError } from "effect";
import { TsconfigExtendsError, TsconfigLoader } from "../src/TsconfigLoader.js";
import type { SyncFileSystem, TsconfigLoaderSyncOptions } from "../src/TsconfigLoaderSync.js";
import { TsconfigLoaderSync } from "../src/TsconfigLoaderSync.js";
import { fixtureLayer } from "./fixtures.js";

/** Build a fixture tree from `[absolutePath, contents]` pairs (forward-slash keys). */
const tree = (...entries: ReadonlyArray<readonly [string, string]>): ReadonlyMap<string, string> => new Map(entries);

/**
 * An in-memory `SyncFileSystem` over a forward-slash-keyed map. Lookups
 * normalize separators, exactly as a real filesystem accepts either separator
 * on Windows — which is what lets the same builder back both the posix and
 * the win32 suites. `readFile` throws on a miss (the consumer contract).
 */
const syncFs = (files: ReadonlyMap<string, string>): SyncFileSystem => {
	const normalize = (p: string): string => p.replace(/\\/g, "/");
	return {
		exists: (p) => files.has(normalize(p)),
		readFile: (p) => {
			const hit = files.get(normalize(p));
			if (hit === undefined) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
			return hit;
		},
	};
};

const posixOptions = (files: ReadonlyMap<string, string>): TsconfigLoaderSyncOptions => ({
	fileSystem: syncFs(files),
	path: nodePath.posix,
});

/** Run `fn`, returning what it throws; fails the test if it returns instead. */
const capture = (fn: () => unknown): unknown => {
	let thrown: unknown;
	let threw = false;
	try {
		fn();
	} catch (error) {
		thrown = error;
		threw = true;
	}
	assert.isTrue(threw, "expected the call to throw");
	return thrown;
};

// ---------------------------------------------------------------------------
// The shared extends-chain fixture: derived wins over base per key.
// ---------------------------------------------------------------------------

const CHAIN_TREE = tree(
	["/proj/tsconfig.json", `{ "extends": "./base.json", "compilerOptions": { "strict": true, "target": "es2024" } }`],
	["/proj/base.json", `{ "compilerOptions": { "target": "es2015", "module": "esnext" } }`],
);

describe("TsconfigLoaderSync.load", () => {
	it("reads and decodes one config without touching extends", () => {
		const doc = TsconfigLoaderSync.load("/proj/tsconfig.json", posixOptions(CHAIN_TREE));
		assert.strictEqual(doc.extends, "./base.json");
		assert.deepStrictEqual(doc.compilerOptions?.strict, true);
	});
});

describe("TsconfigLoaderSync.resolve", () => {
	it("resolves a single config with no extends", () => {
		const files = tree(["/proj/tsconfig.json", `{ "compilerOptions": { "strict": true } }`]);
		const resolved = TsconfigLoaderSync.resolve("/proj/tsconfig.json", posixOptions(files));
		assert.strictEqual(resolved.configPath, "/proj/tsconfig.json");
		assert.deepStrictEqual(resolved.extendedPaths, ["/proj/tsconfig.json"]);
		assert.strictEqual(resolved.compilerOptions.strict, true);
	});

	it("folds an extends chain derived-wins", () => {
		const resolved = TsconfigLoaderSync.resolve("/proj/tsconfig.json", posixOptions(CHAIN_TREE));
		assert.deepStrictEqual(resolved.extendedPaths, ["/proj/base.json", "/proj/tsconfig.json"]);
		// Derived wins on the shared key; the base-only key survives.
		assert.strictEqual(resolved.compilerOptions.target, "es2024");
		assert.strictEqual(resolved.compilerOptions.module, "esnext");
		assert.strictEqual(resolved.compilerOptions.strict, true);
	});

	it("decodes JSONC input (comments and trailing commas)", () => {
		const files = tree([
			"/proj/tsconfig.json",
			`{
				// the one live option
				"compilerOptions": {
					"strict": true, /* trailing comma below */
				},
			}`,
		]);
		const resolved = TsconfigLoaderSync.resolve("/proj/tsconfig.json", posixOptions(files));
		assert.strictEqual(resolved.compilerOptions.strict, true);
	});

	it("throws the wrapped PlatformError for a missing file", () => {
		const thrown = capture(() => TsconfigLoaderSync.resolve("/proj/absent.json", posixOptions(tree())));
		assert.instanceOf(thrown, PlatformError.PlatformError);
		const error = thrown as PlatformError.PlatformError;
		assert.strictEqual(error.reason._tag, "Unknown");
		assert.strictEqual(error.reason.module, "FileSystem");
		assert.strictEqual(error.reason.method, "readFileString");
	});

	it("throws the typed TsconfigExtendsError on a cycle", () => {
		const files = tree(["/proj/a.json", `{ "extends": "./b.json" }`], ["/proj/b.json", `{ "extends": "./a.json" }`]);
		const thrown = capture(() => TsconfigLoaderSync.resolve("/proj/a.json", posixOptions(files)));
		assert.instanceOf(thrown, TsconfigExtendsError);
		assert.strictEqual((thrown as TsconfigExtendsError).reason, "cycle");
	});
});

describe("TsconfigLoaderSync.compilerOptions", () => {
	it("projects resolve().compilerOptions", () => {
		const options = posixOptions(CHAIN_TREE);
		const projected = TsconfigLoaderSync.compilerOptions("/proj/tsconfig.json", options);
		assert.deepStrictEqual(projected, TsconfigLoaderSync.resolve("/proj/tsconfig.json", options).compilerOptions);
		assert.strictEqual(projected.target, "es2024");
	});
});

// ---------------------------------------------------------------------------
// Async/sync parity: the same fixture through both pipelines.
// ---------------------------------------------------------------------------

layer(fixtureLayer(CHAIN_TREE))("TsconfigLoaderSync parity with TsconfigLoader", (it) => {
	it.effect("resolve returns the exact async result on the same fixture", () =>
		Effect.gen(function* () {
			const viaAsync = yield* TsconfigLoader.resolve("/proj/tsconfig.json");
			const viaSync = TsconfigLoaderSync.resolve("/proj/tsconfig.json", posixOptions(CHAIN_TREE));
			assert.deepStrictEqual(viaSync, viaAsync);
		}),
	);

	it.effect("TsconfigLoader.compilerOptions projects the resolved options", () =>
		Effect.gen(function* () {
			const resolved = yield* TsconfigLoader.resolve("/proj/tsconfig.json");
			const projected = yield* TsconfigLoader.compilerOptions("/proj/tsconfig.json");
			assert.deepStrictEqual(projected, resolved.compilerOptions);
			assert.strictEqual(projected.target, "es2024");
		}),
	);
});

// ---------------------------------------------------------------------------
// The consumer's path implementation is respected end to end: a win32-
// flavored SyncPath (drive-letter roots, backslash output) drives the whole
// resolution. Under the posix implementation these inputs would resolve
// against the test process cwd instead of the drive root.
// ---------------------------------------------------------------------------

describe("TsconfigLoaderSync with a win32 SyncPath", () => {
	const files = tree(
		["C:/proj/tsconfig.json", `{ "extends": ".\\\\base.json", "compilerOptions": { "strict": true } }`],
		["C:/proj/base.json", `{ "compilerOptions": { "target": "es2022" } }`],
	);
	const options: TsconfigLoaderSyncOptions = { fileSystem: syncFs(files), path: nodePath.win32 };

	it("resolves a backslash extends chain under drive-letter roots", () => {
		const resolved = TsconfigLoaderSync.resolve("C:\\proj\\tsconfig.json", options);
		// The loader's documented normalize-to-forward-slash policy, applied to
		// paths the win32 implementation produced: drive-letter roots survive,
		// which the posix implementation could never have yielded.
		assert.strictEqual(resolved.configPath, "C:/proj/tsconfig.json");
		assert.deepStrictEqual(resolved.extendedPaths, ["C:/proj/base.json", "C:/proj/tsconfig.json"]);
		assert.strictEqual(resolved.compilerOptions.strict, true);
		assert.strictEqual(resolved.compilerOptions.target, "es2022");
	});

	it("treats a drive-letter path as absolute only under the supplied implementation", () => {
		// The premise the suite rests on, pinned: the two implementations
		// genuinely disagree about these inputs.
		assert.isTrue(nodePath.win32.isAbsolute("C:\\proj\\tsconfig.json"));
		assert.isFalse(nodePath.posix.isAbsolute("C:\\proj\\tsconfig.json"));
	});
});

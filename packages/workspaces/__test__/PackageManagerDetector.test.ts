import { assert, describe, layer } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { PackageManagerDetectionError, PackageManagerDetector } from "../src/index.js";
import type { Tree } from "./fixtures.js";
import { platform } from "./fixtures.js";

const detectorOver = (tree: Tree) => PackageManagerDetector.layer.pipe(Layer.provideMerge(platform(tree)));

const corepack = (spec: string) => JSON.stringify({ name: "root", version: "0.0.0", packageManager: spec });

describe("PackageManagerDetector — pnpm", () => {
	layer(
		detectorOver({
			"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
			"/repo/package.json": corepack("pnpm@10.33.0+sha512.abc"),
		}),
	)((it) => {
		it.effect("a pnpm-workspace.yaml is sufficient, and the corepack version is reported", () =>
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				const detected = yield* detector.detect("/repo");
				assert.strictEqual(detected.name, "pnpm");
				assert.deepStrictEqual(detected.version, Option.some("10.33.0"));
				assert.strictEqual(detected.runtime, "node");
			}),
		);
	});
});

describe("PackageManagerDetector — pnpm with no corepack field", () => {
	layer(
		detectorOver({
			"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
			"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0" }),
		}),
	)((it) => {
		it.effect("detects pnpm with no version", () =>
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				const detected = yield* detector.detect("/repo");
				assert.strictEqual(detected.name, "pnpm");
				assert.isTrue(Option.isNone(detected.version));
			}),
		);
	});
});

describe("PackageManagerDetector — pnpm wins over a stray lockfile", () => {
	layer(
		detectorOver({
			"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
			"/repo/yarn.lock": "",
			"/repo/package.json": corepack("yarn@4.5.0"),
		}),
	)((it) => {
		it.effect("the priority chain puts pnpm first even when yarn's markers are present", () =>
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				const detected = yield* detector.detect("/repo");
				assert.strictEqual(detected.name, "pnpm");
				// The corepack field names YARN, so no pnpm version can be attributed.
				assert.isTrue(Option.isNone(detected.version));
			}),
		);
	});
});

describe("PackageManagerDetector — bun", () => {
	layer(detectorOver({ "/repo/bun.lock": "", "/repo/package.json": corepack("bun@1.2.0") }))((it) => {
		it.effect("a bun lockfile plus a bun corepack field means bun, on the bun runtime", () =>
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				const detected = yield* detector.detect("/repo");
				assert.strictEqual(detected.name, "bun");
				assert.strictEqual(detected.runtime, "bun");
				assert.deepStrictEqual(detected.version, Option.some("1.2.0"));
			}),
		);
	});
});

describe("PackageManagerDetector — a bun lockfile WITHOUT the corepack field", () => {
	layer(
		detectorOver({
			"/repo/bun.lock": "",
			"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0", workspaces: ["packages/*"] }),
		}),
	)((it) => {
		it.effect("falls through to npm — the conjunction is deliberate", () =>
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				// A stray lockfile is common; only the corepack field disambiguates.
				const detected = yield* detector.detect("/repo");
				assert.strictEqual(detected.name, "npm");
			}),
		);
	});
});

describe("PackageManagerDetector — yarn", () => {
	layer(detectorOver({ "/repo/yarn.lock": "", "/repo/package.json": corepack("yarn@4.5.0") }))((it) => {
		it.effect("a yarn lockfile plus a yarn corepack field means yarn", () =>
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				const detected = yield* detector.detect("/repo");
				assert.strictEqual(detected.name, "yarn");
				assert.deepStrictEqual(detected.version, Option.some("4.5.0"));
			}),
		);
	});
});

describe("PackageManagerDetector — npm", () => {
	layer(
		detectorOver({
			"/repo/package.json": JSON.stringify({
				name: "root",
				version: "0.0.0",
				workspaces: ["packages/*"],
				packageManager: "npm@11.0.0",
			}),
		}),
	)((it) => {
		it.effect("a workspaces field alone is the npm fallback", () =>
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				const detected = yield* detector.detect("/repo");
				assert.strictEqual(detected.name, "npm");
				assert.deepStrictEqual(detected.version, Option.some("11.0.0"));
			}),
		);
	});
});

describe("PackageManagerDetector — nothing to go on", () => {
	layer(detectorOver({ "/repo/package.json": JSON.stringify({ name: "solo", version: "1.0.0" }) }))((it) => {
		it.effect("fails typed, listing the markers it probed", () =>
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				const error = yield* Effect.flip(detector.detect("/repo"));
				assert.instanceOf(error, PackageManagerDetectionError);
				assert.strictEqual(error.root, "/repo");
				assert.include(error.checked, "pnpm-workspace.yaml");
				assert.include(error.checked, "yarn.lock");
			}),
		);
	});
});

describe("PackageManagerDetector — a malformed root package.json", () => {
	layer(detectorOver({ "/repo/package.json": "{ not json", "/repo/pnpm-workspace.yaml": "packages: []\n" }))((it) => {
		it.effect("an unparseable manifest degrades to no corepack version, never a defect", () =>
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				const result = yield* Effect.result(detector.detect("/repo"));
				assert.strictEqual(result._tag, "Success");
				const detected = yield* detector.detect("/repo");
				assert.strictEqual(detected.name, "pnpm");
				assert.isTrue(Option.isNone(detected.version));
			}),
		);
	});
});

describe("PackageManagerDetector — a malformed corepack field", () => {
	layer(
		detectorOver({
			"/repo/pnpm-workspace.yaml": "packages: []\n",
			"/repo/package.json": JSON.stringify({ name: "root", version: "0.0.0", packageManager: "pnpm" }),
		}),
	)((it) => {
		it.effect("an unparseable packageManager spec is simply no version", () =>
			Effect.gen(function* () {
				const detector = yield* PackageManagerDetector;
				const detected = yield* detector.detect("/repo");
				assert.strictEqual(detected.name, "pnpm");
				assert.isTrue(Option.isNone(detected.version));
			}),
		);
	});
});

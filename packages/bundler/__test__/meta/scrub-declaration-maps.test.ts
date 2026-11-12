// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/scrub-declaration-maps.test.ts on 2026-11-06
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { decode, encode } from "@jridgewell/sourcemap-codec";
import { Effect } from "effect";
import { scrubDeclarationMapsUnder, scrubSourcelessMappings } from "../../src/meta/scrub-declaration-maps.js";

const dir = "/ws/pkg/dist";

/** A map whose first line carries a generated-only segment (the rolldown 1.2.15 shape behind #817). */
function mapContent(withSourceless: boolean): string {
	const lines = [
		withSourceless
			? [[0] as [number], [8, 0, 0, 0] as [number, number, number, number]]
			: [[8, 0, 0, 0] as [number, number, number, number]],
		[[0, 0, 1, 0] as [number, number, number, number]],
	];
	return JSON.stringify({
		version: 3,
		file: "index.d.ts",
		names: [],
		sources: ["../src/index.ts"],
		mappings: encode(lines),
	});
}

const volume = (seed: MemoryFileSystemSeed) => MemoryFileSystem.makeSync(seed);

describe("scrubSourcelessMappings", () => {
	it.effect("removes generated-only segments and keeps every sourced one", () => {
		const map = join(dir, "index.d.ts.map");
		const handle = volume({ [map]: mapContent(true) });
		return Effect.gen(function* () {
			assert.strictEqual(yield* scrubSourcelessMappings(map), 1);
			const after = JSON.parse(handle.volume.text(map) ?? "") as { mappings: string; sources: string[] };
			assert.deepStrictEqual(decode(after.mappings), [[[8, 0, 0, 0]], [[0, 0, 1, 0]]]);
			assert.deepStrictEqual(after.sources, ["../src/index.ts"]);
		}).pipe(Effect.provide(handle.layer));
	});

	it.effect("leaves a clean map untouched (no rewrite, zero removed)", () => {
		const map = join(dir, "index.d.ts.map");
		const handle = volume({ [map]: mapContent(false) });
		return Effect.gen(function* () {
			const before = handle.volume.text(map);
			assert.strictEqual(yield* scrubSourcelessMappings(map), 0);
			assert.strictEqual(handle.volume.text(map), before);
		}).pipe(Effect.provide(handle.layer));
	});

	it.effect("walks a declarations tree and totals the removals; a missing dir is 0", () => {
		const handle = volume({
			[join(dir, "a.d.ts.map")]: mapContent(true),
			[join(dir, "a.d.ts")]: "export {};\n",
			[join(dir, "lib", "b.d.cts.map")]: mapContent(true),
			[join(dir, "lib", "c.d.ts.map")]: mapContent(false),
		});
		return Effect.gen(function* () {
			assert.strictEqual(yield* scrubDeclarationMapsUnder(dir), 2);
			assert.strictEqual(yield* scrubDeclarationMapsUnder(join(dir, "does-not-exist")), 0);
		}).pipe(Effect.provide(handle.layer));
	});

	it.effect("reaches .d.mts maps, dot-directories and symlinked directories", () => {
		const outside = "/ws/elsewhere";
		const handle = volume({
			[join(dir, ".hidden", "a.d.mts.map")]: mapContent(true),
			[join(outside, "b.d.ts.map")]: mapContent(true),
			[join(dir, "linked")]: MemoryFileSystem.symlink(outside),
		});
		return Effect.gen(function* () {
			assert.strictEqual(yield* scrubDeclarationMapsUnder(dir), 2);
		}).pipe(Effect.provide(handle.layer));
	});

	// The volume resolves a relative path against its own root, not the process cwd, so this case alone runs on the
	// host disk, where `Path.resolve` and the reads agree on the process cwd.
	it.effect("accepts a directory relative to the process cwd", () =>
		Effect.gen(function* () {
			const dir = mkdtempSync(join(tmpdir(), "scrub-rel-"));
			mkdirSync(join(dir, "dts"));
			writeFileSync(join(dir, "dts", "a.d.ts.map"), mapContent(true));
			const prevCwd = process.cwd();
			process.chdir(dir);
			const removed = yield* scrubDeclarationMapsUnder("dts").pipe(
				Effect.provide(NodeServices.layer),
				Effect.ensuring(Effect.sync(() => process.chdir(prevCwd))),
			);
			assert.strictEqual(removed, 1);
		}),
	);
});

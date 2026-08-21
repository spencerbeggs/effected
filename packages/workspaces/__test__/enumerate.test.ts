import { assert, describe, layer } from "@effect/vitest";
import { GlobSet } from "@effected/glob";
import { Effect, FileSystem } from "effect";
import { enumerate } from "../src/internal/enumerate.js";
import { platform } from "./fixtures.js";

const literals = Array.from({ length: 24 }, (_, index) => `packages/pkg-${index}`);

const tree = literals.reduce<Record<string, string>>(
	(acc, literal, index) => {
		acc[`/repo/${literal}/package.json`] = JSON.stringify({ name: `@x/pkg-${index}`, version: "1.0.0" });
		return acc;
	},
	{ "/repo/package.json": JSON.stringify({ name: "root", version: "1.0.0" }) },
);

describe("enumerate — literal pattern probes", () => {
	layer(platform(tree))((it) => {
		it.effect("checks literal package candidates with overlapping exists probes", () =>
			Effect.gen(function* () {
				const base = yield* FileSystem.FileSystem;
				let inFlight = 0;
				let maxInFlight = 0;
				const instrumented = Object.assign(Object.create(base), {
					exists: (path: string) =>
						Effect.gen(function* () {
							inFlight += 1;
							maxInFlight = Math.max(maxInFlight, inFlight);
							yield* Effect.yieldNow;
							const exists = yield* base.exists(path);
							inFlight -= 1;
							return exists;
						}),
				}) as FileSystem.FileSystem;

				const globs = yield* GlobSet.compile(literals);
				const directories = yield* enumerate("/repo", globs).pipe(
					Effect.provideService(FileSystem.FileSystem, instrumented),
				);

				assert.deepStrictEqual(
					directories.map((directory) => directory.relativePath),
					[...literals].sort(),
				);
				assert.isAbove(maxInFlight, 1, "expected literal package checks to overlap");
			}),
		);
	});
});

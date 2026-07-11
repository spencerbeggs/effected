import { assert, describe, it } from "@effect/vitest";
import { InvalidRangeError } from "@effected/semver";
import { DateTime, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { FreshnessError, NoMatchingVersionError, NodeResolver, UnresolvableDefaultError } from "../src/index.js";

/**
 * A date inside the bundled snapshot's coverage, so phase filtering has real
 * lifecycle data to work against without reaching the network.
 */
const NOW = DateTime.makeUnsafe("2026-01-15");

const resolve = (options?: Parameters<NodeResolver["Service"]["resolve"]>[0]) =>
	Effect.gen(function* () {
		const resolver = yield* NodeResolver;
		return yield* resolver.resolve(options);
	}).pipe(Effect.provide(NodeResolver.layerOffline));

/** A `fetch` that always fails, to drive the auto strategy onto its fallback. */
const deadNetwork = Layer.provide(
	FetchHttpClient.layer,
	Layer.succeed(FetchHttpClient.Fetch)(async () => {
		throw new Error("network is down");
	}),
);

describe("NodeResolver", () => {
	it.effect("resolves from the bundled snapshot and says so", () =>
		Effect.gen(function* () {
			const result = yield* resolve({ range: ">=20", date: NOW });
			assert.strictEqual(result.source, "cache", "an offline answer must never claim to be live");
			assert.isAbove(result.versions.length, 0);
			assert.strictEqual(result.latest, result.versions[0], "versions are newest first");
		}),
	);

	it.effect("an invalid range is a range error, not a not-found", () =>
		Effect.gen(function* () {
			// v3 caught this and returned an empty array, so a typo in a range reached
			// the user as "no versions found" — the one message guaranteed to mislead.
			const error = yield* Effect.flip(resolve({ range: "not a range", date: NOW }));
			assert.instanceOf(error, InvalidRangeError);
		}),
	);

	it.effect("a range that matches nothing is a not-found carrying the constraint", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(resolve({ range: ">=999", date: NOW }));
			assert.instanceOf(error, NoMatchingVersionError);
			assert.strictEqual(error.runtime, "node");
			assert.strictEqual(error.constraint, ">=999");
			assert.deepStrictEqual(error.phases, ["current", "active-lts"]);
		}),
	);

	it.effect("a phase filter that excludes everything fails rather than succeeding empty", () =>
		Effect.gen(function* () {
			// Every matching release is filtered out by phase, so the phase filter must
			// actually do something for this to pass.
			const error = yield* Effect.flip(resolve({ range: "^20", phases: ["current"], date: NOW }));
			assert.instanceOf(error, NoMatchingVersionError);
			assert.deepStrictEqual(error.phases, ["current"]);
		}),
	);

	it.effect("restricts results to the requested phases", () =>
		Effect.gen(function* () {
			const eol = yield* resolve({ range: "*", phases: ["end-of-life"], increments: "latest", date: NOW });
			const live = yield* resolve({ range: "*", phases: ["current", "active-lts"], date: NOW });

			// Nothing may appear under both an end-of-life and a live filter.
			const overlap = eol.versions.filter((v) => live.versions.includes(v));
			assert.lengthOf(overlap, 0, "a release cannot be both end-of-life and current");
			assert.isAbove(eol.versions.length, 0);
			assert.isAbove(live.versions.length, 0);
		}),
	);

	describe("increments", () => {
		it.effect("latest keeps one release per major", () =>
			Effect.gen(function* () {
				const result = yield* resolve({ range: "*", phases: ["end-of-life"], increments: "latest", date: NOW });
				const majors = result.versions.map((v) => v.split(".")[0]);
				assert.deepStrictEqual([...new Set(majors)], majors, "one entry per major line");
			}),
		);

		it.effect("minor keeps one release per minor, and more of them than latest", () =>
			Effect.gen(function* () {
				const latest = yield* resolve({ range: "^20", phases: ["maintenance-lts"], increments: "latest", date: NOW });
				const minor = yield* resolve({ range: "^20", phases: ["maintenance-lts"], increments: "minor", date: NOW });
				const patch = yield* resolve({ range: "^20", phases: ["maintenance-lts"], increments: "patch", date: NOW });

				// Grouping by major, then minor, then not at all must be strictly widening.
				// An implementation that grouped by major for both would pass a test that
				// only checked `minor.length > 0`.
				assert.strictEqual(latest.versions.length, 1, "one major in range, so one result");
				assert.isAbove(minor.versions.length, latest.versions.length);
				assert.isAbove(patch.versions.length, minor.versions.length);

				const minors = minor.versions.map((v) => v.split(".").slice(0, 2).join("."));
				assert.deepStrictEqual([...new Set(minors)], minors, "one entry per minor line");
			}),
		);
	});

	it.effect("reports the newest matching LTS release and defaults to it", () =>
		Effect.gen(function* () {
			const result = yield* resolve({ range: "*", date: NOW });
			assert.isDefined(result.lts);
			assert.strictEqual(result.default, result.lts, "with no explicit default, node falls back to LTS");
		}),
	);

	it.effect("an explicit default version overrides the LTS fallback", () =>
		Effect.gen(function* () {
			const result = yield* resolve({ range: "*", defaultVersion: "^22", date: NOW });
			assert.isDefined(result.default);
			assert.strictEqual(result.default?.split(".")[0], "22");
			assert.notStrictEqual(result.default, result.lts);
		}),
	);

	it.effect("an invalid default range is surfaced, not swallowed", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(resolve({ range: "*", defaultVersion: "!!!", date: NOW }));
			assert.instanceOf(error, InvalidRangeError);
		}),
	);

	it.effect("a default range that matches nothing fails rather than quietly becoming the LTS pick", () =>
		Effect.gen(function* () {
			// The range is well-formed and resolves to nothing. Because node falls back
			// to LTS when no default was asked for, an unresolvable *explicit* default
			// used to be indistinguishable from having asked for none — the caller named
			// a version that does not exist and silently got LTS.
			const error = yield* Effect.flip(resolve({ range: "*", defaultVersion: ">=900", date: NOW }));
			assert.instanceOf(error, UnresolvableDefaultError);
			assert.strictEqual(error.runtime, "node");
			assert.strictEqual(error.defaultVersion, ">=900");
		}),
	);

	it.effect("omitting the default still falls back to LTS", () =>
		Effect.gen(function* () {
			// The other side of the same seam: absent must keep falling back, so the fix
			// cannot have been "always fail when the default does not resolve".
			const result = yield* resolve({ range: "*", date: NOW });
			assert.isDefined(result.default);
			assert.strictEqual(result.default, result.lts);
		}),
	);

	describe("the dotted 0.x release lines", () => {
		// June 2015: v0.12 (start 2015-02-06) was current, while v0.8 (end 2014-07-31)
		// was already dead. The bundled snapshot carries all three dotted lines and
		// their 0.x releases, so this crosses the seam a consumer actually calls —
		// `NodeSchedule` unit tests alone would not prove `NodeRelease.phase` asks the
		// schedule the right question.
		const JUNE_2015 = DateTime.makeUnsafe("2015-06-01");

		it.effect("resolves 0.12 as current, not with v0.8's end-of-life dates", () =>
			Effect.gen(function* () {
				const result = yield* resolve({ range: "0.12.x", phases: ["current"], increments: "patch", date: JUNE_2015 });
				assert.isAbove(result.versions.length, 0);
				assert.isTrue(
					result.versions.every((v) => v.startsWith("0.12.")),
					"only 0.12 releases match the range",
				);
			}),
		);

		it.effect("still reports 0.8 as end-of-life at the same moment", () =>
			Effect.gen(function* () {
				// The discriminating half: if every 0.x line were keyed to v0.12 instead,
				// this would wrongly succeed.
				const error = yield* Effect.flip(
					resolve({ range: "0.8.x", phases: ["current"], increments: "patch", date: JUNE_2015 }),
				);
				assert.instanceOf(error, NoMatchingVersionError);
			}),
		);
	});

	it.effect("phase is evaluated at the supplied date, not the wall clock", () =>
		Effect.gen(function* () {
			// Node 20 was in active LTS in 2024 and in maintenance by 2025. The same
			// query at two dates must therefore disagree — which it cannot do if the
			// resolver reads the wall clock instead of the parameter.
			const during = yield* resolve({
				range: "^20",
				phases: ["active-lts"],
				date: DateTime.makeUnsafe("2024-06-01"),
			});
			assert.isAbove(during.versions.length, 0);

			const after = yield* Effect.flip(
				resolve({ range: "^20", phases: ["active-lts"], date: DateTime.makeUnsafe("2025-06-01") }),
			);
			assert.instanceOf(after, NoMatchingVersionError);
		}),
	);

	it.effect("the auto strategy falls back to the snapshot and marks it as cache", () =>
		Effect.gen(function* () {
			const result = yield* Effect.gen(function* () {
				const resolver = yield* NodeResolver;
				return yield* resolver.resolve({ range: ">=20", date: NOW });
			}).pipe(Effect.provide(NodeResolver.layer.pipe(Layer.provide(deadNetwork))));

			// The whole point of the provenance fix: a fallback answer says "cache".
			assert.strictEqual(result.source, "cache");
			assert.isAbove(result.versions.length, 0);
		}),
	);

	it.effect("the fresh strategy fails rather than silently serving a snapshot", () =>
		Effect.gen(function* () {
			// Asserting only that it failed would pass for a regression that failed with
			// the wrong error entirely — the type IS the contract here.
			const error = yield* Effect.flip(
				Effect.gen(function* () {
					const resolver = yield* NodeResolver;
					return yield* resolver.resolve({ range: ">=20", date: NOW });
				}).pipe(Effect.provide(NodeResolver.layerFresh.pipe(Layer.provide(deadNetwork)))),
			);
			assert.instanceOf(error, FreshnessError);
			assert.strictEqual(error.runtime, "node");
		}),
	);
});

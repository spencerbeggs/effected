import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ConfigSource } from "../src/MergeStrategy.js";
import { MergeStrategy } from "../src/MergeStrategy.js";

const src = <A>(path: string, resolver: string, value: A): ConfigSource<A> => ({ path, resolver, value });

describe("MergeStrategy.firstMatch", () => {
	it.effect("returns the value of the first (highest-priority) source", () =>
		Effect.gen(function* () {
			const strategy = MergeStrategy.firstMatch<{ port: number }>();
			const value = yield* strategy.resolve([
				src("/a/.apprc", "walk", { port: 1 }),
				src("/etc/apprc", "system", { port: 2 }),
			]);
			assert.deepStrictEqual(value, { port: 1 });
		}),
	);
});

describe("MergeStrategy.layeredMerge", () => {
	it.effect("deep-merges with earlier sources winning on conflict", () =>
		Effect.gen(function* () {
			const strategy = MergeStrategy.layeredMerge<Record<string, unknown>>();
			const value = yield* strategy.resolve([
				src("/a", "walk", { port: 1, nested: { a: 1 } }),
				src("/etc", "system", { port: 2, host: "x", nested: { a: 9, b: 2 } }),
			]);
			assert.deepStrictEqual(value, { port: 1, host: "x", nested: { a: 1, b: 2 } });
		}),
	);

	it.effect("a single source merges to itself", () =>
		Effect.gen(function* () {
			const strategy = MergeStrategy.layeredMerge<Record<string, unknown>>();
			const value = yield* strategy.resolve([src("/a", "walk", { port: 1 })]);
			assert.deepStrictEqual(value, { port: 1 });
		}),
	);

	it.effect("does not merge across a non-object value — higher priority wins whole", () =>
		Effect.gen(function* () {
			const strategy = MergeStrategy.layeredMerge<unknown>();
			const value = yield* strategy.resolve([src("/a", "walk", 5), src("/etc", "system", { port: 2 })]);
			assert.strictEqual(value, 5);
		}),
	);

	it.effect("does not merge arrays element-wise — higher priority replaces", () =>
		Effect.gen(function* () {
			const strategy = MergeStrategy.layeredMerge<Record<string, unknown>>();
			const value = yield* strategy.resolve([src("/a", "walk", { xs: [1] }), src("/etc", "system", { xs: [2, 3] })]);
			assert.deepStrictEqual(value, { xs: [1] });
		}),
	);

	it.effect("ignores inherited and __proto__ keys", () =>
		Effect.gen(function* () {
			const strategy = MergeStrategy.layeredMerge<Record<string, unknown>>();
			const malicious = JSON.parse(`{"__proto__":{"polluted":true}}`) as Record<string, unknown>;
			const value = yield* strategy.resolve([src("/a", "walk", { ok: 1 }), src("/etc", "system", malicious)]);
			// Assert on the merged value's own prototype chain, not a fresh `{}` —
			// the attack repoints the merged object's own [[Prototype]], it does
			// not touch the shared Object.prototype, so a fresh literal can never
			// observe it.
			assert.strictEqual(Object.getPrototypeOf(value), Object.prototype);
			assert.isUndefined((value as Record<string, unknown>).polluted);
			// Defense in depth: the shared prototype really is untouched too.
			assert.isUndefined(({} as Record<string, unknown>).polluted);
		}),
	);
});

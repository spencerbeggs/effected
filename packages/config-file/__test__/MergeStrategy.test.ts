import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
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

describe("MergeStrategy.layeredMerge — value identity", () => {
	class Doc extends Schema.Class<Doc>("Doc")({ port: Schema.Number, host: Schema.String }) {
		get origin(): string {
			return `http://${this.host}:${this.port}`;
		}
	}

	it.effect("preserves the document's class instance and its prototype getters", () =>
		Effect.gen(function* () {
			const strategy = MergeStrategy.layeredMerge<Doc>();
			const value = yield* strategy.resolve([
				src("/a", "walk", new Doc({ port: 1, host: "a" })),
				src("/etc", "system", new Doc({ port: 2, host: "b" })),
			]);
			// `load` declares Effect<A>. Returning a structurally-equal POJO would be a lie.
			assert.instanceOf(value, Doc);
			assert.strictEqual(value.origin, "http://a:1");
		}),
	);

	it.effect("a nested Date is atomic — higher priority wins it whole, never spread", () =>
		Effect.gen(function* () {
			const strategy = MergeStrategy.layeredMerge<Record<string, unknown>>();
			const hi = new Date("2020-01-01T00:00:00.000Z");
			const lo = new Date("2021-01-01T00:00:00.000Z");
			const value = yield* strategy.resolve([src("/a", "walk", { at: hi }), src("/etc", "system", { at: lo })]);
			assert.instanceOf(value.at, Date);
			assert.strictEqual((value.at as Date).toISOString(), "2020-01-01T00:00:00.000Z");
		}),
	);

	it.effect("a nested class instance is atomic — higher priority wins it whole", () =>
		Effect.gen(function* () {
			class Section extends Schema.Class<Section>("Section")({ a: Schema.Number, b: Schema.Number }) {}
			const strategy = MergeStrategy.layeredMerge<Record<string, unknown>>();
			const value = yield* strategy.resolve([
				src("/a", "walk", { db: new Section({ a: 1, b: 1 }) }),
				src("/etc", "system", { db: new Section({ a: 9, b: 9 }) }),
			]);
			assert.instanceOf(value.db, Section);
			assert.deepStrictEqual({ a: (value.db as Section).a, b: (value.db as Section).b }, { a: 1, b: 1 });
		}),
	);

	it.effect("a nested Map is atomic", () =>
		Effect.gen(function* () {
			const strategy = MergeStrategy.layeredMerge<Record<string, unknown>>();
			const value = yield* strategy.resolve([
				src("/a", "walk", { m: new Map([["k", 1]]) }),
				src("/etc", "system", { m: new Map([["k", 2]]) }),
			]);
			assert.instanceOf(value.m, Map);
			assert.strictEqual((value.m as Map<string, number>).get("k"), 1);
		}),
	);
});

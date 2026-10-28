import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { ConfigMerge } from "../src/ConfigMerge.js";
import { MergeStrategy } from "../src/MergeStrategy.js";

type Rec = Record<string, unknown>;

describe("ConfigMerge.deep", () => {
	it("merges nested plain objects, override winning on conflict", () => {
		const merged = ConfigMerge.deep<Rec>(
			{ server: { host: "localhost", port: 8080 }, name: "base" },
			{ server: { port: 9090 }, extra: true },
		);
		assert.deepStrictEqual(merged, { server: { port: 9090, host: "localhost" }, extra: true, name: "base" });
	});

	it("replaces arrays whole, never by index or concatenation", () => {
		assert.deepStrictEqual(ConfigMerge.deep<Rec>({ tags: ["a", "b", "c"] }, { tags: ["z"] }), { tags: ["z"] });
	});

	it("lets an own undefined on override win, and an omitted key inherit", () => {
		const merged = ConfigMerge.deep<Rec>({ a: 1, b: 2 }, { a: undefined });
		assert.isTrue(Object.hasOwn(merged, "a"));
		assert.isUndefined(merged.a);
		assert.strictEqual(merged.b, 2);
	});

	it("takes override whole when the pair cannot merge", () => {
		assert.deepStrictEqual(ConfigMerge.deep<unknown>({ a: 1 }, [1]), [1]);
		assert.strictEqual(ConfigMerge.deep<unknown>({ a: 1 }, "x"), "x");
		assert.deepStrictEqual(ConfigMerge.deep<Rec>({ a: { b: 1 } }, { a: 5 }), { a: 5 });
	});

	it("merges a null-prototype object with an ordinary one at the top level, on override's prototype", () => {
		const base: Rec = Object.assign(Object.create(null), { a: 1, nested: { x: 1 } });
		const merged = ConfigMerge.deep<Rec>(base, { b: 2, nested: { y: 2 } });
		assert.strictEqual(Object.getPrototypeOf(merged), Object.prototype);
		assert.deepStrictEqual({ ...merged }, { b: 2, nested: { y: 2, x: 1 }, a: 1 });

		const reversed = ConfigMerge.deep<Rec>({ a: 1 }, Object.assign(Object.create(null), { b: 2 }));
		assert.strictEqual(Object.getPrototypeOf(reversed), null);
		assert.strictEqual(reversed.a, 1);
	});

	it("merges a null-prototype object with an ordinary one at a nested level", () => {
		const merged = ConfigMerge.deep<Rec>({ s: Object.assign(Object.create(null), { a: 1 }) }, { s: { b: 2 } });
		assert.deepStrictEqual({ ...(merged.s as Rec) }, { b: 2, a: 1 });
	});

	it("never copies __proto__, constructor or prototype, and pollutes nothing", () => {
		const hostileBase = JSON.parse('{"__proto__":{"polluted":"base"},"constructor":1,"keep":1}') as Rec;
		const hostileOverride = JSON.parse(
			'{"__proto__":{"polluted":"override"},"prototype":2,"n":{"__proto__":{"polluted":"nested"}}}',
		) as Rec;
		// The payloads really are own keys, so the guard has something to stop.
		assert.isTrue(Object.hasOwn(hostileOverride, "__proto__"));
		const merged = ConfigMerge.deep<Rec>(hostileBase, hostileOverride);
		assert.strictEqual(Object.getPrototypeOf(merged), Object.prototype);
		for (const key of ["__proto__", "constructor", "prototype"]) assert.isFalse(Object.hasOwn(merged, key), key);
		// `n` is only on override, so it is taken whole: its own `__proto__` data
		// key is kept as written, and stays inert.
		assert.strictEqual(merged.n, hostileOverride.n);
		assert.strictEqual(Object.getPrototypeOf(merged.n), Object.prototype);
		assert.isUndefined((merged as { polluted?: unknown }).polluted);
		assert.isUndefined(({} as { polluted?: unknown }).polluted);
		assert.strictEqual(merged.keep, 1);
	});

	it("merges two instances of one class at the top level and keeps the class", () => {
		class Doc extends Schema.Class<Doc>("Doc")({
			a: Schema.optionalKey(Schema.Number),
			b: Schema.optionalKey(Schema.Number),
		}) {
			get sum(): number {
				return (this.a ?? 0) + (this.b ?? 0);
			}
		}
		const merged = ConfigMerge.deep(Doc.make({ a: 1, b: 2 }), Doc.make({ b: 5 }));
		assert.instanceOf(merged, Doc);
		assert.strictEqual(merged.sum, 6);
	});

	it("keeps a Date, and a nested class instance, atomic", () => {
		const when = new Date(0);
		class Box {
			constructor(readonly v: number) {}
		}
		const box = new Box(1);
		const merged = ConfigMerge.deep<Rec>({ when: { a: 1 }, box: { v: 0, w: 1 } }, { when, box });
		assert.strictEqual(merged.when, when);
		assert.strictEqual(merged.box, box);
	});

	it("modifies neither input", () => {
		const base = { a: { x: 1 } };
		const override = { a: { y: 2 } };
		ConfigMerge.deep<Rec>(base, override);
		assert.deepStrictEqual(base, { a: { x: 1 } });
		assert.deepStrictEqual(override, { a: { y: 2 } });
	});

	it("returns on cyclic inputs instead of recursing forever", () => {
		const base: Rec = { v: 1 };
		base.self = base;
		const override: Rec = { w: 2 };
		override.self = override;
		const merged = ConfigMerge.deep<Rec>(base, override);
		assert.strictEqual(merged.v, 1);
		assert.strictEqual(merged.w, 2);
	});

	it("returns quickly on a cycle reached through two keys at every level", () => {
		// Without per-pair memoization this recurses into both keys at every
		// level: about 2^depth calls, which never finishes.
		const node: Rec = {};
		node.x = node;
		node.y = node;
		const start = performance.now();
		const merged = ConfigMerge.deep<Rec>(node, node);
		assert.isBelow(performance.now() - start, 1000);
		// The revisited pair reuses the result in progress, so the cycle survives.
		assert.strictEqual(merged.x, merged);
		assert.strictEqual(merged.y, merged);
		assert.notStrictEqual(merged, node);
	});

	it("keeps a cycle's shape instead of unrolling it to the depth cap", () => {
		const base: Rec = { v: 1 };
		base.self = base;
		const override: Rec = { w: 2 };
		override.self = override;
		const merged = ConfigMerge.deep<Rec>(base, override);
		assert.strictEqual(merged.self, merged);
		assert.deepStrictEqual(Object.keys(merged).sort(), ["self", "v", "w"]);
	});

	it("merges a shared subobject once, so a DAG keeps its sharing", () => {
		const sharedBase: Rec = { host: "localhost", port: 8080 };
		const sharedOverride: Rec = { port: 9090 };
		const merged = ConfigMerge.deep<Rec>(
			{ a: sharedBase, b: sharedBase, c: sharedBase },
			{ a: sharedOverride, b: sharedOverride, c: { port: 1 } },
		);
		assert.deepStrictEqual(merged.a, { port: 9090, host: "localhost" });
		assert.strictEqual(merged.a, merged.b);
		// A different pair is a different merge.
		assert.deepStrictEqual(merged.c, { port: 1, host: "localhost" });
		assert.notStrictEqual(merged.c, merged.a);
		// Inputs untouched.
		assert.deepStrictEqual(sharedBase, { host: "localhost", port: 8080 });
		assert.deepStrictEqual(sharedOverride, { port: 9090 });
	});

	it("still drops prototype keys on a revisited pair", () => {
		const evil = JSON.parse('{"__proto__": {"polluted": true}, "constructor": 1, "k": 1}') as Rec;
		const shared: Rec = { k: 0 };
		const merged = ConfigMerge.deep<Rec>({ a: shared, b: shared }, { a: evil, b: evil });
		assert.strictEqual(merged.a, merged.b);
		assert.isFalse(Object.hasOwn(merged.a as Rec, "__proto__"));
		assert.isFalse(Object.hasOwn(merged.a as Rec, "constructor"));
		assert.strictEqual(Object.getPrototypeOf(merged.a), Object.prototype);
		assert.isUndefined(({} as Rec).polluted);
	});

	it("merges down to depth 1024 and takes override whole below it, without overflowing", () => {
		const chain = (depth: number, leaf: Rec): Rec => {
			let node: Rec = leaf;
			for (let i = 0; i < depth; i++) node = { k: node };
			return node;
		};
		// Both chains hold 3000 nested `k` levels; the leaves differ.
		const merged = ConfigMerge.deep<Rec>(chain(3000, { fromBase: 1 }), chain(3000, { fromOverride: 1 }));
		let node = merged;
		let level = 1;
		while (Object.hasOwn(node, "k")) {
			node = node.k as Rec;
			level++;
		}
		assert.strictEqual(level, 3001);
		assert.deepStrictEqual(node, { fromOverride: 1 });

		// At a depth the cap does not reach, both leaves survive.
		let shallow = ConfigMerge.deep<Rec>(chain(1000, { fromBase: 1 }), chain(1000, { fromOverride: 1 }));
		for (let i = 0; i < 1000; i++) shallow = shallow.k as Rec;
		assert.deepStrictEqual(shallow, { fromOverride: 1, fromBase: 1 });
	});
});

describe("ConfigMerge.deep and MergeStrategy.layeredMerge", () => {
	it.effect("layeredMerge is a fold of deep from the lowest priority up", () =>
		Effect.gen(function* () {
			const values: ReadonlyArray<Rec> = [
				{ a: { x: 1 }, list: [1] },
				{ a: { y: 2 }, list: [2], b: 1 },
				{ a: { x: 9, z: 3 }, c: Object.assign(Object.create(null), { n: 1 }) },
			];
			const viaStrategy = yield* MergeStrategy.layeredMerge<Rec>().resolve([
				{ path: "/0", resolver: "r", value: values[0] as Rec },
				{ path: "/1", resolver: "r", value: values[1] as Rec },
				{ path: "/2", resolver: "r", value: values[2] as Rec },
			]);
			const viaDeep = ConfigMerge.deep(ConfigMerge.deep(values[2] as Rec, values[1] as Rec), values[0] as Rec);
			assert.deepStrictEqual(viaStrategy, viaDeep);
		}),
	);
});

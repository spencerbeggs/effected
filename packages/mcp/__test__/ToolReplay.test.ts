import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import { McpProtocol, Tool, Toolkit } from "effect/ai";
import { KeyValueStore } from "effect/persistence";
import type { ToolReplayStore } from "../src/index.js";
import { McpStdio, McpToolkit, ToolOutcome, ToolReplay } from "../src/index.js";
import { McpHarness } from "../src/testing.js";

const Created = ToolReplay.success(Schema.Struct({ ok: Schema.Literal(true), id: Schema.Number }));
const Failed = ToolOutcome.error("Busy");
const Result = ToolOutcome.envelope(Created, [Failed]);

interface Params {
	readonly requestId?: string;
	readonly fail?: "typed" | "busy";
}

/** A handler that counts its runs, so a replay is observable as a run that did not happen. */
const makeHandler = () => {
	let runs = 0;
	const handler = (params: Params): Effect.Effect<typeof Result.Type, "typed"> =>
		Effect.suspend((): Effect.Effect<typeof Result.Type, "typed"> => {
			runs += 1;
			if (params.fail === "typed") return Effect.fail("typed" as const);
			if (params.fail === "busy")
				return Effect.succeed(ToolOutcome.failure("Busy", { message: "Busy.", remediation: { hint: "Retry." } }));
			return Effect.succeed({ ok: true as const, id: runs });
		});
	return { handler, runs: () => runs };
};

const wrapWith = <E, R>(handler: (params: Params) => Effect.Effect<typeof Result.Type, E, R>) =>
	ToolReplay.wrap({
		tool: "create",
		success: Result,
		key: (params: Params) => Option.fromUndefinedOr(params.requestId),
	})(handler);

describe("ToolReplay.wrap", () => {
	layer(KeyValueStore.layerMemory)((it) => {
		it.effect("a miss runs and stores; a hit replays the stored result with the marker and does not run", () =>
			Effect.gen(function* () {
				const { handler, runs } = makeHandler();
				const create = wrapWith(handler);
				assert.deepStrictEqual(yield* create({ requestId: "a" }), { ok: true, id: 1 });
				assert.deepStrictEqual(yield* create({ requestId: "a" }), { ok: true, id: 1, _idempotentReplay: true });
				assert.strictEqual(runs(), 1);
				const stored = yield* (yield* KeyValueStore.KeyValueStore).get(ToolReplay.storeKey("create", "a"));
				assert.deepStrictEqual(JSON.parse(stored ?? "null"), { ok: true, id: 1 });
			}),
		);

		it.effect("two tools sharing one store and one key never replay each other's results", () =>
			Effect.gen(function* () {
				const { handler: first, runs: firstRuns } = makeHandler();
				const { handler: second, runs: secondRuns } = makeHandler();
				const key = (params: Params) => Option.fromUndefinedOr(params.requestId);
				const toolA = ToolReplay.wrap({ tool: "tool_a", success: Result, key })(first);
				const toolB = ToolReplay.wrap({ tool: "tool_b", success: Result, key })(second);
				assert.deepStrictEqual(yield* toolA({ requestId: "same" }), { ok: true, id: 1 });
				assert.deepStrictEqual(yield* toolB({ requestId: "same" }), { ok: true, id: 1 }, "tool_b ran, not replayed");
				assert.strictEqual(firstRuns(), 1);
				assert.strictEqual(secondRuns(), 1);
				assert.deepStrictEqual(yield* toolB({ requestId: "same" }), { ok: true, id: 1, _idempotentReplay: true });
			}),
		);

		it.effect("no key runs every time and stores nothing", () =>
			Effect.gen(function* () {
				const { handler, runs } = makeHandler();
				const create = wrapWith(handler);
				yield* create({});
				yield* create({});
				assert.strictEqual(runs(), 2);
			}),
		);

		it.effect("a handler failure stores nothing, so a retry runs again", () =>
			Effect.gen(function* () {
				const { handler, runs } = makeHandler();
				const create = wrapWith(handler);
				assert.strictEqual(yield* Effect.flip(create({ requestId: "f", fail: "typed" })), "typed");
				assert.deepStrictEqual(yield* create({ requestId: "f" }), { ok: true, id: 2 });
				assert.strictEqual(runs(), 2);
			}),
		);

		it.effect("an ok:false result is never stored", () =>
			Effect.gen(function* () {
				const { handler, runs } = makeHandler();
				const create = wrapWith(handler);
				const busy = yield* create({ requestId: "b", fail: "busy" });
				assert.strictEqual(busy.ok, false);
				assert.deepStrictEqual(yield* create({ requestId: "b" }), { ok: true, id: 2 });
				assert.strictEqual(runs(), 2);
			}),
		);

		it.effect("a stored row that no longer decodes is a miss, then overwritten", () =>
			Effect.gen(function* () {
				const store = yield* KeyValueStore.KeyValueStore;
				yield* store.set(ToolReplay.storeKey("create", "c"), '{"ok":true,"id":"not-a-number"}');
				const { handler, runs } = makeHandler();
				assert.deepStrictEqual(yield* wrapWith(handler)({ requestId: "c" }), { ok: true, id: 1 });
				assert.strictEqual(runs(), 1);
				assert.deepStrictEqual(JSON.parse((yield* store.get(ToolReplay.storeKey("create", "c"))) ?? "null"), {
					ok: true,
					id: 1,
				});
			}),
		);
	});

	it.effect("a failing store never fails the call: the lookup is a miss and the write is skipped", () =>
		Effect.gen(function* () {
			const { handler, runs } = makeHandler();
			const create = wrapWith(handler);
			assert.deepStrictEqual(yield* create({ requestId: "x" }), { ok: true, id: 1 });
			assert.deepStrictEqual(yield* create({ requestId: "x" }), { ok: true, id: 2 });
			assert.strictEqual(runs(), 2);
		}).pipe(
			Effect.provideService(
				KeyValueStore.KeyValueStore,
				KeyValueStore.makeStringOnly({
					get: () => Effect.fail(new KeyValueStore.KeyValueStoreError({ method: "get", message: "down" })),
					set: () => Effect.fail(new KeyValueStore.KeyValueStoreError({ method: "set", message: "down" })),
					remove: () => Effect.void,
					clear: Effect.void,
					size: Effect.succeed(0),
				}),
			),
		),
	);

	it.effect("a given store port is used instead of KeyValueStore, which leaves R", () =>
		Effect.gen(function* () {
			const rows = new Map<string, string>();
			const writes: Array<string> = [];
			const store: ToolReplayStore = {
				get: (key) => Effect.sync(() => rows.get(key)),
				set: (key, value) =>
					Effect.sync(() => {
						writes.push(key);
						rows.set(key, value);
					}),
			};
			const { handler, runs } = makeHandler();
			const create = ToolReplay.wrap({
				tool: "create",
				success: Result,
				key: (params: Params) => Option.fromUndefinedOr(params.requestId),
				store,
			})(handler);
			// No KeyValueStore is provided anywhere: R is `never`, and a read of it would die.
			const first: Effect.Effect<typeof Result.Type, "typed", never> = create({ requestId: "p" });
			assert.deepStrictEqual(yield* first, { ok: true, id: 1 });
			assert.deepStrictEqual(yield* create({ requestId: "p" }), { ok: true, id: 1, _idempotentReplay: true });
			assert.strictEqual(runs(), 1);
			assert.deepStrictEqual(writes, [ToolReplay.storeKey("create", "p")]);
			assert.deepStrictEqual(JSON.parse(rows.get(ToolReplay.storeKey("create", "p")) ?? "null"), { ok: true, id: 1 });
		}),
	);

	it.effect("a failing store port never fails the call", () =>
		Effect.gen(function* () {
			const { handler, runs } = makeHandler();
			const create = ToolReplay.wrap({
				tool: "create",
				success: Result,
				key: (params: Params) => Option.fromUndefinedOr(params.requestId),
				store: { get: () => Effect.fail("down"), set: () => Effect.fail("down") },
			})(handler);
			assert.deepStrictEqual(yield* create({ requestId: "x" }), { ok: true, id: 1 });
			assert.deepStrictEqual(yield* create({ requestId: "x" }), { ok: true, id: 2 });
			assert.strictEqual(runs(), 2);
		}),
	);

	it.effect("a KeyValueStore value satisfies the port as is", () =>
		Effect.gen(function* () {
			const kv = yield* KeyValueStore.KeyValueStore;
			const { handler, runs } = makeHandler();
			const create = ToolReplay.wrap({
				tool: "create",
				success: Result,
				key: (params: Params) => Option.fromUndefinedOr(params.requestId),
				store: kv,
			})(handler);
			yield* create({ requestId: "k" });
			assert.deepStrictEqual(yield* create({ requestId: "k" }), { ok: true, id: 1, _idempotentReplay: true });
			assert.strictEqual(runs(), 1);
		}).pipe(Effect.provide(KeyValueStore.layerMemory)),
	);

	it("without a store, KeyValueStore stays in R", () => {
		const { handler } = makeHandler();
		const create = wrapWith(handler);
		// @ts-expect-error -- R is KeyValueStore when no store is given
		const run: Effect.Effect<typeof Result.Type, "typed", never> = create({ requestId: "r" });
		assert.isDefined(run);
	});

	it("a tool name containing the key separator is a wiring defect at wrap time", () => {
		assert.throws(() => ToolReplay.wrap({ tool: "a:b", success: Result, key: () => Option.none() }), /contains ":"/);
	});
});

const CreateTool = Tool.make("create", {
	description: "Creates a thing; a repeated requestId replays the first result.",
	parameters: Schema.Struct({ requestId: Schema.String }),
	success: Result,
	dependencies: [KeyValueStore.KeyValueStore],
});
const Kit = Toolkit.make(CreateTool);
const { handler: wireHandler } = makeHandler();
const server = McpToolkit.layer(Kit).pipe(
	Layer.provide(Kit.toLayer({ create: (params) => wrapWith(wireHandler)(params).pipe(Effect.orDie) })),
	Layer.provide(KeyValueStore.layerMemory),
	Layer.provideMerge(McpStdio.layer({ name: "replay", version: "0.0.0" })),
);

describe("ToolReplay.success", () => {
	it("adds the optional marker beside the struct's own fields", () => {
		const Marked = ToolReplay.success(Schema.Struct({ id: Schema.Number }));
		assert.deepStrictEqual(Object.keys(Marked.fields), ["id", "_idempotentReplay"]);
		assert.deepStrictEqual(Schema.decodeUnknownSync(Marked)({ id: 1, _idempotentReplay: true }), {
			id: 1,
			_idempotentReplay: true,
		});
		assert.deepStrictEqual(Schema.decodeUnknownSync(Marked)({ id: 1 }), { id: 1 });
		assert.throws(() => Schema.decodeUnknownSync(Marked)({ id: 1, _idempotentReplay: false }));
	});
});

describe("ToolReplay on the wire", () => {
	it.effect("the declared marker survives core's encoder into structuredContent", () =>
		Effect.gen(function* () {
			const harness = yield* McpHarness.make(server, { protocol: McpProtocol.v2025_11_25 });
			yield* harness.initialize;
			const first = (yield* harness.callTool("create", { requestId: "w" })).result as { structuredContent?: unknown };
			const again = (yield* harness.callTool("create", { requestId: "w" })).result as { structuredContent?: unknown };
			assert.deepStrictEqual(first.structuredContent, { ok: true, id: 1 });
			assert.deepStrictEqual(again.structuredContent, { ok: true, id: 1, _idempotentReplay: true });
		}),
	);
});

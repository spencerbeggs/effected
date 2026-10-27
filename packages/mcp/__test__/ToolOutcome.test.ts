import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { McpProtocol, Tool, Toolkit } from "effect/ai";
import { McpStdio, McpToolkit, ToolOutcome } from "../src/index.js";
import { McpHarness, McpToolAudit } from "../src/testing.js";

class GoalNotFound extends Schema.TaggedError<GoalNotFound>()("GoalNotFound", { id: Schema.Number }) {}
class TaskEnded extends Schema.TaggedError<TaskEnded>()("TaskEnded", { id: Schema.Number, outcome: Schema.String }) {}
class Corrupt extends Schema.TaggedError<Corrupt>()("Corrupt", {}) {}

const remediation = { hint: "List goals first.", suggestedTool: "goal", suggestedArgs: { action: "list" } };

const findGoal = (id: number): Effect.Effect<{ readonly name: string }, GoalNotFound | TaskEnded | Corrupt> =>
	id === 1
		? Effect.succeed({ name: "first" })
		: id === 2
			? Effect.fail(new TaskEnded({ id, outcome: "done" }))
			: id === 3
				? Effect.fail(new Corrupt())
				: Effect.fail(new GoalNotFound({ id }));

// Inline in the pipe, as with core's catchTags: E is inferred from the effect being piped.
const lookup = (id: number) =>
	findGoal(id).pipe(
		ToolOutcome.catchAsEnvelope({
			GoalNotFound: (e) => ({ id: e.id, message: `No goal ${e.id}.`, remediation }),
			TaskEnded: (e) => ({
				id: e.id,
				outcome: e.outcome,
				message: `Task ${e.id} ended.`,
				remediation: { hint: "Open a new task." },
			}),
		}),
	);

describe("ToolOutcome.catchAsEnvelope", () => {
	it.effect("passes a success through, maps each handled tag, and leaves the rest in E", () =>
		Effect.gen(function* () {
			const handled = lookup;
			assert.deepStrictEqual(yield* handled(1), { name: "first" });
			assert.deepStrictEqual(yield* handled(9), {
				ok: false,
				error: { _tag: "GoalNotFound", id: 9, message: "No goal 9.", remediation },
			});
			assert.deepStrictEqual(yield* handled(2), {
				ok: false,
				error: {
					_tag: "TaskEnded",
					id: 2,
					outcome: "done",
					message: "Task 2 ended.",
					remediation: { hint: "Open a new task." },
				},
			});
			const left = yield* Effect.flip(handled(3));
			// Type-level: only Corrupt remains in E.
			const _onlyCorrupt: Corrupt = left;
			assert.instanceOf(_onlyCorrupt, Corrupt);
		}),
	);

	it.effect("an error tagged like an Object.prototype member is not handled by an inherited property", () =>
		Effect.gen(function* () {
			// Typed as GoalNotFound, failing at runtime with a foreign error whose tag names an inherited member.
			const prototypeTagged = (tag: "toString" | "constructor") =>
				(Effect.fail({ _tag: tag }) as unknown as Effect.Effect<never, GoalNotFound>).pipe(
					ToolOutcome.catchAsEnvelope({ GoalNotFound: (e) => ({ id: e.id, message: "m", remediation }) }),
				);
			for (const tag of ["toString", "constructor"] as const) {
				const left = yield* Effect.flip(prototypeTagged(tag));
				assert.deepStrictEqual(left, { _tag: tag }, `${tag} stays in the error channel`);
			}
		}),
	);

	it("a case for a tag the effect cannot fail with is a type error", () => {
		const _rejected = findGoal(1).pipe(
			// @ts-expect-error -- "Elsewhere" is not a tag findGoal can fail with
			ToolOutcome.catchAsEnvelope({ Elsewhere: () => ({ message: "x", remediation }) }),
		);
		assert.isDefined(_rejected);
	});

	it("failure builds the same value a case produces, the tag winning over any _tag in the input", () => {
		assert.deepStrictEqual(ToolOutcome.failure("GoalNotFound", { id: 4, message: "No goal 4.", remediation }), {
			ok: false,
			error: { _tag: "GoalNotFound", id: 4, message: "No goal 4.", remediation },
		});
	});
});

const NotFoundSchema = ToolOutcome.error("GoalNotFound", { id: Schema.Number });
const EndedSchema = ToolOutcome.error("TaskEnded", { id: Schema.Number, outcome: Schema.String });
const Found = Schema.Struct({ ...ToolOutcome.ok, name: Schema.String });
const Result = ToolOutcome.envelope(Found, [NotFoundSchema, EndedSchema]);

describe("ToolOutcome schemas", () => {
	it("error carries _tag, message and remediation beside its own fields", () => {
		const value = { _tag: "GoalNotFound" as const, id: 1, message: "No.", remediation: { hint: "h" } };
		assert.deepStrictEqual(Schema.decodeUnknownSync(NotFoundSchema)(value), value);
		assert.throws(() => Schema.decodeUnknownSync(NotFoundSchema)({ _tag: "GoalNotFound", id: 1, message: "No." }));
	});

	it("error rejects a field that would replace a shared one", () => {
		// @ts-expect-error -- `message` is shared, not a per-error field
		const _bad = ToolOutcome.error("X", { message: Schema.Number });
		assert.isDefined(_bad);
	});

	it("envelope decodes the success and each failure member, and rejects an unknown error tag", () => {
		assert.deepStrictEqual(Schema.decodeUnknownSync(Result)({ ok: true, name: "a" }), { ok: true, name: "a" });
		const failed = {
			ok: false,
			error: { _tag: "TaskEnded", id: 2, outcome: "done", message: "m", remediation: { hint: "h" } },
		};
		assert.deepStrictEqual<unknown>(Schema.decodeUnknownSync(Result)(failed), failed);
		assert.throws(() =>
			Schema.decodeUnknownSync(Result)({
				ok: false,
				error: { _tag: "Other", message: "m", remediation: { hint: "h" } },
			}),
		);
	});
});

const GoalTool = Tool.make("goal", {
	description: "Looks a goal up; expected misses come back as an ok:false envelope.",
	parameters: Schema.Struct({ id: Schema.Number }),
	success: Result,
});
const Kit = Toolkit.make(GoalTool);
const server = McpToolkit.layer(Kit).pipe(
	Layer.provide(
		Kit.toLayer({
			goal: ({ id }) =>
				lookup(id).pipe(
					Effect.map((value) => ("ok" in value ? value : { ok: true as const, name: value.name })),
					Effect.orDie,
				),
		}),
	),
	Layer.provideMerge(McpStdio.layer({ name: "outcome", version: "0.0.0" })),
);

interface ToolResult {
	readonly isError?: boolean;
	readonly structuredContent?: unknown;
}

describe("ToolOutcome on the wire", () => {
	for (const protocol of [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2026_07_28]) {
		it.effect(
			`${protocol.protocolVersion}: an ok:false envelope is structuredContent, not isError, and the outputSchema is served`,
			() =>
				Effect.gen(function* () {
					const harness = yield* McpHarness.make(server, { protocol });
					yield* harness.initialize;
					const tools = yield* harness.listTools;
					assert.deepStrictEqual(McpToolAudit.check(tools, { input: "closed", requireOutputSchema: true }), []);
					const miss = (yield* harness.callTool("goal", { id: 7 })).result as ToolResult;
					assert.notStrictEqual(miss.isError, true);
					assert.deepStrictEqual(miss.structuredContent, {
						ok: false,
						error: { _tag: "GoalNotFound", id: 7, message: "No goal 7.", remediation },
					});
					const hit = (yield* harness.callTool("goal", { id: 1 })).result as ToolResult;
					assert.deepStrictEqual(hit.structuredContent, { ok: true, name: "first" });
				}),
		);
	}
});

describe("ToolOutcome.isFailure", () => {
	it("is true only for an object whose ok is exactly false", () => {
		assert.isTrue(ToolOutcome.isFailure(ToolOutcome.failure("Busy", { message: "m", remediation })));
		assert.isTrue(ToolOutcome.isFailure({ ok: false }));
		for (const value of [{ ok: true }, { found: false }, { ok: 0 }, { ok: "false" }, null, undefined, false, [false]]) {
			assert.isFalse(ToolOutcome.isFailure(value), JSON.stringify(value));
		}
	});
});

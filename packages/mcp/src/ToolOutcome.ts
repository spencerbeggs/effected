import type { Remediation } from "@effected/engine";
import { Effect, Schema } from "effect";
import { ToolFailure } from "./ToolFailure.js";
import { ToolOutputSchema } from "./ToolOutputSchema.js";

/**
 * What a {@link ToolOutcome.catchAsEnvelope} case returns for one caught error:
 * the same `message` and `remediation` a {@link ToolRefusal} carries, plus any
 * structured fields the agent branches on.
 *
 * @remarks
 * `message` is the plain sentence. The hint stays in `remediation`, where it
 * reaches the agent as data; unlike a refusal's message, nothing is folded in.
 *
 * @public
 */
export interface ToolOutcomeErrorInput {
	readonly message: string;
	readonly remediation: Remediation;
	readonly [field: string]: unknown;
}

/**
 * The `ok: false` member of an envelope: `{ ok: false, error: { _tag, message, remediation, ...fields } }`.
 *
 * @public
 */
export interface ToolOutcomeFailure<Tag extends string, I extends ToolOutcomeErrorInput> {
	readonly ok: false;
	readonly error: { readonly _tag: Tag } & I;
}

/**
 * The failure values {@link ToolOutcome.catchAsEnvelope} produces for a set of
 * cases: one {@link ToolOutcomeFailure} per handled tag.
 *
 * @public
 */
export type ToolOutcomeFailures<Cases> = {
	[K in keyof Cases]: Cases[K] extends (...args: ReadonlyArray<never>) => infer I
		? I extends ToolOutcomeErrorInput
			? ToolOutcomeFailure<K & string, I>
			: never
		: never;
}[keyof Cases];

/**
 * {@link ToolOutcome.envelope}'s options: annotations for the `ok: false`
 * member, so a served `outputSchema` can name and describe it.
 *
 * @public
 */
export interface ToolOutcomeEnvelopeOptions {
	/**
	 * The failure member's schema identifier. Core's JSON Schema output then
	 * emits it once under `$defs` by this name and refers to it with `$ref`.
	 */
	readonly identifier?: string;
	/**
	 * The failure member's description, replacing the default one (which says
	 * that `ok: false` carries an expected error to branch on).
	 */
	readonly description?: string;
}

/**
 * The `ok: false` structured-outcome envelope: an expected error an agent
 * should branch on, returned on a tool's success channel so it reaches the
 * client as `structuredContent` instead of message text.
 *
 * @remarks
 * Two channels, two jobs, one error shape:
 *
 * - {@link ToolRefusal} is a declared failure: the call itself was wrong, and
 *   the agent reads one sentence (`isError: true`, message text only; core
 *   never sends a failure's `structuredContent`).
 * - `ToolOutcome` is an expected domain outcome: an id that does not exist, a
 *   transition that is not allowed. The agent branches on its `_tag` and
 *   fields (`isError: false`, `structuredContent` carries the envelope).
 *
 * Both carry {@link ToolFailure.fields} (`message`, `remediation`), so an error
 * can move between channels without reshaping.
 *
 * Success members are not reshaped. Spread {@link ToolOutcome.ok} into each
 * success struct so a client can discriminate on `ok`; a member that
 * discriminates another way (`found: true | false`) stays legal.
 *
 * @example
 * ```ts
 * import { ToolOutcome } from "@effected/mcp"
 * import { Effect, Schema } from "effect"
 * import { Tool } from "effect/ai"
 *
 * const NotFound = ToolOutcome.error("GoalNotFound", { id: Schema.Number })
 * const Lookup = Tool.make("goal", {
 * 	parameters: Schema.Struct({ id: Schema.Number }),
 * 	success: ToolOutcome.envelope(Schema.Struct({ ...ToolOutcome.ok, goal: Goal }), [NotFound]),
 * })
 * // in the handler:
 * findGoal(id).pipe(
 * 	Effect.map((goal) => ({ ok: true as const, goal })),
 * 	ToolOutcome.catchAsEnvelope({
 * 		GoalNotFound: (e) => ({ id: e.id, message: `No goal ${e.id}.`, remediation: { hint: "List goals first.", suggestedTool: "goal" } }),
 * 	}),
 * )
 * ```
 *
 * @public
 */
export class ToolOutcome {
	private constructor() {}

	/** `{ ok: true }` as schema fields, to spread into each success member. */
	static readonly ok = {
		ok: Schema.Literal(true).annotate({ description: "true: the call succeeded." }),
	} as const;

	/**
	 * The schema of one envelope error: `_tag`, {@link ToolFailure.fields} and
	 * `fields`. A field named `_tag`, `message` or `remediation` is rejected by
	 * the type, because it would replace the shared one.
	 */
	static readonly error = <const Tag extends string, const Fields extends Schema.Struct.Fields = Record<never, never>>(
		tag: Tag,
		fields?: Fields & { readonly [K in "_tag" | "message" | "remediation"]?: never },
	): Schema.Struct<{ readonly _tag: Schema.Literal<Tag> } & typeof ToolFailure.fields & Fields> =>
		Schema.Struct({
			_tag: Schema.Literal(tag).annotate({ description: "The error's tag: the value to branch on." }),
			...ToolFailure.fields,
			...(fields as Fields),
		});

	/**
	 * A tool's success schema: `success`, or `{ ok: false, error }` where `error`
	 * is one of `errors`. Object-rooted with {@link ToolOutputSchema.objectRooted},
	 * so core serves its `outputSchema` on every protocol revision.
	 *
	 * @remarks
	 * The failure member, its `ok` and its `error` carry default descriptions.
	 * `options` names the member (`identifier`, served once under `$defs`) or
	 * replaces its description.
	 */
	static readonly envelope = <S extends Schema.Top, const Errors extends ReadonlyArray<Schema.Top>>(
		success: S,
		errors: Errors,
		options?: ToolOutcomeEnvelopeOptions,
	): Schema.Union<
		readonly [S, Schema.Struct<{ readonly ok: Schema.Literal<false>; readonly error: Schema.Union<Errors> }>]
	> =>
		ToolOutputSchema.objectRooted(
			Schema.Union([
				success,
				Schema.Struct({
					ok: Schema.Literal(false).annotate({
						description: "false: the call hit an expected error, described in error.",
					}),
					error: Schema.Union(errors).annotate({ description: "The expected error. Branch on its _tag." }),
				}).annotate({
					description:
						options?.description ?? "An expected error the caller should branch on, returned in place of a result.",
					...(options?.identifier === undefined ? {} : { identifier: options.identifier }),
				}),
			] as const),
		);

	/** One `ok: false` value, for a handler that decides on a failure without catching an error. */
	static readonly failure = <const Tag extends string, const I extends ToolOutcomeErrorInput>(
		tag: Tag,
		error: I,
	): ToolOutcomeFailure<Tag, I> => ({ ok: false, error: { ...error, _tag: tag } });

	/**
	 * Turns each handled tagged error into its `ok: false` value on the success
	 * channel; every other error stays in the error channel. Typed like core's
	 * `Effect.catchTags`: a case for a tag the effect cannot fail with is a type
	 * error, and the handled tags leave `E`.
	 *
	 * @remarks
	 * Write it inline in the effect's `pipe`. `E` is inferred from the effect
	 * being piped, so `effect.pipe(ToolOutcome.catchAsEnvelope({ … }))` checks
	 * every case name against the effect's real tags. Bound to a `const` first,
	 * the combinator never sees that effect: `E` infers as `unknown`, the
	 * unknown-tag check switches off, and a misspelled tag compiles and never
	 * matches. Core's `catchTags` looks a case up only among `cases`' own keys,
	 * so an error tagged `"toString"` or `"constructor"` never hits an inherited
	 * `Object.prototype` member and stays in the error channel.
	 */
	static readonly catchAsEnvelope =
		<
			E,
			Cases extends {
				[K in Extract<E, { readonly _tag: string }>["_tag"]]+?: (
					error: Extract<E, { readonly _tag: K }>,
				) => ToolOutcomeErrorInput;
			} & (unknown extends E
				? Record<never, never>
				: { [K in Exclude<keyof Cases, Extract<E, { readonly _tag: string }>["_tag"]>]: never }),
		>(
			cases: Cases,
		) =>
		<A, R>(
			self: Effect.Effect<A, E, R>,
		): Effect.Effect<A | ToolOutcomeFailures<Cases>, Exclude<E, { readonly _tag: keyof Cases }>, R> => {
			const handlers: Record<string, (error: { readonly _tag: string }) => Effect.Effect<ToolOutcomeFailures<Cases>>> =
				{};
			for (const [tag, handle] of Object.entries(cases as Record<string, (error: never) => ToolOutcomeErrorInput>)) {
				handlers[tag] = (error) =>
					Effect.succeed(ToolOutcome.failure(tag, handle(error as never)) as ToolOutcomeFailures<Cases>);
			}
			return Effect.catchTags(self as Effect.Effect<A, { readonly _tag: string }, R>, handlers) as Effect.Effect<
				A | ToolOutcomeFailures<Cases>,
				Exclude<E, { readonly _tag: keyof Cases }>,
				R
			>;
		};

	/**
	 * Whether `value` is an `ok: false` envelope member: an object whose `ok` is
	 * exactly `false`. A success member that discriminates some other way, or a
	 * non-object, is not a failure. Narrows to `{ ok: false }` only: it checks
	 * the discriminant, not the `error` payload.
	 */
	static readonly isFailure = (value: unknown): value is { readonly ok: false } =>
		typeof value === "object" && value !== null && (value as { readonly ok?: unknown }).ok === false;
}

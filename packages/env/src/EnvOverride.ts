import { Config, Effect, Option } from "effect";
import type { AudienceKind } from "./Audience.js";
import { Audience } from "./Audience.js";

/**
 * Reads an environment variable that picks a mode within an audience.
 *
 * @remarks
 * The kit never learns a consumer's literals: the caller passes, per audience, the values it accepts. See
 * `okf/modules/env.md`.
 *
 * @public
 */
export class EnvOverride {
	private constructor() {}

	/**
	 * Read `options.envVar` and say what happened, without logging.
	 *
	 * @remarks
	 * `accepted` is the literal the current audience accepts (matching is case-insensitive and yields the
	 * literal), `rejected` is a set value it does not, with the value as written, the audience and the literals
	 * that audience accepts, so the caller owns the wording, the stream and any once-per-run dedupe. Unset and
	 * empty are neither. At most one of the two is `Some`. {@link EnvOverride.read} is the logging convenience.
	 *
	 * @param options - `envVar` is the variable; `accepts` lists, per audience, the literals it accepts
	 */
	static readResult<const M extends Record<AudienceKind, ReadonlyArray<string>>>(options: {
		readonly envVar: string;
		readonly accepts: M;
	}): Effect.Effect<
		{
			readonly audience: AudienceKind;
			readonly accepted: Option.Option<M[AudienceKind][number]>;
			readonly rejected: Option.Option<{
				readonly value: string;
				readonly audience: AudienceKind;
				readonly accepts: ReadonlyArray<string>;
			}>;
		},
		never,
		Audience
	> {
		return Effect.gen(function* () {
			const { kind } = yield* Audience;
			const raw = yield* Config.option(Config.String(options.envVar)).pipe(
				Effect.orElseSucceed(() => Option.none<string>()),
			);
			if (Option.isNone(raw) || raw.value === "") {
				return { audience: kind, accepted: Option.none(), rejected: Option.none() };
			}
			const accepts: ReadonlyArray<string> = options.accepts[kind];
			const match = accepts.find((literal) => literal.toLowerCase() === raw.value.toLowerCase());
			if (match !== undefined) {
				return { audience: kind, accepted: Option.some(match as M[AudienceKind][number]), rejected: Option.none() };
			}
			return {
				audience: kind,
				accepted: Option.none(),
				rejected: Option.some({ value: raw.value, audience: kind, accepts }),
			};
		});
	}

	/**
	 * Read `options.envVar` and accept it only when the current audience accepts it.
	 *
	 * @remarks
	 * Matching is case-insensitive and yields the accepted literal, so the result narrows to the union of every
	 * audience's literals. An unset or empty variable is `None`. A value the current audience does not accept logs
	 * one warning through `Effect.logWarning`, naming the accepted values, and is `None`; it never fails the run.
	 * The warning is once per read, so reading again warns again. It goes through `Effect.logWarning`, and Effect's
	 * default logger writes to stdout unless `References.LogToStderr` is set: an MCP server or any stdio-sensitive
	 * host must route logs to stderr (the `cli` package's `CliLogger` does).
	 *
	 * @param options - `envVar` is the variable; `accepts` lists, per audience, the literals it accepts
	 */
	static read<const M extends Record<AudienceKind, ReadonlyArray<string>>>(options: {
		readonly envVar: string;
		readonly accepts: M;
	}): Effect.Effect<Option.Option<M[AudienceKind][number]>, never, Audience> {
		return Effect.gen(function* () {
			const { accepted, rejected } = yield* EnvOverride.readResult(options);
			if (Option.isSome(rejected)) {
				const { value, audience, accepts } = rejected.value;
				yield* Effect.logWarning(
					`${options.envVar}=${value} is not accepted for the ${audience} audience (accepts ${accepts.join("|")}); ignoring it`,
				);
			}
			return accepted;
		});
	}
}

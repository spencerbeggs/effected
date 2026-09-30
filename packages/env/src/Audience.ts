import { Config, Context, Effect, Layer, Option } from "effect";
import type { RuntimeEnv } from "./RuntimeEnv.js";
import { CurrentRuntimeEnv } from "./RuntimeEnv.js";

/**
 * Who the output is for: a person at a terminal, an AI agent, or a CI job.
 *
 * @public
 */
export type AudienceKind = "human" | "agent" | "ci";

/**
 * The shape of the {@link Audience} service: one immutable value.
 *
 * @public
 */
export interface AudienceShape {
	/** Who the output is for. */
	readonly kind: AudienceKind;
	/**
	 * Whether the override environment variable decided the kind, so a layer stacked on top (a CLI flag) knows
	 * whether the variable already spoke.
	 */
	readonly source: "override" | "detected";
}

const KINDS: ReadonlyArray<AudienceKind> = ["human", "agent", "ci"];

/**
 * Who the output is for, decided once.
 *
 * @remarks
 * Precedence: a valid override environment variable, then an agent, then CI, then a human, so an agent inside a
 * CI job gets agent output. A human typing a command inside an agent-detected shell is still detected as an
 * agent, never refused: the override variable flips it back. The shape is one immutable value, so the service is
 * provided with `Layer.succeed` and there is no `Layer.mock` to reach for. See `okf/modules/env.md`.
 *
 * @public
 */
export class Audience extends Context.Service<Audience, AudienceShape>()("@effected/env/Audience") {
	/**
	 * Decide the audience from `CurrentRuntimeEnv`, and from the override variable named by `options.envVar`.
	 *
	 * @remarks
	 * The variable is read through `Config`, lower-cased and matched against `human`, `agent` and `ci`. An empty
	 * or absent variable is unset. An invalid value logs one warning through `Effect.logWarning` and falls back to
	 * detection; it never fails the run. That warning is once per layer build, so building the layer a second time
	 * warns again. Without `options.envVar` the audience is always detected. A layer-returning function mints a
	 * fresh layer per call: call it once and bind the result to a constant.
	 *
	 * @param options - `envVar` names the override variable
	 */
	static layer(options?: { readonly envVar?: string }): Layer.Layer<Audience, never, CurrentRuntimeEnv> {
		return Layer.effect(
			Audience,
			Effect.gen(function* () {
				const runtimeEnv = yield* CurrentRuntimeEnv;
				const detected: AudienceShape = { kind: Audience.detect(runtimeEnv), source: "detected" };
				const envVar = options?.envVar;
				if (envVar === undefined) return detected;

				const raw = yield* Config.option(Config.String(envVar)).pipe(Effect.orElseSucceed(() => Option.none<string>()));
				if (Option.isNone(raw) || raw.value === "") return detected;

				const value = raw.value.toLowerCase();
				const kind = KINDS.find((candidate) => candidate === value);
				if (kind !== undefined) return { kind, source: "override" } satisfies AudienceShape;

				yield* Effect.logWarning(`${envVar}=${raw.value} is not one of ${KINDS.join("|")}; ignoring it`);
				return detected;
			}),
		);
	}

	/**
	 * A fixed audience that touches neither `CurrentRuntimeEnv` nor `Config`.
	 *
	 * @remarks
	 * `source` defaults to `override`, since a test that fixes the kind has decided it. Pass `detected` to test a
	 * layer stacked on top, such as a CLI flag that only applies when the environment variable did not decide.
	 *
	 * @param kind - the audience to fix
	 * @param source - whether the override variable or detection decided it; defaults to `override`
	 */
	static readonly layerTest = (
		kind: AudienceKind,
		source: AudienceShape["source"] = "override",
	): Layer.Layer<Audience> => Layer.succeed(Audience, { kind, source });

	/**
	 * The audience a {@link RuntimeEnv} implies, ignoring any override: an agent, else CI, else a human.
	 *
	 * @param env - the runtime snapshot to decide from
	 */
	static readonly detect = (env: RuntimeEnv): AudienceKind =>
		Option.isSome(env.agent) ? "agent" : Option.isSome(env.ci) ? "ci" : "human";
}

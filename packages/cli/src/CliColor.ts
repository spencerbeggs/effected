import { Config, Effect, Layer, Option, Stdio } from "effect";
import { CliOutput } from "effect/unstable/cli";

const noColor = Config.option(Config.String("NO_COLOR"));

/**
 * Whether a CLI's output should carry ANSI colour, decided once and shared by
 * everything that renders — help text, error output, and any rendered result.
 *
 * @remarks
 * Follows the no-color.org rule: colour is off when stdout is not a
 * terminal, or when `NO_COLOR` is set to any **non-empty** value — an empty
 * `NO_COLOR=""` does not disable colour. `FORCE_COLOR` is ignored, matching
 * core's own formatter. The environment is read through the ambient
 * `ConfigProvider`, never `process`, so a test swaps it with
 * `Effect.provideService(ConfigProvider.ConfigProvider, ...)`. The kit's
 * default providers (`fromEnv`, `fromUnknown`) already treat an empty
 * `NO_COLOR` as unset, so the explicit `set === ""` check exists for a
 * provider constructed with `{ preserveEmptyStrings: true }`.
 *
 * @public
 */
export class CliColor {
	private constructor() {}

	/**
	 * The decision, for passing to a pure renderer as a plain boolean.
	 *
	 * @public
	 */
	static readonly enabled: Effect.Effect<boolean, never, Stdio.Stdio> = Effect.gen(function* () {
		const stdio = yield* Stdio.Stdio;
		if (!(yield* stdio.stdoutIsTerminal)) return false;
		const value = yield* noColor.pipe(Effect.orElseSucceed(() => Option.none<string>()));
		return Option.match(value, { onNone: () => true, onSome: (set) => set === "" });
	});

	/**
	 * Core's default `CliOutput.Formatter`, coloured by the same decision as
	 * {@link CliColor.enabled}, so help text, parse errors and rendered
	 * output never disagree on whether colour is on.
	 *
	 * @remarks
	 * `overrides` replaces individual methods of the default formatter — for
	 * example `formatVersion`, to append a "via `<carrier>`" line without
	 * losing the other defaults. Each call mints a fresh layer; bind the
	 * result to a `const` or the decision is re-read every time it is
	 * provided.
	 *
	 * The `never` in its output does not mean it installs nothing.
	 * `CliOutput.Formatter` is a `Context.Reference`, whose key type is
	 * `never`, so this layer sets the formatter reference rather than
	 * providing a service. Every command it is provided to renders with the
	 * formatter it sets, and without it they fall back to core's default
	 * formatter.
	 *
	 * @public
	 */
	static readonly formatterLayer = (
		overrides: Partial<CliOutput.Formatter> = {},
	): Layer.Layer<never, never, Stdio.Stdio> =>
		Layer.unwrap(
			Effect.map(CliColor.enabled, (colors) =>
				CliOutput.layer({ ...CliOutput.defaultFormatter({ colors }), ...overrides }),
			),
		);
}

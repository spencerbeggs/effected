import { Config, Effect, Option } from "effect";
import type { Env } from "./types.js";

/**
 * Read a fixed key set from the ambient `ConfigProvider` into a plain {@link Env} record.
 *
 * @remarks
 * A key that is absent, or whose read fails for any reason, is left out of the record, so the record carries
 * `Some` values only. The default providers drop empty strings, so an empty variable reads as absent.
 *
 * @internal
 */
export const readEnv = (keys: ReadonlyArray<string>): Effect.Effect<Env> =>
	Effect.forEach(keys, (key) =>
		Config.option(Config.String(key)).pipe(
			Effect.orElseSucceed(() => Option.none<string>()),
			Effect.map((value) => [key, value] as const),
		),
	).pipe(
		Effect.map((entries) =>
			Object.fromEntries(entries.flatMap(([key, value]) => (Option.isSome(value) ? [[key, value.value]] : []))),
		),
	);

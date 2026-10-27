import type { ConfigProvider } from "effect";
import { Config, Effect, Option } from "effect";
import type { Env } from "./types.js";

/**
 * Drop an absent or empty value from a plain record, so it carries non-empty values only: the normalisation
 * {@link readEnv} applies to what it reads, for a record a caller already holds.
 *
 * @internal
 */
export const normalizeEnv = (record: Env): Env =>
	Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== ""));

/**
 * Read a fixed key set from the ambient `ConfigProvider` into a plain {@link Env} record.
 *
 * @remarks
 * A key that is absent, or whose read fails for any reason, is left out of the record, so the record carries
 * non-empty values only. An empty string is normalized to absent here, under every provider, including one built
 * with `preserveEmptyStrings: true`, so `FORCE_COLOR=""` reads as unset whichever provider is ambient.
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
			Object.fromEntries(
				entries.flatMap(([key, value]) => (Option.isSome(value) && value.value !== "" ? [[key, value.value]] : [])),
			),
		),
	);

/**
 * Whether a record-or-provider source is the `ConfigProvider`: a record's values are strings, so a function-valued
 * `load` identifies a provider.
 *
 * @internal
 */
export const isProvider = (source: Env | ConfigProvider.ConfigProvider): source is ConfigProvider.ConfigProvider =>
	typeof (source as { readonly load?: unknown }).load === "function";

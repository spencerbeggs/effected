import type { Duration } from "effect";
import { Context } from "effect";

/**
 * Per-scope options applied to every `git` spawn a {@link Git} member makes
 * while they are in force. Install them for one effect with `Git.withRunOptions`,
 * or for a whole program with the `Git.layerRunOptions` layer.
 *
 * @remarks
 * - `env` is merged UNDER the service's own pins: the locale, prompt and
 *   askpass pins always win, and a per-call `GIT_SSH_COMMAND` is still
 *   pinned to batch mode on a network member. A per-call `GIT_SSH` and
 *   `GIT_SSH_VARIANT` take the same rungs as their ambient counterparts: the
 *   first declines the pin when no command decides, the second overrides the
 *   variant check.
 * - `config` becomes `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` /
 *   `GIT_CONFIG_VALUE_n` entries, in insertion order, appended after any
 *   `GIT_CONFIG_COUNT` entries already in force (the run options' own `env`,
 *   else the inherited environment), so those survive. A locating read that
 *   opts into `ignoreRepositoryEnv` unsets `GIT_CONFIG_COUNT` along with the
 *   rest of the repository environment, so `config` is dropped for those
 *   reads by design.
 * - `timeout` replaces the default per-run ceiling.
 *
 * @public
 */
export interface GitRunOptions {
	/** Extra environment variables for each spawn. */
	readonly env?: Readonly<Record<string, string>>;
	/** Extra `-c`-style config entries, passed through the environment. */
	readonly config?: Readonly<Record<string, string>>;
	/** Replaces the per-run timeout. */
	readonly timeout?: Duration.Input;
}

/** The ambient run options. Internal: read inside the spawn choke point. */
export const CurrentRunOptions = Context.Reference<GitRunOptions>("@effected/git/GitRunOptions", {
	defaultValue: () => ({}),
});

/** Merges `inner` over `outer`: `env` and `config` key by key, `timeout` inner wins. */
export const mergeRunOptions = (outer: GitRunOptions, inner: GitRunOptions): GitRunOptions => {
	const env = outer.env === undefined && inner.env === undefined ? undefined : { ...outer.env, ...inner.env };
	const config =
		outer.config === undefined && inner.config === undefined ? undefined : { ...outer.config, ...inner.config };
	const timeout = inner.timeout ?? outer.timeout;
	return {
		...(env === undefined ? {} : { env }),
		...(config === undefined ? {} : { config }),
		...(timeout === undefined ? {} : { timeout }),
	};
};

/** A `GIT_CONFIG_COUNT` value as git reads it: a non-negative integer, anything else none. */
export const configCount = (value: string | undefined): number => {
	const count = value === undefined ? Number.NaN : Number(value.trim());
	return Number.isSafeInteger(count) && count > 0 ? count : 0;
};

/**
 * The `GIT_CONFIG_COUNT` environment spelling of a config record, appended after the `inherited` entries already in
 * force (an inherited `GIT_CONFIG_COUNT`), so an inherited runtime config such as an auth header survives. Later
 * entries win in git, so the scoped values still take precedence.
 */
export const configEnv = (
	config: Readonly<Record<string, string>> | undefined,
	inherited = 0,
): Record<string, string> => {
	const entries = Object.entries(config ?? {});
	if (entries.length === 0) return {};
	const out: Record<string, string> = { GIT_CONFIG_COUNT: String(inherited + entries.length) };
	entries.forEach(([key, value], index) => {
		out[`GIT_CONFIG_KEY_${inherited + index}`] = key;
		out[`GIT_CONFIG_VALUE_${inherited + index}`] = value;
	});
	return out;
};

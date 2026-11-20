import type { Duration } from "effect";
import { Context } from "effect";

/**
 * Per-scope options applied to every `git` spawn a {@link Git} member makes
 * while they are in force. Install them with `Git.withRunOptions`.
 *
 * @remarks
 * - `env` is merged UNDER the service's own pins: the locale, prompt and
 *   askpass pins always win, and a per-call `GIT_SSH_COMMAND` is still
 *   pinned to batch mode on a network member.
 * - `config` becomes `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` /
 *   `GIT_CONFIG_VALUE_n` entries, in insertion order. A locating read that
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

/** The `GIT_CONFIG_COUNT` environment spelling of a config record. */
export const configEnv = (config: Readonly<Record<string, string>> | undefined): Record<string, string> => {
	const entries = Object.entries(config ?? {});
	if (entries.length === 0) return {};
	const out: Record<string, string> = { GIT_CONFIG_COUNT: String(entries.length) };
	entries.forEach(([key, value], index) => {
		out[`GIT_CONFIG_KEY_${index}`] = key;
		out[`GIT_CONFIG_VALUE_${index}`] = value;
	});
	return out;
};

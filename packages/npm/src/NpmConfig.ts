import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Redacted, Result, Schema } from "effect";
import * as Base64 from "effect/encoding/Base64";
import { nerfDartKeys } from "./internal/nerfDartKeys.js";
import type { RegistryTarget } from "./NpmRegistry.js";
import { DEFAULT_REGISTRY } from "./NpmRegistry.js";
import type { RegistryCredential } from "./RegistryCredential.js";
import { basicCredentialFromPairResult } from "./RegistryCredential.js";

/**
 * An npm configuration could not be loaded.
 *
 * @remarks
 * `reason` routes: `"missing-env"` — a credential value (`_authToken`,
 * `_auth`, `_password`) names an environment variable the environment does not
 * set, so the credential it describes does not exist (`variable` names it,
 * `path` names the file); `"read"` — an npmrc file exists but could not be
 * read (`path`, with the platform failure as `cause`). A missing file is not an
 * error: npm skips it, and so does {@link NpmConfig.load}.
 *
 * The message never carries a value from the file or the environment, only
 * key, variable and path names, because the values this error is about are
 * credentials.
 *
 * @public
 */
export class NpmConfigError extends Schema.TaggedError<NpmConfigError>()("NpmConfigError", {
	/** Why the configuration could not be loaded. */
	reason: Schema.Literals(["missing-env", "read"]),
	/** The npmrc file involved, when there is one. */
	path: Schema.optionalKey(Schema.String),
	/** The unset environment variable, for `"missing-env"`. */
	variable: Schema.optionalKey(Schema.String),
	/** The config key whose value named it, for `"missing-env"`. */
	key: Schema.optionalKey(Schema.String),
	/** The underlying failure, for `"read"`. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const where = this.path === undefined ? "the environment" : this.path;
		return this.reason === "missing-env"
			? `npm config ${this.key ?? "value"} in ${where} names environment variable ${this.variable ?? "(unknown)"}, which is not set`
			: `Could not read npm config file ${where}`;
	}
}

/**
 * One npmrc layer for {@link NpmConfig.fromSourcesResult}: the file's text and,
 * for error messages, where it came from.
 *
 * @public
 */
export interface NpmConfigSource {
	/** The npmrc text. */
	readonly text: string;
	/** Where it was read from; named in errors and recorded in `NpmConfig.files`. */
	readonly path?: string | undefined;
}

/**
 * Options for {@link NpmConfig.load}.
 *
 * @public
 */
export interface NpmConfigLoadOptions {
	/**
	 * Where the project lookup starts — npm's working directory. The project
	 * npmrc is `.npmrc` in the nearest directory at or above it holding a
	 * `package.json` or a `node_modules`, else in this directory.
	 */
	readonly cwd: string;
	/**
	 * The environment, as a plain record (pass `process.env` at the edge). Read
	 * for `npm_config_*` settings, `${VAR}` substitution and `HOME`.
	 */
	readonly env: Readonly<Record<string, string | undefined>>;
	/**
	 * The home directory for the user npmrc (`~/.npmrc`). Defaults to
	 * `env.HOME`, then `env.USERPROFILE`; with neither, and no `userconfig`
	 * setting, no user npmrc is read.
	 */
	readonly home?: string | undefined;
	/**
	 * npm's global prefix, whose `etc/npmrc` is the global npmrc. A `prefix`
	 * setting in the environment or a higher npmrc wins over it. With neither,
	 * and no `globalconfig` setting, no global npmrc is read — this package does
	 * not guess the prefix from the running Node binary.
	 */
	readonly globalPrefix?: string | undefined;
}

/** npm's `${VAR}` / `${VAR?}` expression, with backslash escapes (`@npmcli/config`'s `env-replace`). */
const ENV_EXPRESSION = /(?<!\\)(\\*)\$\{([^${}?]+)(\?)?\}/g;

/**
 * Whether a key holds a secret: its last `:`-segment is a credential field, or
 * an inline client key or certificate (`key`, `cert`, PEM text in the npmrc).
 */
const isSecretKey = (key: string): boolean => {
	const field = key.slice(key.lastIndexOf(":") + 1);
	return field === "_authToken" || field === "_auth" || field === "_password" || field === "key" || field === "cert";
};

/** A URL's `scheme://` and the userinfo (`user:pass@`) of its authority, up to the authority's last `@`. */
const URL_USERINFO = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/?#]*@/;

/**
 * A URL-valued setting with its userinfo removed, or `undefined` when it
 * carries none. Textual, so the rest of the value is kept exactly as written.
 */
const withoutUserinfo = (value: string): string | undefined =>
	URL_USERINFO.test(value) ? value.replace(URL_USERINFO, "$1") : undefined;

/**
 * npm's env substitution: `${VAR}` is replaced, `${VAR?}` is replaced or
 * emptied, an unset `${VAR}` is left as written, and an odd run of
 * backslashes escapes the expression. Returns the unset variables too.
 */
const substitute = (
	text: string,
	env: Readonly<Record<string, string | undefined>>,
): { readonly value: string; readonly missing: ReadonlyArray<string> } => {
	const missing: Array<string> = [];
	const value = text.replace(ENV_EXPRESSION, (original, escapes: string, name: string, optional?: string) => {
		if (escapes.length % 2 === 1) return original.slice((escapes.length + 1) / 2);
		const found = Object.hasOwn(env, name) ? env[name] : undefined;
		if (found === undefined && optional !== "?") missing.push(name);
		return escapes.slice(escapes.length / 2) + (found ?? (optional === "?" ? "" : `\${${name}}`));
	});
	return { value, missing };
};

/** An unquoted ini value: stops at an unescaped `;` or `#`, as the `ini` package npm uses does. */
const unquoted = (raw: string): string => {
	let out = "";
	for (let index = 0; index < raw.length; index++) {
		const char = raw[index] as string;
		if (char === "\\" && index + 1 < raw.length && ";#\\".includes(raw[index + 1] as string)) {
			out += raw[index + 1];
			index++;
			continue;
		}
		if (char === ";" || char === "#") break;
		out += char;
	}
	return out.trim();
};

/** An ini value, quoted (`"…"` decoded as JSON where it can be, `'…'` stripped) or not. */
const iniValue = (raw: string): string => {
	const value = raw.trim();
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(value);
			if (typeof parsed === "string") return parsed;
		} catch {
			// Not valid JSON: fall through to stripping the quotes.
		}
		return value.slice(1, -1);
	}
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
	return unquoted(value);
};

/**
 * Parses one npmrc's text into its key/value pairs, substituting `${VAR}`.
 *
 * @remarks
 * A `[section]` prefixes its keys with `section.`, which no setting this
 * module reads ever matches — npm does not read sections either. An array key
 * (`key[]=`) is skipped. A key with no `=` is `"true"`, as in `ini`. A
 * credential value naming an unset variable fails `"missing-env"`: npm would
 * send the literal `${VAR}` text as the token, which is never a credential.
 */
const parseNpmrc = (
	source: NpmConfigSource,
	env: Readonly<Record<string, string | undefined>>,
): Result.Result<ReadonlyArray<readonly [string, string]>, NpmConfigError> => {
	const pairs: Array<readonly [string, string]> = [];
	let section = "";
	for (const rawLine of source.text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
		const header = /^\[([^\]]*)\]$/.exec(line);
		if (header !== null) {
			section = (header[1] as string).trim();
			continue;
		}
		const equals = line.indexOf("=");
		const rawKey = (equals === -1 ? line : line.slice(0, equals)).trim();
		if (rawKey === "" || rawKey.endsWith("[]")) continue;
		const key = substitute(iniValue(rawKey), env).value;
		const fullKey = section === "" ? key : `${section}.${key}`;
		const rawValue = equals === -1 ? "true" : iniValue(line.slice(equals + 1));
		const { value, missing } = substitute(rawValue, env);
		if (isSecretKey(fullKey) && missing.length > 0) {
			return Result.fail(
				new NpmConfigError({
					reason: "missing-env",
					variable: missing[0] as string,
					key: fullKey,
					...(source.path === undefined ? {} : { path: source.path }),
				}),
			);
		}
		pairs.push([fullKey, value]);
	}
	return Result.succeed(pairs);
};

/**
 * The `npm_config_*` layer: case-insensitive prefix, an empty value skipped,
 * and — except for a nerf-darted `//host/:key` — `_` after the first character
 * read as `-` and the key lowercased, as `@npmcli/config` does.
 */
const envLayer = (env: Readonly<Record<string, string | undefined>>): string => {
	const lines: Array<string> = [];
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined || value === "" || !/^npm_config_/i.test(name)) continue;
		let key = name.slice("npm_config_".length);
		if (!key.startsWith("//")) key = key.replace(/(?!^)_/g, "-").toLowerCase();
		// Re-serialized so the one parser applies the one substitution rule.
		lines.push(`${key}=${JSON.stringify(value)}`);
	}
	return lines.join("\n");
};

/**
 * The npm configuration a registry read needs: the default and scoped
 * registries and per-registry credentials, resolved from npmrc files and the
 * environment the way the npm CLI resolves them.
 *
 * @remarks
 * Build one with {@link NpmConfig.load} (reads the project, user and global
 * npmrc through `FileSystem`) or {@link NpmConfig.fromSourcesResult} (from text
 * you already hold), then hand {@link NpmConfig.targetFor}'s answer to
 * `NpmRegistry`, which sends the credential the established way:
 *
 * ```ts
 * registry.distTags(name, config.targetFor(name))
 * ```
 *
 * **A credential only ever goes to the host it was configured for.**
 * `credentialFor(url)` looks a credential up by the URL being requested, as
 * npm does: the nerf-dart key (`//host[:port]/path/`) of that URL, walked up
 * through its parent paths to `//host[:port]/` and never further. A scoped
 * registry on another host, a lookalike host (`registry.npmjs.org.evil.dev`),
 * another port, or a tarball URL on a CDN therefore gets no credential unless
 * one is configured for that host itself. An unscoped top-level `_authToken`
 * or `_auth` names no host, so it is never used (npm refuses it too).
 * An empty path segment is a level of its own, as in npm: a tarball at
 * `https://host//pkg/-/pkg-1.0.0.tgz` (the shape Artifactory and Nexus emit)
 * tries `//host//pkg/-/`, `//host//pkg/`, `//host//` and then `//host/`, so a
 * credential configured for the host is still found.
 *
 * **A credential only ever goes over `https:`, unless the configuration chose
 * `http:` for that host.** This is a deliberate departure from npm, which
 * matches the nerf-dart key and ignores the scheme, so it sends a registry's
 * token to `http://` (or `ws://`) on the same host in cleartext. Here an
 * `http:` URL gets a credential only when a configured registry (`registry`
 * or an `@scope:registry`) names that same host and port with an `http:`
 * URL, which is an explicit choice in the config (a local Verdaccio on
 * `http://localhost:4873/`, say). Every other scheme gets none.
 *
 * Precedence, highest first: `npm_config_*` environment variables, the
 * project npmrc, the user npmrc, the global npmrc. `${VAR}` and `${VAR?}`
 * substitute from the environment in keys and values. **Not supported**:
 * command-line flags, npm's builtin npmrc, workspace-root project discovery
 * (the project is the nearest `package.json` or `node_modules` directory),
 * client certificates (`certfile`/`keyfile`), `always-auth`, and the
 * deprecated unscoped credentials.
 *
 * Credentials are held as `Redacted` values, so logging or serializing a
 * config prints `<redacted>` for them. So are an inline client `key` or
 * `cert` (PEM text written into the npmrc), and any userinfo in a URL-valued
 * setting (`registry=https://user:pass@host/`): the setting keeps the URL
 * without it, and the value as written is held in `secrets` under the same
 * key. Userinfo is not sent as a credential; configure `_auth` for that host.
 *
 * @example
 * ```ts
 * import { NpmConfig, NpmRegistry } from "@effected/npm";
 * import { Effect } from "effect";
 *
 * const latest = (name: string) =>
 *   Effect.gen(function* () {
 *     const config = yield* NpmConfig.load({ cwd: process.cwd(), env: process.env });
 *     const registry = yield* NpmRegistry;
 *     const tags = yield* registry.distTags(name, config.targetFor(name));
 *     return tags.latest;
 *   });
 * ```
 *
 * @public
 */
export class NpmConfig extends Schema.Class<NpmConfig>("NpmConfig")({
	/** Every non-credential setting, after precedence and substitution. */
	settings: Schema.Record(Schema.String, Schema.String),
	/**
	 * Every secret setting, redacted: `_authToken`, `_auth`, `_password`,
	 * an inline `key` or `cert`, and the as-written value of any URL setting
	 * whose userinfo was removed from `settings`.
	 */
	secrets: Schema.Record(Schema.String, Schema.Redacted(Schema.String)),
	/** The npmrc files that were read, lowest precedence first. */
	files: Schema.Array(Schema.String),
}) {
	/** The default registry: the `registry` setting, else the public registry. */
	get registry(): string {
		return Object.hasOwn(this.settings, "registry") ? (this.settings.registry as string) : DEFAULT_REGISTRY;
	}

	/**
	 * The registry a package is read from: its scope's `@scope:registry`
	 * setting for a scoped name, else {@link NpmConfig.registry}.
	 */
	registryFor(name: string): string {
		if (name.startsWith("@") && name.includes("/")) {
			const key = `${name.slice(0, name.indexOf("/"))}:registry`;
			if (Object.hasOwn(this.settings, key)) return this.settings[key] as string;
		}
		return this.registry;
	}

	/**
	 * The credential npm would send with a request to `url`, or `None`.
	 *
	 * @remarks
	 * Looked up by the request URL's own host, port and path (see the class
	 * remarks): never another host's credential. Within the matched key,
	 * `_authToken` wins over `_auth`, which wins over `username` + `_password`
	 * (decoded from base64, as npm stores it) — npm's order. An unparseable URL
	 * has no credential, and neither does any scheme but `https:`, or `http:`
	 * to a host a configured registry names with an `http:` URL.
	 */
	credentialFor(url: string): Option.Option<RegistryCredential> {
		if (!this.allowsScheme(url)) return Option.none();
		const keys = nerfDartKeys(url);
		if (keys === undefined) return Option.none();
		for (const key of keys) {
			const token = this.secret(`${key}:_authToken`);
			if (token !== undefined) return Option.some({ kind: "token", token });
			const auth = this.secret(`${key}:_auth`);
			if (auth !== undefined) return Option.some({ kind: "basic", encoded: auth });
			const username = Object.hasOwn(this.settings, `${key}:username`) ? this.settings[`${key}:username`] : undefined;
			const password = this.secret(`${key}:_password`);
			if (username !== undefined && password !== undefined) {
				const decoded = Base64.decodeString(Redacted.value(password));
				if (Result.isFailure(decoded)) continue;
				const pair = basicCredentialFromPairResult(username, Redacted.make(decoded.success));
				if (Result.isSuccess(pair)) return Option.some(pair.success);
			}
		}
		return Option.none();
	}

	/**
	 * The `NpmRegistry` target for a package: {@link NpmConfig.registryFor} and
	 * the credential for that registry's URL for the package, if any.
	 *
	 * @remarks
	 * The credential is looked up for the package's own request URL, which is
	 * what npm does, so a token scoped to a registry path
	 * (`//npm.pkg.github.com/acme/:_authToken`) is found for a registry
	 * configured without a trailing slash.
	 */
	targetFor(name: string): RegistryTarget {
		const registry = this.registryFor(name);
		const base = registry.endsWith("/") ? registry.slice(0, -1) : registry;
		const credential = this.credentialFor(`${base}/${encodeURIComponent(name)}`);
		return Option.isSome(credential) ? { registry, credential: credential.value } : { registry };
	}

	/**
	 * Whether a credential may travel to `url` at all: `https:` always,
	 * `http:` only to a host and port a configured registry names with an
	 * `http:` URL, any other scheme never.
	 */
	private allowsScheme(url: string): boolean {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return false;
		}
		if (parsed.protocol === "https:") return true;
		if (parsed.protocol !== "http:") return false;
		for (const [key, value] of Object.entries(this.settings)) {
			if (key !== "registry" && !key.endsWith(":registry")) continue;
			try {
				const registry = new URL(value);
				if (registry.protocol === "http:" && registry.host === parsed.host) return true;
			} catch {
				// An unparseable registry opens nothing.
			}
		}
		return false;
	}

	private secret(key: string): Redacted.Redacted<string> | undefined {
		return Object.hasOwn(this.secrets, key) ? this.secrets[key] : undefined;
	}

	/**
	 * Resolves a configuration from npmrc texts and the environment, with no IO.
	 *
	 * @remarks
	 * `sources` are lowest precedence first (global, user, project); the
	 * environment's `npm_config_*` settings apply on top of all of them. Fails
	 * `"missing-env"` when a credential names an unset variable.
	 *
	 * @param sources - npmrc layers, lowest precedence first.
	 * @param env - The environment, for `npm_config_*` and `${VAR}`.
	 */
	static fromSourcesResult(
		sources: ReadonlyArray<NpmConfigSource>,
		env: Readonly<Record<string, string | undefined>>,
	): Result.Result<NpmConfig, NpmConfigError> {
		const settings: Record<string, string> = {};
		const secrets: Record<string, Redacted.Redacted<string>> = {};
		const files: Array<string> = [];
		for (const source of [...sources, { text: envLayer(env) }]) {
			const parsed = parseNpmrc(source, env);
			if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
			if (source.path !== undefined) files.push(source.path);
			for (const [key, value] of parsed.success) {
				// Own data properties only: a `__proto__` key in an npmrc must not
				// reach the prototype of either map.
				const define = (target: Record<string, unknown>, stored: unknown) =>
					Object.defineProperty(target, key, { value: stored, writable: true, enumerable: true, configurable: true });
				// A later layer replaces the key in both maps, so a lower layer's
				// userinfo cannot outlive the URL that carried it.
				delete secrets[key];
				delete settings[key];
				if (isSecretKey(key)) {
					define(secrets, Redacted.make(value));
					continue;
				}
				// URL userinfo (`https://user:pass@host/`) is a password in the
				// clear: the setting keeps the URL without it, and the value as
				// written is held redacted under the same key.
				const stripped = withoutUserinfo(value);
				if (stripped !== undefined) define(secrets, Redacted.make(value));
				define(settings, stripped ?? value);
			}
		}
		return Result.succeed(NpmConfig.make({ settings, secrets, files }));
	}

	/**
	 * Loads the configuration npm would use from `options.cwd`: the project,
	 * user and global npmrc and the environment.
	 *
	 * @remarks
	 * The project npmrc is `.npmrc` in the nearest directory at or above `cwd`
	 * holding a `package.json` or a `node_modules`; the user npmrc is the
	 * `userconfig` setting or `~/.npmrc`; the global npmrc is the
	 * `globalconfig` setting or `<prefix>/etc/npmrc` (see
	 * {@link NpmConfigLoadOptions.globalPrefix}). A path setting starting `~/`
	 * resolves against the home directory. A file that does not exist is
	 * skipped; one that cannot be read fails `"read"`. Every file is read once,
	 * even when two layers name the same path.
	 *
	 * @param options - See {@link NpmConfigLoadOptions}.
	 */
	static readonly load = Effect.fn("NpmConfig.load")(function* (options: NpmConfigLoadOptions) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const env = options.env;
		const home = options.home ?? env.HOME ?? env.USERPROFILE;

		const read = (file: string): Effect.Effect<NpmConfigSource | undefined, NpmConfigError> =>
			fs.readFileString(file).pipe(
				Effect.map((text): NpmConfigSource | undefined => ({ text, path: file })),
				Effect.catchTag("PlatformError", (error: PlatformError.PlatformError) =>
					error.reason._tag === "NotFound"
						? Effect.succeed(undefined)
						: Effect.fail(new NpmConfigError({ reason: "read", path: file, cause: error })),
				),
			);
		const resolveSetting = (value: string, base: string): string =>
			value.startsWith("~/") && home !== undefined ? path.join(home, value.slice(2)) : path.resolve(base, value);
		const settingIn = (layers: ReadonlyArray<NpmConfigSource | undefined>, key: string): string | undefined => {
			for (const layer of layers) {
				if (layer === undefined) continue;
				const parsed = parseNpmrc(layer, env);
				if (Result.isFailure(parsed)) continue;
				// The last occurrence wins within a file, as in the merge.
				let found: string | undefined;
				for (const [name, value] of parsed.success) if (name === key) found = value;
				if (found !== undefined) return found;
			}
			return undefined;
		};

		// The project directory: npm's `localPrefix`.
		let projectDir = path.resolve(options.cwd);
		for (let dir = projectDir; ; ) {
			if (
				(yield* fs.exists(path.join(dir, "package.json")).pipe(Effect.orElseSucceed(() => false))) ||
				(yield* fs.exists(path.join(dir, "node_modules")).pipe(Effect.orElseSucceed(() => false)))
			) {
				projectDir = dir;
				break;
			}
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}

		const environment: NpmConfigSource = { text: envLayer(env) };
		const projectFile = path.join(projectDir, ".npmrc");
		const project = yield* read(projectFile);

		const userSetting = settingIn([environment, project], "userconfig");
		const userFile =
			userSetting !== undefined
				? resolveSetting(userSetting, projectDir)
				: home !== undefined
					? path.join(home, ".npmrc")
					: undefined;
		const user = userFile === undefined || userFile === projectFile ? undefined : yield* read(userFile);

		const globalSetting = settingIn([environment, project, user], "globalconfig");
		const prefix = settingIn([environment, project, user], "prefix") ?? options.globalPrefix;
		const globalFile =
			globalSetting !== undefined
				? resolveSetting(globalSetting, projectDir)
				: prefix !== undefined
					? path.join(resolveSetting(prefix, projectDir), "etc", "npmrc")
					: undefined;
		const global =
			globalFile === undefined || globalFile === projectFile || globalFile === userFile
				? undefined
				: yield* read(globalFile);

		const sources = [global, user, project].filter((source): source is NpmConfigSource => source !== undefined);
		return yield* Effect.fromResult(NpmConfig.fromSourcesResult(sources, env));
	});
}

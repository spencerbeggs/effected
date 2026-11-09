import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Redacted, Result, Schema } from "effect";
import * as Base64 from "effect/encoding/Base64";
import { nerfDartKeys } from "./internal/nerfDartKeys.js";
import type { RegistryTarget } from "./NpmRegistry.js";
import { DEFAULT_REGISTRY } from "./NpmRegistry.js";
import { parseNpmrc } from "./Npmrc.js";
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
	 * Where the project lookup starts — npm's working directory. By default the
	 * project npmrc is `.npmrc` in the nearest directory at or above it holding
	 * a `package.json` or a `node_modules`, else in this directory;
	 * {@link NpmConfigLoadOptions.projectDir} and
	 * {@link NpmConfigLoadOptions.workspaceRoot} change that.
	 */
	readonly cwd: string;
	/**
	 * The project directory, given outright: the project npmrc is
	 * `<projectDir>/.npmrc` and nothing is searched for. A relative path
	 * resolves against `cwd`. Wins over
	 * {@link NpmConfigLoadOptions.workspaceRoot} when both are set.
	 *
	 * @remarks
	 * For a caller that already knows its root (a workspace tool that found it
	 * once), so the npmrc it reads and the root it works in cannot differ.
	 */
	readonly projectDir?: string | undefined;
	/**
	 * Read the project npmrc at the workspace root rather than the nearest
	 * package, as pnpm does: the nearest directory at or above `cwd` holding a
	 * `pnpm-workspace.yaml`, or a `package.json` with a `workspaces` field (npm,
	 * yarn and bun workspaces). With no such directory the default lookup
	 * applies. Defaults to `false`.
	 *
	 * @remarks
	 * Without it, a program run from `packages/a` of a pnpm workspace reads
	 * `packages/a/.npmrc` (or none) and misses the root `.npmrc` that pnpm
	 * itself honours there — a scoped registry or token configured once at the
	 * root silently goes unused. The nearest marker wins, and a `workspaces`
	 * field is taken as a marker without matching its globs against `cwd`
	 * (npm checks that `cwd` is one of the root's workspaces; this does not).
	 * A `package.json` that cannot be read or parsed is not a marker.
	 */
	readonly workspaceRoot?: boolean | undefined;
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

/**
 * Whether a `package.json` text declares workspaces: a non-null `workspaces`
 * array or object (yarn's `{ packages: [...] }` form). Malformed JSON, or a
 * document that is not an object, declares none.
 */
const declaresWorkspaces = (text: string): boolean => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return false;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
	if (!Object.hasOwn(parsed, "workspaces")) return false;
	const workspaces: unknown = (parsed as Record<string, unknown>).workspaces;
	return workspaces !== null && typeof workspaces === "object";
};

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

/** The proxy settings: their values are URLs that may be written without a scheme. */
const PROXY_KEYS = new Set(["proxy", "https-proxy", "http-proxy"]);

/**
 * Userinfo in a proxy URL written without a scheme (`alice:pw@proxy:3128`,
 * `//alice:pw@proxy:3128`), the form pnpm accepts by giving the request's
 * scheme to it. Greedy to the last `@` before any `/`, `?` or `#`, so a
 * password holding `@` is removed whole.
 */
const SCHEMELESS_USERINFO = /^(\/\/)?[^/?#]*@/;

/**
 * A setting's value with any userinfo removed, or `undefined` when it carries
 * none: a URL's (`scheme://user:pass@host`) for every key, and a scheme-less
 * authority's too for a proxy key. A non-proxy value is not read scheme-less,
 * because `email=me@example.com` is not userinfo.
 */
const withoutCredentials = (key: string, value: string): string | undefined => {
	const schemed = withoutUserinfo(value);
	if (schemed !== undefined || !PROXY_KEYS.has(key)) return schemed;
	return SCHEMELESS_USERINFO.test(value) ? value.replace(SCHEMELESS_USERINFO, "$1") : undefined;
};

/**
 * One npmrc's text as key/value pairs, with the credential rule on top:
 * a credential key or value naming an unset variable fails `"missing-env"`, since npm
 * would send the literal `${VAR}` text as the token, which is never a credential.
 */
const parseSource = (
	source: NpmConfigSource,
	env: Readonly<Record<string, string | undefined>>,
): Result.Result<ReadonlyArray<readonly [string, string]>, NpmConfigError> => {
	const pairs: Array<readonly [string, string]> = [];
	for (const entry of parseNpmrc(source.text, env)) {
		// Array settings (`ca[]=`) are not settings this module reads.
		if (entry.array) continue;
		if (isSecretKey(entry.key) && entry.unset.length > 0) {
			return Result.fail(
				new NpmConfigError({
					reason: "missing-env",
					variable: entry.unset[0] as string,
					key: entry.key,
					...(source.path === undefined ? {} : { path: source.path }),
				}),
			);
		}
		pairs.push([entry.key, entry.value]);
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
 * Which package manager's rules {@link NpmConfig.proxyFor} and
 * {@link NpmConfig.tlsFor} follow.
 *
 * @remarks
 * npm and pnpm read the same npmrc keys but route a request, and match a
 * registry's TLS keys, differently; see each method. Pick the manager whose
 * behaviour the caller is replacing: a tool that used to shell out to
 * `pnpm view` passes `"pnpm"`.
 *
 * @public
 */
export interface ProxyForOptions {
	/** The rules to follow. Defaults to `"npm"`. */
	readonly packageManager?: "npm" | "pnpm" | undefined;
}

/**
 * npm's and pnpm's transport settings, as the configuration holds them:
 * proxies, the proxy bypass lists, TLS trust, a client certificate and the
 * local address.
 *
 * @remarks
 * **Nothing in this package applies these.** `NpmRegistry` and
 * `PackageTarball` send every request through the `HttpClient` the caller
 * provides, and that client is where a proxy or a CA bundle takes effect. This
 * record is what a caller reads to build one; see {@link NpmConfig.transport},
 * {@link NpmConfig.proxyFor} and {@link NpmConfig.tlsFor}.
 *
 * Each field names who reads it. npm 11 and npm 12 read these settings
 * identically; pnpm (11 and 12) reads the same keys plus three of its own
 * (`http-proxy`, `no-proxy`, and `proxy=false` as "no proxy"), so the record
 * is the superset and a pnpm-only field is marked as such.
 *
 * Values are the settings after npmrc precedence and `npm_config_*`
 * substitution, as written. The proxy URLs, the inline `cert` and the inline
 * `key` are `Redacted`, a proxy URL with its userinfo included, because a
 * corporate proxy URL commonly carries a password
 * (`http://user:pass@proxy:3128`, or `user:pass@proxy:3128` written without
 * a scheme, as pnpm accepts). The plain `NpmConfig.settings` record holds
 * every proxy URL with its userinfo removed, in either form. An empty, `false` or `null` proxy URL is
 * absent, as both managers read it. `cafile` is a path as written: its file
 * is not read and the path is not resolved (pnpm resolves a relative one
 * against the npmrc's directory). Not held: the per-registry `//host/:…` TLS
 * settings (see {@link NpmConfig.tlsFor}), and the `ca[]` and `noproxy[]`
 * array forms. Only the scalar `ca` and the comma-separated `noproxy` /
 * `no-proxy` strings are read. **An array form is dropped silently, not
 * reported**: with `noproxy[]=registry.corp.test`, npm bypasses the proxy for
 * that host and ignores `NO_PROXY`, while here `noproxy` is empty, so
 * {@link NpmConfig.proxyFor} falls back to `NO_PROXY` and can answer a proxy
 * npm would not use; with `ca[]=`, `ca` is absent and `isDefault` can read
 * `true`. Write those settings in their scalar form (a comma-separated
 * `noproxy`, a `cafile` bundle) for them to be seen.
 *
 * **Top-level `certfile` and `keyfile` are not settings either manager
 * reads.** Both read a client certificate file only per registry
 * (`//host/:certfile`, `//host/:keyfile`); npm 12 refuses to run with a
 * top-level pair until `npm config fix` moves it under the default registry,
 * and npm 11 and pnpm ignore one. Neither is held here.
 *
 * **These values are as trustworthy as the npmrc they came from.** The
 * project npmrc ships with the repository a tool runs in, so a cloned
 * repository can set `https-proxy` and `strict-ssl=false` and route
 * token-bearing reads through a host it controls. npm and pnpm honour that
 * too. A CI tool that should not trust the checked-out repository can load
 * the configuration without the project layer (`NpmConfig.fromSourcesResult`
 * over the user and global files) before applying these settings.
 *
 * @public
 */
export class NpmTransportSettings extends Schema.Class<NpmTransportSettings>("NpmTransportSettings")({
	/** `https-proxy` (npm, pnpm): npm's proxy for every request; pnpm's for `https:` requests. */
	httpsProxy: Schema.optionalKey(Schema.Redacted(Schema.String)),
	/** `http-proxy` (pnpm only): pnpm's proxy for `http:` requests. npm has no such setting. */
	httpProxy: Schema.optionalKey(Schema.Redacted(Schema.String)),
	/** `proxy` (npm, pnpm): the fallback when `https-proxy` (and, for pnpm's `http:` requests, `http-proxy`) is not set. */
	proxy: Schema.optionalKey(Schema.Redacted(Schema.String)),
	/**
	 * `proxy=false` (pnpm only): pnpm then uses no proxy at all, ignoring the
	 * proxy environment variables. npm reads it as unset and still falls back
	 * to the environment.
	 */
	proxyDisabled: Schema.Boolean,
	/** `noproxy` (npm, pnpm), split on commas and trimmed: domain suffixes that bypass the proxy. Empty when unset. */
	noproxy: Schema.Array(Schema.String),
	/** `no-proxy` (pnpm only), split the same way. pnpm reads it before `noproxy`; npm ignores it. */
	noProxy: Schema.Array(Schema.String),
	/**
	 * `strict-ssl` (npm, pnpm): whether TLS certificates are verified. `false`
	 * only for the literal value `false`, which is how both managers read it;
	 * `0`, `FALSE`, `null`, an empty value and anything else verify.
	 */
	strictSsl: Schema.Boolean,
	/** `ca` (npm, pnpm): an inline PEM certificate authority, replacing the default trust store. Both use `cafile`'s certificates instead when both are set. */
	ca: Schema.optionalKey(Schema.String),
	/** `cafile` (npm, pnpm): a path to a PEM bundle of trusted certificate authorities, as written. */
	cafile: Schema.optionalKey(Schema.String),
	/**
	 * `cert` (pnpm; npm deprecated): an inline PEM client certificate. pnpm
	 * sends it unless the registry has its own; npm still passes it when no
	 * per-registry `certfile`/`keyfile` pair matches, but marks it deprecated.
	 */
	cert: Schema.optionalKey(Schema.Redacted(Schema.String)),
	/** `key` (pnpm; npm deprecated): the inline PEM client key paired with `cert`. */
	key: Schema.optionalKey(Schema.Redacted(Schema.String)),
	/** `local-address` (npm, pnpm): the local interface address to connect from. */
	localAddress: Schema.optionalKey(Schema.String),
}) {
	/**
	 * `true` when no transport setting is configured: no proxy setting, no
	 * bypass list, `strict-ssl` on, and no CA, client-certificate or
	 * local-address setting.
	 *
	 * @remarks
	 * A caller whose client applies none of these settings can warn when this
	 * is `false` rather than fail later with a transport error. The proxy
	 * environment variables are not settings, so they do not count here; see
	 * {@link NpmConfig.proxyFor}. Nor do per-registry TLS settings; see
	 * {@link NpmConfig.tlsFor}.
	 */
	get isDefault(): boolean {
		return (
			this.httpsProxy === undefined &&
			this.httpProxy === undefined &&
			this.proxy === undefined &&
			!this.proxyDisabled &&
			this.noproxy.length === 0 &&
			this.noProxy.length === 0 &&
			this.strictSsl &&
			this.ca === undefined &&
			this.cafile === undefined &&
			this.cert === undefined &&
			this.key === undefined &&
			this.localAddress === undefined
		);
	}
}

/**
 * One registry's own TLS settings: the `//host/:…` keys of an npmrc.
 *
 * @remarks
 * npm (11 and 12) reads only the `certfile` and `keyfile` pair, and only
 * when both are set; a lone one is ignored. pnpm reads all six, and a
 * registry's own `ca`, `cert` or `key` replaces the top-level setting for
 * requests to it. The two also find a registry's keys differently (npm stops
 * at the first key holding any auth, pnpm walks slash-terminated directory
 * keys and then retries without the port); {@link NpmConfig.tlsFor} follows
 * either. Paths are as written and their files are not read; the inline
 * `cert` and `key` are `Redacted`.
 *
 * @public
 */
export class NpmRegistryTls extends Schema.Class<NpmRegistryTls>("NpmRegistryTls")({
	/** `//host/:ca` (pnpm only): an inline PEM certificate authority trusted for this registry. */
	ca: Schema.optionalKey(Schema.String),
	/** `//host/:cafile` (pnpm only): a path to this registry's certificate authority file. */
	cafile: Schema.optionalKey(Schema.String),
	/** `//host/:cert` (pnpm only): an inline PEM client certificate for this registry. */
	cert: Schema.optionalKey(Schema.Redacted(Schema.String)),
	/** `//host/:certfile` (npm, pnpm): a path to this registry's client certificate. npm reads it only with `keyfile`. */
	certfile: Schema.optionalKey(Schema.String),
	/** `//host/:key` (pnpm only): an inline PEM client key for this registry. */
	key: Schema.optionalKey(Schema.Redacted(Schema.String)),
	/** `//host/:keyfile` (npm, pnpm): a path to this registry's client key. npm reads it only with `certfile`. */
	keyfile: Schema.optionalKey(Schema.String),
}) {}

/** The six per-registry TLS fields, in {@link NpmRegistryTls} order. */
const REGISTRY_TLS_FIELDS = ["ca", "cafile", "cert", "certfile", "key", "keyfile"] as const;

/** The proxy environment variables npm reads, matched case-insensitively. */
const PROXY_ENV_KEYS = new Set(["https_proxy", "http_proxy", "proxy", "no_proxy"]);

/**
 * The proxy environment, keyed in lower case, as `@npmcli/agent` builds it:
 * every variable whose lower-cased name is a proxy key, the last one read
 * winning when two spellings are set.
 */
const proxyEnv = (env: Readonly<Record<string, string | undefined>>): Map<string, string> => {
	const found = new Map<string, string>();
	for (const [name, value] of Object.entries(env)) {
		const key = name.toLowerCase();
		if (value !== undefined && PROXY_ENV_KEYS.has(key)) found.set(key, value);
	}
	return found;
};

/**
 * A proxy variable as pnpm reads it (`getProcessEnv`): the lower-case name,
 * else the upper-case one. A mixed-case spelling is not read.
 */
const pnpmEnv = (env: Readonly<Record<string, string | undefined>>, name: string): string | undefined =>
	env[name] ?? env[name.toUpperCase()];

/** A comma-separated bypass list, trimmed, with empty entries dropped. */
const splitNoProxy = (value: string | undefined): ReadonlyArray<string> =>
	value === undefined
		? []
		: value
				.split(",")
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0);

/**
 * Whether `hostname` matches a bypass entry: `@npmcli/agent`'s `isNoProxy`,
 * which pnpm's `checkNoProxy` repeats, comparing dot-separated labels from the
 * right, so `example.com` (or `.example.com`) matches `example.com` and
 * `registry.example.com` but not `badexample.com`.
 */
const bypassesProxy = (hostname: string, noProxy: ReadonlyArray<string>, dropEmptyHostLabels = false): boolean => {
	// pnpm's `toReversedLabels` drops empty labels from the host as well, so a
	// trailing-dot FQDN (`example.com.`) still matches `example.com`; npm's
	// `isNoProxy` keeps them, so it does not.
	const labelsOfHost = hostname.split(".");
	const host = (dropEmptyHostLabels ? labelsOfHost.filter((label) => label.length > 0) : labelsOfHost).reverse();
	return noProxy.some((entry) => {
		const labels = entry
			.split(".")
			.filter((label) => label.length > 0)
			.reverse();
		return labels.length > 0 && labels.every((label, index) => host[index] === label);
	});
};

/**
 * `strict-ssl`, as both managers' request paths read the setting: only the
 * literal `false` (after trimming, case-sensitive) turns verification off.
 *
 * @remarks
 * npm 11 and 12: `@npmcli/config`'s `parseField` turns `false` into `false`,
 * `null` and `undefined` into nothing, and leaves every other string a
 * string; then `make-fetch-happen` sets `rejectUnauthorized` to
 * `strictSSL !== false`, or to `NODE_TLS_REJECT_UNAUTHORIZED !== "0"` when
 * nothing was set. pnpm's ini reader JSON-parses only `true`, `false` and
 * `null`, and its dispatcher passes `rejectUnauthorized: strictSsl ?? true`.
 * So `0`, `FALSE`, `no` or an empty value verify under both. `null` defers
 * to that variable in npm and reads as `true` here, the stricter answer: a
 * caller that passes `rejectUnauthorized: true` verifies even where npm,
 * under `NODE_TLS_REJECT_UNAUTHORIZED=0`, would not.
 */
const strictSslOf = (value: string): boolean => value.trim() !== "false";

/** npm's proxy for a request (`npm-registry-fetch` + `@npmcli/agent` `getProxy`); see {@link NpmConfig.proxyFor}. */
const npmProxy = (
	parsed: URL,
	transport: NpmTransportSettings,
	env: Readonly<Record<string, string | undefined>>,
): Option.Option<Redacted.Redacted<string>> => {
	const fromEnv = proxyEnv(env);
	const envProxy = (key: string): string | undefined => {
		const value = fromEnv.get(key);
		return value === undefined || value === "" ? undefined : value;
	};
	const fromVariables =
		parsed.protocol === "https:"
			? envProxy("https_proxy")
			: (envProxy("https_proxy") ?? envProxy("http_proxy") ?? envProxy("proxy"));
	const proxy =
		transport.httpsProxy ?? transport.proxy ?? (fromVariables === undefined ? undefined : Redacted.make(fromVariables));
	const noProxy = transport.noproxy.length > 0 ? transport.noproxy : splitNoProxy(envProxy("no_proxy"));
	return proxy === undefined || bypassesProxy(parsed.hostname, noProxy) ? Option.none() : Option.some(proxy);
};

/**
 * pnpm's proxy for a request (`resolveProxySettings`, `getProxyDispatcher`,
 * `checkNoProxy`, `parseProxyUrl`); see {@link NpmConfig.proxyFor}.
 */
const pnpmProxy = (
	parsed: URL,
	transport: NpmTransportSettings,
	env: Readonly<Record<string, string | undefined>>,
): Option.Option<Redacted.Redacted<string>> => {
	// pnpm chains variables with `??`, so a variable that is set but empty is
	// a value: `https_proxy=""` means "no proxy" and stops the fallback to
	// `HTTPS_PROXY` and, for `http:`, to `HTTP_PROXY`. `false` stands for it.
	const variable = (...names: ReadonlyArray<string>): Redacted.Redacted<string> | false | undefined => {
		for (const name of names) {
			const value = pnpmEnv(env, name);
			if (value !== undefined) return value === "" ? false : Redacted.make(value);
		}
		return undefined;
	};
	// `false` is pnpm's "no proxy": `proxy=false` stops the fallback to the
	// environment.
	const httpsProxy: Redacted.Redacted<string> | false | undefined =
		transport.httpsProxy ?? (transport.proxyDisabled ? false : (transport.proxy ?? variable("https_proxy")));
	const proxy =
		parsed.protocol === "https:" ? httpsProxy : (transport.httpProxy ?? httpsProxy ?? variable("http_proxy", "proxy"));
	if (proxy === undefined || proxy === false) return Option.none();
	// A bare `true` bypasses every host only as a setting: pnpm's ini reader
	// makes it a boolean, while a `NO_PROXY=true` variable stays the string
	// `true`, a host name like any other.
	const setting = transport.noProxy.length > 0 ? transport.noProxy : transport.noproxy;
	if (setting.length === 1 && setting[0] === "true") return Option.none();
	const noProxy = setting.length > 0 ? setting : splitNoProxy(pnpmEnv(env, "no_proxy"));
	if (bypassesProxy(parsed.hostname, noProxy, true)) return Option.none();
	// pnpm gives a scheme-less proxy the request's own scheme.
	const written = Redacted.value(proxy);
	return Option.some(written.includes("://") ? proxy : Redacted.make(`${parsed.protocol}//${written}`));
};

/** The most keys a pnpm TLS lookup walks per host spelling: a URL's depth is caller input. */
const MAX_PNPM_TLS_KEYS = 64;

/**
 * The keys pnpm's `pickSettingByUrl` tries for a request URL, in order: the
 * URL's directory as a nerf-dart (`//host[:port]/a/`), each parent directory
 * down to `//host[:port]/`, then the same without the port. Every key ends in
 * `/`, as pnpm only matches that form.
 */
const pnpmTlsKeys = (parsed: URL): ReadonlyArray<string> => {
	const directory = parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1);
	const keysFor = (host: string): Array<string> => {
		const parts = `//${host}${directory}`.split("/");
		const keys: Array<string> = [];
		for (let count = parts.length - 1; count >= 3 && keys.length < MAX_PNPM_TLS_KEYS; count--) {
			keys.push(`${parts.slice(0, count).join("/")}/`);
		}
		return keys;
	};
	const keys = keysFor(parsed.host);
	return parsed.port === "" ? keys : [...keys, ...keysFor(parsed.hostname)];
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
 * npm does: the nerf-dart key of that URL, walked up through its parent paths
 * to `//host[:port]` and never further. Each level is tried with its trailing
 * slash and then without it, as npm tries them, so an npmrc line written
 * `//host/path/:_authToken`, `//host/path:_authToken`, `//host/:_authToken`
 * or `//host:_authToken` is found; when both spellings of one level are
 * configured, the one with the slash wins. Every key ends on a segment
 * boundary of the request's own host and path, so `//host:_authToken` never
 * matches `//hostevil.com`, and `//host/pa:_authToken` never matches
 * `/path/`. A scoped
 * registry on another host, a lookalike host (`registry.npmjs.org.evil.dev`),
 * another port, or a tarball URL on a CDN therefore gets no credential unless
 * one is configured for that host itself. An unscoped top-level `_authToken`
 * or `_auth` names no host, so it is never used (npm refuses it too).
 * An empty path segment is a level of its own, as in npm: a tarball at
 * `https://host//pkg/-/pkg-1.0.0.tgz` (the shape Artifactory and Nexus emit)
 * walks down through `//host//pkg/`, `//host//pkg`, `//host//`, `//host/` and
 * `//host`, so a credential configured for the host is still found.
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
 * substitute from the environment in keys and values. The project is the
 * nearest `package.json` or `node_modules` directory unless
 * {@link NpmConfigLoadOptions.projectDir} names it or
 * {@link NpmConfigLoadOptions.workspaceRoot} asks for the workspace root.
 * **Not supported**: command-line flags, npm's builtin npmrc, client
 * certificates (`certfile`/`keyfile`), `always-auth`, and the
 * deprecated unscoped credentials.
 *
 * **Transport settings are read, never applied.** `proxy`, `https-proxy`,
 * `noproxy`, `strict-ssl`, `ca`, `cafile`, `certfile` and `keyfile` decide how
 * npm connects, and here the connection belongs to the `HttpClient` the caller
 * provides to `NpmRegistry`: this package owns no transport. Read
 * {@link NpmConfig.transport} and {@link NpmConfig.proxyFor} to configure that
 * client, or a registry behind a proxy or an internal CA fails every read as
 * `RegistryReadError` `"transport"` where `npm view` succeeds.
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
 * import { Effect, Option } from "effect";
 *
 * const latest = (name: string) =>
 *   Effect.gen(function* () {
 *     const config = yield* NpmConfig.load({ cwd: process.cwd(), env: process.env });
 *     const registry = yield* NpmRegistry;
 *     const tags = yield* registry.distTags(name, config.targetFor(name));
 *     return Option.flatMap(tags, (found) => Option.fromUndefinedOr(found.latest));
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
	 * remarks): never another host's credential. Keys are tried deepest first,
	 * each level with its trailing slash before the same level without it, and
	 * the first key holding a usable credential is the match. Within that key,
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
	 * npm's and pnpm's transport settings from this configuration: proxies,
	 * the bypass lists, `strict-ssl`, the CA, client-certificate and
	 * local-address settings.
	 *
	 * @remarks
	 * Read only; see {@link NpmTransportSettings}. Recomputed on each access.
	 * A registry's own TLS settings are {@link NpmConfig.tlsFor}'s.
	 */
	get transport(): NpmTransportSettings {
		const text = (key: string): string | undefined => {
			const value = Object.hasOwn(this.settings, key) ? this.settings[key] : undefined;
			return value === undefined || value === "" ? undefined : value;
		};
		// The proxy as written, userinfo included: `settings` holds it stripped
		// and `secrets` holds the original under the same key.
		const proxy = (key: string): Redacted.Redacted<string> | undefined => {
			const stripped = text(key);
			if (stripped === undefined || stripped === "false" || stripped === "null") return undefined;
			return this.secret(key) ?? Redacted.make(stripped);
		};
		const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
			(value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
		const strictSsl = text("strict-ssl");
		return NpmTransportSettings.make({
			proxyDisabled: text("proxy")?.trim() === "false",
			noproxy: splitNoProxy(text("noproxy")),
			noProxy: splitNoProxy(text("no-proxy")),
			strictSsl: strictSsl === undefined ? true : strictSslOf(strictSsl),
			...optional("httpsProxy", proxy("https-proxy")),
			...optional("httpProxy", proxy("http-proxy")),
			...optional("proxy", proxy("proxy")),
			...optional("ca", text("ca")),
			...optional("cafile", text("cafile")),
			...optional("cert", this.secret("cert")),
			...optional("key", this.secret("key")),
			...optional("localAddress", text("local-address")),
		});
	}

	/**
	 * The proxy a request to `url` would go through, or `None` for a direct
	 * connection, by npm's rules or pnpm's.
	 *
	 * @remarks
	 * **npm** (the default; npm 11 and 12 alike, `npm-registry-fetch` and
	 * `@npmcli/agent`): the `https-proxy` setting, else `proxy`, for any
	 * scheme; with neither set, the `HTTPS_PROXY` environment variable for an
	 * `https:` URL, and `HTTPS_PROXY`, `HTTP_PROXY` or `PROXY` for any other,
	 * each name matched in any case. The bypass list is the `noproxy` setting,
	 * else `NO_PROXY`. `proxy=false` is unset, so the environment still
	 * applies.
	 *
	 * **pnpm** (`packageManager: "pnpm"`): an `https:` URL uses `https-proxy`,
	 * else `proxy`, else `HTTPS_PROXY`; any other URL uses `http-proxy`, else
	 * that same `https:` answer, else `HTTP_PROXY`, else `PROXY`. `proxy=false`
	 * turns proxying off entirely, the environment included. A variable is read
	 * in lower case, else upper case, never mixed. The bypass list is
	 * `no-proxy`, else `noproxy`, else `NO_PROXY`, and a bare `true` bypasses
	 * every host. A proxy written without a scheme (`proxy.corp:3128`) takes the
	 * request's.
	 *
	 * Under both, a host that matches a bypass entry label by label from the
	 * right (`example.com` covers `registry.example.com`, never
	 * `badexample.com`) connects directly, and an unparseable `url` is `None`.
	 *
	 * The answer is `Redacted` because a proxy URL can carry a password. Pass
	 * the same environment record given to {@link NpmConfig.load}; nothing here
	 * reads `process.env`.
	 *
	 * @param url - The request URL, such as a package's registry URL.
	 * @param env - The environment, for the proxy variables.
	 * @param options - Which package manager's rules to follow; see {@link ProxyForOptions}.
	 */
	proxyFor(
		url: string,
		env: Readonly<Record<string, string | undefined>>,
		options: ProxyForOptions = {},
	): Option.Option<Redacted.Redacted<string>> {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return Option.none();
		}
		const transport = this.transport;
		return options.packageManager === "pnpm" ? pnpmProxy(parsed, transport, env) : npmProxy(parsed, transport, env);
	}

	/**
	 * The registry's own TLS settings for a request to `url` (the npmrc's
	 * `//host/:…` TLS keys), by npm's rules or pnpm's, or `None` when that
	 * manager would use none for `url`.
	 *
	 * @remarks
	 * Only an `https:` URL has TLS settings, and an unparseable `url` is
	 * `None`. The two managers find a registry's keys differently:
	 *
	 * **npm** (the default; npm 11 and 12 alike, `npm-registry-fetch`'s
	 * `regFromURI`/`hasAuth`): the walk {@link NpmConfig.credentialFor} uses,
	 * deepest key first, each level with its trailing slash and then without
	 * it, **stopping at the first key that holds any auth**: an `_authToken`,
	 * an `_auth`, a `username` with a `_password`, or a `certfile` with a
	 * `keyfile`. The answer is that key's `certfile`/`keyfile` pair, or `None`
	 * when the stopping key holds a credential but no pair. A lone
	 * `certfile`, or a pnpm-only `ca`, does not stop the walk, and npm reads
	 * nothing else here.
	 *
	 * **pnpm** (`packageManager: "pnpm"`; `pickSettingByUrl`): only keys
	 * ending in `/`, from the URL's directory (`https://host/a/b.tgz` tries
	 * `//host/a/`) up to `//host[:port]/`, then the same again with the port
	 * removed, so `//host/:cert` also applies to `https://host:8443/`. The
	 * first key holding any of the six fields is the answer, all of its fields
	 * together; a credential does not stop the walk. Keys written as a whole
	 * URL (`https://host/:cafile`) are not matched.
	 *
	 * Neither rule reaches another host: a lookalike host, another host's path
	 * or a different port (npm) never matches. See {@link NpmRegistryTls} for
	 * which field each manager reads.
	 *
	 * @param url - The request URL, such as a package's registry URL.
	 * @param options - Which package manager's rules to follow; see {@link ProxyForOptions}.
	 */
	tlsFor(url: string, options: ProxyForOptions = {}): Option.Option<NpmRegistryTls> {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return Option.none();
		}
		if (parsed.protocol !== "https:") return Option.none();
		const present = (name: string): boolean => {
			const value = Object.hasOwn(this.settings, name) ? this.settings[name] : undefined;
			return value !== undefined && value !== "";
		};
		const presentSecret = (name: string): boolean => {
			const value = this.secret(name);
			return value !== undefined && Redacted.value(value) !== "";
		};
		if (options.packageManager === "pnpm") {
			for (const key of pnpmTlsKeys(parsed)) {
				const fields: Record<string, string | Redacted.Redacted<string>> = {};
				for (const field of REGISTRY_TLS_FIELDS) {
					const name = `${key}:${field}`;
					if (field === "cert" || field === "key") {
						const value = this.secret(name);
						if (value !== undefined && presentSecret(name)) fields[field] = value;
					} else if (present(name)) {
						fields[field] = this.settings[name] as string;
					}
				}
				if (Object.keys(fields).length > 0) return Option.some(NpmRegistryTls.make(fields));
			}
			return Option.none();
		}
		const keys = nerfDartKeys(url);
		if (keys === undefined) return Option.none();
		for (const key of keys) {
			const pair = present(`${key}:certfile`) && present(`${key}:keyfile`);
			const credential =
				presentSecret(`${key}:_authToken`) ||
				presentSecret(`${key}:_auth`) ||
				(present(`${key}:username`) && presentSecret(`${key}:_password`));
			if (pair) {
				return Option.some(
					NpmRegistryTls.make({
						certfile: this.settings[`${key}:certfile`] as string,
						keyfile: this.settings[`${key}:keyfile`] as string,
					}),
				);
			}
			if (credential) return Option.none();
		}
		return Option.none();
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
			const parsed = parseSource(source, env);
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
				// URL userinfo (`https://user:pass@host/`, or `user:pass@host`
				// for a scheme-less proxy) is a password in the clear: the
				// setting keeps the URL without it, and the value as written is
				// held redacted under the same key.
				const stripped = withoutCredentials(key, value);
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
	 * The project npmrc is `.npmrc` in the project directory, chosen in this
	 * order: `projectDir` when given; with `workspaceRoot: true`, the nearest
	 * directory at or above `cwd` holding a `pnpm-workspace.yaml` or a
	 * `package.json` with a `workspaces` field; otherwise (and when no
	 * workspace root is found) the nearest directory at or above `cwd` holding
	 * a `package.json` or a `node_modules`, else `cwd` itself. Relative
	 * `userconfig`, `globalconfig` and `prefix` settings resolve against that
	 * directory. The user npmrc is the
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
				const parsed = parseSource(layer, env);
				if (Result.isFailure(parsed)) continue;
				// The last occurrence wins within a file, as in the merge.
				let found: string | undefined;
				for (const [name, value] of parsed.success) if (name === key) found = value;
				if (found !== undefined) return found;
			}
			return undefined;
		};

		// A probe that cannot answer is "not here", as npm's own walk treats it.
		const has = (file: string) => fs.exists(file).pipe(Effect.orElseSucceed(() => false));
		const isWorkspaceRoot = (dir: string) =>
			Effect.gen(function* () {
				if (yield* has(path.join(dir, "pnpm-workspace.yaml"))) return true;
				const manifest = yield* fs
					.readFileString(path.join(dir, "package.json"))
					.pipe(Effect.orElseSucceed(() => undefined));
				return manifest !== undefined && declaresWorkspaces(manifest);
			});
		const isPackageDir = (dir: string) =>
			Effect.gen(function* () {
				return (yield* has(path.join(dir, "package.json"))) || (yield* has(path.join(dir, "node_modules")));
			});
		/** The nearest directory at or above `start` that `matches`, if any. */
		const ascend = (start: string, matches: (dir: string) => Effect.Effect<boolean>) =>
			Effect.gen(function* () {
				for (let dir = start; ; ) {
					if (yield* matches(dir)) return dir;
					const parent = path.dirname(dir);
					if (parent === dir) return undefined;
					dir = parent;
				}
			});

		// The project directory: an explicit one, else the workspace root when
		// asked for, else npm's `localPrefix`.
		const cwd = path.resolve(options.cwd);
		const projectDir =
			options.projectDir !== undefined
				? path.resolve(cwd, options.projectDir)
				: ((options.workspaceRoot === true ? yield* ascend(cwd, isWorkspaceRoot) : undefined) ??
					(yield* ascend(cwd, isPackageDir)) ??
					cwd);

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

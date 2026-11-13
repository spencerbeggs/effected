// pnpm 12's reading of the registry, proxy and TLS keys, rendered as npmrc
// lines `@effected/npm`'s `NpmConfig` reads back unchanged.
//
// Every value here is already resolved the way pnpm resolves it (its
// `${VAR}` dialect, its refusals for repository files), so each line is
// written literally: a `${` that survives resolution is escaped so
// `NpmConfig`'s own substitution leaves it as written.
//
// The citations name files under `.repos/pnpm/pnpm/crates/config/src`.

import { booleanFromText, booleanFromValue } from "./coerce.js";

/** The environment, as a plain record. */
type Env = Readonly<Record<string, string | undefined>>;

/** pnpm's public registry, the pin for an unscoped credential in a source with no `registry` (`npmrc_auth.rs`). */
const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

/** The credential fields of a `//host/:field` key in a file (`credential_keys.rs` `INI_CREDS_SUFFIXES`, less `tokenHelper`). */
const CREDENTIAL_FIELDS: ReadonlySet<string> = new Set(["_authToken", "_auth", "username", "_password"]);

/** The per-registry TLS fields of a `//host/:field` key (`tls.rs` `TLS_SUFFIXES`). */
const TLS_FIELDS: ReadonlySet<string> = new Set(["ca", "cafile", "cert", "certfile", "key", "keyfile"]);

/**
 * Whether `text` holds a `${…}` placeholder as pnpm tests for one
 * (`workspace_yaml/environment_values.rs` `has_env_placeholder`): a `${`
 * followed, later, by a `}` with at least one character between.
 *
 * @remarks
 * One left-to-right scan, linear in `text`: a `${` whose first `}` is
 * missing ends the scan (no later `${` can close either), and one whose
 * first `}` is immediate (`${}`) costs a constant step.
 */
export const hasPlaceholder = (text: string): boolean => {
	let from = 0;
	for (;;) {
		const open = text.indexOf("${", from);
		if (open === -1) return false;
		const close = text.indexOf("}", open + 2);
		if (close === -1) return false;
		if (close > open + 2) return true;
		from = open + 1;
	}
};

/**
 * `text` with its `${…}` placeholders resolved as pnpm resolves them:
 * `${NAME}` to the variable, or `""` when it is unset or empty;
 * `${NAME:-fallback}` to the fallback when the variable is unset or empty;
 * `${NAME-fallback}` to the fallback only when it is unset; and `\${…}` to the
 * literal `${…}` (`npmrc_auth/tests/json_env_expansion.rs`).
 *
 * @remarks
 * A placeholder is a backslash run, then `${`, then one or more characters
 * that are not `}`, then `}`; an even run halves and expands, an odd run
 * halves and leaves the placeholder as written, and an unclosed or empty
 * `${` is left as written. A single left-to-right scan, linear in `text`: a
 * backslash run is counted once, an unclosed `${` ends the scan, and a match
 * is consumed whole. (A regular expression for the same shape backtracks
 * quadratically on a long backslash or `${{` run.)
 */
export const expandPlaceholders = (text: string, env: Env): string => {
	const variable = (name: string): string | undefined => (Object.hasOwn(env, name) ? env[name] : undefined);
	const resolve = (body: string): string => {
		const colon = body.indexOf(":-");
		const dash = body.indexOf("-");
		if (colon !== -1 && (dash === -1 || colon < dash)) {
			const value = variable(body.slice(0, colon));
			return value === undefined || value === "" ? body.slice(colon + 2) : value;
		}
		if (dash !== -1) {
			const value = variable(body.slice(0, dash));
			return value === undefined ? body.slice(dash + 1) : value;
		}
		return variable(body) ?? "";
	};
	let out = "";
	let index = 0;
	while (index < text.length) {
		const char = text.charCodeAt(index);
		let runEnd = index;
		if (char === 0x5c) {
			while (runEnd < text.length && text.charCodeAt(runEnd) === 0x5c) runEnd++;
		}
		if (text.startsWith("${", runEnd)) {
			const close = text.indexOf("}", runEnd + 2);
			// No `}` after this `${`: none can follow a later one either.
			if (close === -1) return out + text.slice(index);
			if (close > runEnd + 2) {
				const escapes = runEnd - index;
				const kept = "\\".repeat(Math.floor(escapes / 2));
				const body = text.slice(runEnd + 2, close);
				out += escapes % 2 === 1 ? `${kept}\${${body}}` : kept + resolve(body);
				index = close + 1;
				continue;
			}
		}
		if (runEnd > index) {
			// A backslash run that escapes nothing: kept whole, and the `${` after it
			// (if any, and empty) is tried next without escapes, as the pattern would.
			out += text.slice(index, runEnd);
			index = runEnd;
			if (!text.startsWith("${", index)) continue;
		}
		out += text[index];
		index++;
	}
	return out;
};

/**
 * `NpmConfig`'s `${VAR}` expression (`@effected/npm`'s `Npmrc.ts`), matched so
 * {@link literal} can escape exactly what `NpmConfig` would substitute.
 */
const NPM_EXPRESSION = /(?<!\\)(\\*)\$\{([^${}?]+)(\?)?\}/g;

/**
 * `text` escaped so `NpmConfig`'s substitution reads it back as written: each
 * expression it would expand gets its backslash run doubled and one more
 * backslash, which its substitution halves away.
 */
const literal = (text: string): string =>
	text.replace(NPM_EXPRESSION, (match, escapes: string) => `${escapes}${escapes}\\${match.slice(escapes.length)}`);

/**
 * One npmrc line `NpmConfig` reads as `key` = `value`, verbatim: both
 * JSON-quoted, so no `;`, `#`, quote or `[section]` in either is reinterpreted.
 * `undefined` for a key holding `=`, which no quoting carries through
 * `NpmConfig`'s line split.
 */
export const npmrcLine = (key: string, value: string): string | undefined =>
	key.includes("=") ? undefined : `${JSON.stringify(literal(key))}=${JSON.stringify(literal(value))}`;

/** A pnpm ini key or value with its quotes removed (`npmrc_auth/ini.rs` `decode_ini_value`). */
const decodeIni = (raw: string): string => {
	if (raw.startsWith("'") && raw.endsWith("'")) return raw.length >= 2 ? raw.slice(1, -1) : "";
	if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed === "string") return parsed;
		} catch {
			// Not a JSON string: kept as written, quotes included, as pnpm keeps it.
		}
	}
	return raw;
};

/**
 * One `key=value` line as pnpm splits it (`npmrc_auth/ini.rs`
 * `split_ini_line`): blank lines, `;` and `#` comments and lines with no `=`
 * are skipped, a key written as a JSON string ends at its closing quote, and
 * the value runs to the end of the line (pnpm strips no inline comment).
 */
const splitLine = (line: string): readonly [string, string] | undefined => {
	const trimmed = line.trim();
	if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#")) return undefined;
	let end: number | undefined;
	if (trimmed.startsWith('"')) {
		for (let index = 1; index < trimmed.length; index++) {
			const char = trimmed[index];
			if (char === "\\") index++;
			else if (char === '"') {
				end = index + 1;
				break;
			}
		}
	}
	if (end !== undefined) {
		const rest = trimmed.slice(end).trimStart();
		if (!rest.startsWith("=")) return undefined;
		return [decodeIni(trimmed.slice(0, end).trim()), decodeIni(rest.slice(1).trim())];
	}
	const equals = trimmed.indexOf("=");
	if (equals === -1) return undefined;
	return [decodeIni(trimmed.slice(0, equals).trim()), decodeIni(trimmed.slice(equals + 1).trim())];
};

const isRegistryKey = (key: string): boolean =>
	key === "registry" || (key.startsWith("@") && key.endsWith(":registry"));

/** A scoped registry key's scope, `@acme` for `@acme:registry`, as pnpm accepts one (`ini.rs` `scoped_registry_key`). */
const scopeOf = (key: string): string | undefined => {
	if (!key.endsWith(":registry")) return undefined;
	const scope = key.slice(0, -":registry".length);
	return scope.startsWith("@") && scope.length > 1 && !scope.includes("/") ? scope : undefined;
};

/** The field of a `//host/…:field` key, when it is one of `fields`. */
const scopedField = (key: string, fields: ReadonlySet<string>): string | undefined => {
	if (!key.startsWith("//")) return undefined;
	const colon = key.lastIndexOf(":");
	const field = key.slice(colon + 1);
	return colon > 1 && fields.has(field) ? field : undefined;
};

/** Whether a key holds a credential or an inline client identity (`credential_keys.rs` `is_auth_value_key`). */
const isAuthValueKey = (key: string): boolean =>
	["_authToken", "_auth", "_password", "username", "tokenHelper", "cert", "key"].includes(key) ||
	(key.startsWith("//") && /:(?:_authToken|_auth|username|_password|tokenHelper)$/.test(key)) ||
	/:(?:cert|key)$/.test(key);

/** Whether a key names where a request goes (`ini.rs` `is_request_destination_key`). */
const isDestinationKey = (key: string): boolean => isRegistryKey(key) || key.startsWith("//");

/** Whether a key's value names where a request goes (`ini.rs` `is_request_destination_value_key`). */
const isDestinationValueKey = (key: string): boolean =>
	isRegistryKey(key) || key === "https-proxy" || key === "http-proxy" || key === "proxy";

/**
 * The nerf-dart of a registry URL, `//host[:port]/path/`, with a trailing
 * slash added first as pnpm normalizes a registry; `undefined` when it does
 * not parse.
 */
const nerfDart = (registry: string): string | undefined => {
	let parsed: URL;
	try {
		parsed = new URL(registry.endsWith("/") ? registry : `${registry}/`);
	} catch {
		return undefined;
	}
	const directory = parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1);
	return `//${parsed.host}${directory}`;
};

/** An npmrc file pnpm reads, and whether it is a repository file. */
export interface NpmrcInput {
	/** The file's text. */
	readonly text: string;
	/**
	 * `false` for the project `.npmrc`, which ships with the repository: pnpm
	 * expands no `${VAR}` in its request destinations or credentials there.
	 */
	readonly trusted: boolean;
}

/** Why a source cannot be read: a registry URL pnpm refuses to expand in a repository file. */
export interface UntrustedRegistry {
	/** The setting, as written. */
	readonly setting: string;
}

/** The outcome of reading one source: its lines, or the registry setting pnpm refuses. */
export type LinesResult =
	| { readonly _tag: "lines"; readonly lines: ReadonlyArray<string> }
	| { readonly _tag: "untrusted"; readonly failure: UntrustedRegistry };

const lines = (out: ReadonlyArray<string | undefined>): LinesResult => ({
	_tag: "lines",
	lines: out.filter((line): line is string => line !== undefined),
});

/**
 * One npmrc file as the lines pnpm 12 takes from it, for `NpmConfig`.
 *
 * @remarks
 * Kept: `registry` and `@scope:registry`; the proxies (`no-proxy` and
 * `noproxy` share one slot in pnpm, so both become `no-proxy`); `ca` (every
 * `ca=` line, as pnpm accumulates them, written as `ca[]`; a `ca[]=` line is a
 * key pnpm does not know and is dropped); `cafile`; `strict-ssl` when it is
 * `true` or `false`; `local-address`; and the `//host/:…` credential and TLS
 * keys. Everything else is a key pnpm does not read from an npmrc.
 *
 * An unscoped `_authToken`, `_auth`, `username`, `_password`, `cert` or `key`
 * is pinned to the registry the same file declares, else the public one
 * (`npmrc_auth/credentials.rs` `rescope_unscoped`), under any `//host/:…`
 * key the file writes for it. An empty credential is dropped.
 *
 * In an untrusted file (`ini.rs` `from_project_ini`), a line whose key holds
 * a placeholder and names a destination or a credential is dropped, and so is
 * a proxy or credential whose value holds one; a registry URL holding one
 * refuses the whole load, as pnpm does.
 */
export const npmrcLines = (input: NpmrcInput, env: Env): LinesResult => {
	const out: Array<string | undefined> = [];
	const unscoped: Array<readonly [string, string]> = [];
	let declaredRegistry: string | undefined;
	const text = input.text.startsWith("﻿") ? input.text.slice(1) : input.text;
	for (const line of text.split(/\r?\n/)) {
		const split = splitLine(line);
		if (split === undefined) continue;
		const [rawKey, rawValue] = split;
		const keyHole = !input.trusted && hasPlaceholder(rawKey);
		if (keyHole && (isDestinationKey(rawKey) || isAuthValueKey(rawKey))) continue;
		const key = expandPlaceholders(rawKey, env);
		if (keyHole && (isDestinationKey(key) || isAuthValueKey(key))) continue;
		if (!input.trusted && hasPlaceholder(rawValue)) {
			if (isRegistryKey(key)) return { _tag: "untrusted", failure: { setting: rawKey } };
			if (isDestinationValueKey(key) || isAuthValueKey(key)) continue;
		}
		const value = expandPlaceholders(rawValue, env);
		if (key === "registry") {
			declaredRegistry = value;
			out.push(npmrcLine(key, value));
		} else if (scopeOf(key) !== undefined) {
			out.push(npmrcLine(key, value));
		} else if (key === "https-proxy" || key === "http-proxy" || key === "proxy" || key === "cafile") {
			out.push(npmrcLine(key, value));
		} else if (key === "local-address") {
			out.push(npmrcLine(key, value));
		} else if (key === "no-proxy" || key === "noproxy") {
			out.push(npmrcLine("no-proxy", value));
		} else if (key === "ca") {
			out.push(npmrcLine("ca[]", value));
		} else if (key === "strict-ssl") {
			const flag = value.trim();
			if (flag === "true" || flag === "false") out.push(npmrcLine(key, flag));
		} else if (key === "cert" || key === "key" || CREDENTIAL_FIELDS.has(key)) {
			if (value !== "") unscoped.push([key, value]);
		} else if (scopedField(key, CREDENTIAL_FIELDS) !== undefined) {
			if (value !== "") out.push(npmrcLine(key, value));
		} else if (scopedField(key, TLS_FIELDS) !== undefined) {
			out.push(npmrcLine(key, value));
		}
	}
	if (unscoped.length === 0) return lines(out);
	const pinned = nerfDart(
		declaredRegistry === undefined || declaredRegistry === "" ? DEFAULT_REGISTRY : declaredRegistry,
	);
	// An unparsable registry pins nothing: pnpm drops the unscoped values rather than guess a host.
	if (pinned === undefined) return lines(out);
	// Written first, so a `//host/:…` line the file writes for the same key wins.
	return lines([...unscoped.map(([field, value]) => npmrcLine(`${pinned}:${field}`, value)), ...out]);
};

/**
 * The `npm_config_//…` and `pnpm_config_//…` credential variables, as the
 * lines pnpm 12 takes from them (`npmrc_auth.rs` `from_url_scoped_env`): the
 * prefix in any case, the key's own case kept, only the four credential
 * fields, an empty value skipped, `pnpm_config_` winning over `npm_config_`.
 * Values are used as given, never expanded again.
 */
export const environmentCredentialLines = (env: Env): ReadonlyArray<string> => {
	const npm = new Map<string, string>();
	const pnpm = new Map<string, string>();
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined || value === "") continue;
		const lower = name.toLowerCase();
		const prefix = lower.startsWith("pnpm_config_//")
			? "pnpm_config_"
			: lower.startsWith("npm_config_//")
				? "npm_config_"
				: undefined;
		if (prefix === undefined) continue;
		const key = name.slice(prefix.length);
		if (scopedField(key, CREDENTIAL_FIELDS) === undefined) continue;
		(prefix === "pnpm_config_" ? pnpm : npm).set(key, value);
	}
	for (const [key, value] of pnpm) npm.set(key, value);
	return [...npm].map(([key, value]) => npmrcLine(key, value)).filter((line): line is string => line !== undefined);
};

/** Which settings layer an overlay comes from: a file or the `PNPM_CONFIG_*` variables. */
export type OverlayLayer =
	| { readonly _tag: "file"; readonly settings: Readonly<Record<string, unknown>>; readonly trusted: boolean }
	| { readonly _tag: "environment"; readonly settings: Readonly<Record<string, string>> };

/** The setting name in a pnpm settings layer, then the npmrc key `NpmConfig` holds it under. */
const STRING_SETTINGS: ReadonlyArray<readonly [string, string]> = [
	["httpsProxy", "https-proxy"],
	["httpProxy", "http-proxy"],
	["proxy", "proxy"],
	["localAddress", "local-address"],
];

/** The routes of a `registries` value, `[npmrc key, url]` in declaration order, or `undefined` for a shape pnpm refuses. */
const registryRoutes = (value: unknown): ReadonlyArray<readonly [string, string]> | undefined => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const entries = Object.entries(value);
	const routes: Array<readonly [string, string]> = [];
	// The older `<scope>: <url>` shape: every entry a string (`registries.rs` `validate`).
	if (entries.every(([, entry]) => typeof entry === "string")) {
		for (const [scope, url] of entries as ReadonlyArray<readonly [string, string]>) {
			if (scope === "default") routes.push(["registry", url]);
			else if (scopeOf(`${scope}:registry`) !== undefined) routes.push([`${scope}:registry`, url]);
		}
		return routes;
	}
	// The declaration shape, keyed by registry URL; the two shapes mixed is refused.
	for (const [url, declaration] of entries) {
		if (declaration === null || typeof declaration !== "object" || Array.isArray(declaration)) return undefined;
		const scopes = (declaration as Record<string, unknown>).scopes;
		if (scopes === undefined) continue;
		if (!Array.isArray(scopes)) return undefined;
		for (const scope of scopes) {
			if (scope === "@") routes.push(["registry", url]);
			else if (typeof scope === "string" && scopeOf(`${scope}:registry`) !== undefined)
				routes.push([`${scope}:registry`, url]);
		}
	}
	return routes;
};

/** A registry URL with its userinfo removed, for naming it in an error (`redact_registry_url`). */
const redactUrl = (url: string): string => url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/?#]*@/, "$1");

/**
 * The first registry setting of a repository file whose URL holds a
 * placeholder, in the order pnpm checks them (`workspace_yaml/env.rs`
 * `refuse_unexpanded_registries`): `registry`, every `namedRegistries` URL,
 * then every `registries` entry's destination, a scope route's value or a
 * declaration's key, whether or not it routes anything
 * (`registries/env_placeholders.rs` `refuse_env_placeholder_entries`).
 */
const refusedRegistry = (settings: Readonly<Record<string, unknown>>): UntrustedRegistry | undefined => {
	const own = (name: string): unknown => (Object.hasOwn(settings, name) ? settings[name] : undefined);
	const registry = own("registry");
	if (typeof registry === "string" && hasPlaceholder(registry)) return { setting: "registry" };
	const mapping = (value: unknown): ReadonlyArray<readonly [string, unknown]> =>
		value !== null && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
	for (const [name, url] of mapping(own("namedRegistries"))) {
		if (typeof url === "string" && hasPlaceholder(url)) return { setting: `namedRegistries['${redactUrl(name)}']` };
	}
	for (const [key, entry] of mapping(own("registries"))) {
		const destination = typeof entry === "string" ? entry : key;
		if (hasPlaceholder(destination)) return { setting: `registries['${redactUrl(key)}']` };
	}
	return undefined;
};

/**
 * One pnpm settings layer's registry, proxy and TLS settings, as npmrc lines.
 *
 * @remarks
 * pnpm 12 reads `registry`, `registries` (files only), `httpsProxy`,
 * `httpProxy`, `proxy`, `noProxy`, `noproxy`, `strictSsl` and `localAddress`
 * from `pnpm-workspace.yaml`, the global `config.yaml` and `PNPM_CONFIG_*`
 * (`workspace_yaml/settings.rs`, `env_overlay.rs` `read_registry_env` and
 * `read_network_env`); never a CA, a client certificate or a credential
 * (`registries.rs` refuses them in `registries`). Within a layer `registries`
 * applies before `registry`, so `registry` wins the default
 * (`workspace_yaml/apply.rs` `apply_registry_settings`).
 *
 * A named setting occupies its key even when it reads as unset
 * (`proxy_keys.rs`): an empty proxy masks the layers below it, and a
 * `noProxy` that is neither a string nor `true` is written empty. `strictSsl`
 * reads as a boolean (a JSON boolean in the environment, a boolean or
 * boolean word in a file); anything else is skipped. Values are expanded
 * (`workspace_yaml/env.rs` `substitute_env_trusted`), except that in an
 * untrusted file a proxy holding a placeholder is dropped and a registry URL
 * holding one refuses the load (`substitute_env_untrusted`).
 */
export const overlayLines = (layer: OverlayLayer, env: Env): LinesResult => {
	const settings: Readonly<Record<string, unknown>> = layer.settings;
	const trusted = layer._tag === "environment" || layer.trusted;
	const own = (name: string): unknown => (Object.hasOwn(settings, name) ? settings[name] : undefined);
	const text = (name: string): string | undefined => {
		const value = own(name);
		return typeof value === "string" ? value : undefined;
	};
	const out: Array<string | undefined> = [];
	if (!trusted) {
		const refused = refusedRegistry(settings);
		if (refused !== undefined) return { _tag: "untrusted", failure: refused };
	}
	if (layer._tag === "file") {
		for (const [key, url] of registryRoutes(own("registries")) ?? [])
			out.push(npmrcLine(key, expandPlaceholders(url, env)));
	}
	const registry = text("registry");
	if (registry !== undefined) out.push(npmrcLine("registry", expandPlaceholders(registry, env)));
	for (const [name, key] of STRING_SETTINGS) {
		const value = text(name);
		if (value === undefined) continue;
		// `localAddress` is expanded even in a repository file; the proxies are not.
		if (!trusted && name !== "localAddress" && hasPlaceholder(value)) continue;
		out.push(npmrcLine(key, expandPlaceholders(value, env)));
	}
	for (const [name, key] of [
		["noProxy", "no-proxy"],
		["noproxy", "noproxy"],
	] as const) {
		const value = own(name);
		if (value === undefined || value === null) continue;
		if (typeof value === "string") {
			if (!trusted && hasPlaceholder(value)) continue;
			out.push(npmrcLine(key, expandPlaceholders(value, env)));
		} else {
			out.push(npmrcLine(key, value === true ? "true" : ""));
		}
	}
	const strictSsl = own("strictSsl");
	if (strictSsl !== undefined && strictSsl !== null) {
		const flag = layer._tag === "environment" ? booleanFromText(strictSsl as string) : booleanFromValue(strictSsl);
		if (flag !== undefined) out.push(npmrcLine("strict-ssl", flag ? "true" : "false"));
	}
	return lines(out);
};

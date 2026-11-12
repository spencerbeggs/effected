/**
 * The per-origin undici dispatcher behind `NpmHttpClient`, and the pure
 * resolution that decides, for one request URL, which proxy and which TLS
 * options a connection uses.
 *
 * Reached only from `NpmHttpClient.ts`, and so only from the `./node`
 * entry: this module imports undici through `@effect/platform-node/Undici`.
 *
 * @internal
 */

import { Agent, Dispatcher, ProxyAgent } from "@effect/platform-node/Undici";
import type { NpmConfig, NpmRegistryTls } from "@effected/npm";
import { Option, Redacted } from "effect";

/** The rules to follow: npm's or pnpm's. */
export type PackageManagerRules = "npm" | "pnpm";

/** One file a transport setting names, and the setting that names it. */
export interface TransportFile {
	readonly setting: "cafile" | "certfile" | "keyfile";
	readonly path: string;
}

/** The TLS and socket options one connection uses. */
export interface ConnectionTls {
	readonly ca?: ReadonlyArray<string>;
	readonly cert?: string;
	readonly key?: string;
	readonly rejectUnauthorized: boolean;
	readonly localAddress?: string;
}

/** How one request connects: through a proxy or directly, with which TLS options. */
export interface Connection {
	readonly proxy: string | undefined;
	readonly tls: ConnectionTls;
	/** Identity of the connection: requests with equal keys share one child dispatcher. */
	readonly key: string;
}

/** What the resolution needs besides the URL. */
export interface ConnectionContext {
	readonly config: NpmConfig;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly packageManager: PackageManagerRules;
	/** Every file in {@link transportFiles}, read: path as written to contents. */
	readonly files: ReadonlyMap<string, string>;
}

/**
 * Inline PEM written on one npmrc line carries its newlines as `\n`; pnpm
 * (`expand_inline_pem`) and Node's TLS both want real ones.
 */
const expandPem = (value: string): string => value.replaceAll("\\n", "\n");

/** A per-registry TLS key, `//host[:port]/path/:field`, split into its prefix and field. */
const REGISTRY_FILE_KEY = /^(\/\/.*):(cafile|certfile|keyfile)$/;

/**
 * Every file the transport could need, in setting order and without
 * duplicates: the top-level `cafile`, then each registry's files the chosen
 * manager reads (npm: a `certfile` and `keyfile` pair only; pnpm: `cafile`,
 * `certfile` and `keyfile`, alone or together).
 *
 * @remarks
 * Read up front because a dispatcher routes synchronously: the layer reads
 * these once, through `FileSystem`, before the first request.
 */
export const transportFiles = (
	config: NpmConfig,
	packageManager: PackageManagerRules,
): ReadonlyArray<TransportFile> => {
	const found: Array<TransportFile> = [];
	const seen = new Set<string>();
	const add = (setting: TransportFile["setting"], path: string | undefined): void => {
		if (path === undefined || path === "" || seen.has(`${setting}\0${path}`)) return;
		seen.add(`${setting}\0${path}`);
		found.push({ setting, path });
	};
	add("cafile", config.transport.cafile);
	const value = (key: string): string | undefined =>
		Object.hasOwn(config.settings, key) ? config.settings[key] : undefined;
	for (const key of Object.keys(config.settings)) {
		const match = REGISTRY_FILE_KEY.exec(key);
		if (match === null) continue;
		const prefix = match[1] as string;
		const field = match[2] as TransportFile["setting"];
		if (packageManager === "npm") {
			// npm reads the pair only, and only when both halves are set.
			if (field === "cafile") continue;
			const certfile = value(`${prefix}:certfile`);
			const keyfile = value(`${prefix}:keyfile`);
			if (certfile === undefined || certfile === "" || keyfile === undefined || keyfile === "") continue;
		}
		add(field, value(key));
	}
	return found;
};

/** A host no bypass list names in practice: `.invalid` is reserved (RFC 2606). */
const PROBE_HOST = "npm-transport-check.invalid";

/** The proxy schemes undici's `ProxyAgent` dials: http and https proxies, and SOCKS5. */
const PROXY_PROTOCOLS = new Set(["http:", "https:", "socks:", "socks5:"]);

/**
 * Whether a proxy {@link NpmConfig.proxyFor} could return is unusable: it
 * does not parse as a URL, or its scheme is not one undici's `ProxyAgent`
 * dials.
 *
 * @remarks
 * Only answers `proxyFor` can give are checked: it is asked for an `https:`
 * and an `http:` request to a reserved host, so a variable the manager does
 * not read, a proxy the manager's precedence never reaches, and `proxy=false`
 * under pnpm are never judged. A scheme-less `proxy.corp:8080` parses as a URL
 * whose protocol is `proxy.corp:`, so the protocol is checked, not only the
 * parse; pnpm gives such a proxy the request's scheme before it gets here.
 */
export const hasUnusableProxy = (
	config: NpmConfig,
	env: Readonly<Record<string, string | undefined>>,
	packageManager: PackageManagerRules,
): boolean =>
	[`https://${PROBE_HOST}/`, `http://${PROBE_HOST}/`].some((url) =>
		Option.match(config.proxyFor(url, env, { packageManager }), {
			onNone: () => false,
			onSome: (proxy) => {
				const parsed = URL.parse(Redacted.value(proxy));
				return parsed === null || !PROXY_PROTOCOLS.has(parsed.protocol);
			},
		}),
	);

/** A file the layer read, by the path written in the npmrc. */
const fileOf = (files: ReadonlyMap<string, string>, path: string | undefined): string | undefined =>
	path === undefined || path === "" ? undefined : files.get(path);

/**
 * The client certificate and key a request presents, by the chosen manager's
 * rules: npm takes a registry's `certfile`/`keyfile` pair, else the
 * deprecated top-level `cert`/`key`; pnpm takes each of a registry's
 * `cert`/`certfile` and `key`/`keyfile`, else the top-level one.
 */
const identityOf = (
	registry: Option.Option<NpmRegistryTls>,
	context: ConnectionContext,
): { readonly cert?: string; readonly key?: string } => {
	const transport = context.config.transport;
	const topCert = transport.cert === undefined ? undefined : expandPem(Redacted.value(transport.cert));
	const topKey = transport.key === undefined ? undefined : expandPem(Redacted.value(transport.key));
	const own = Option.getOrUndefined(registry);
	const ownCert =
		own === undefined
			? undefined
			: own.cert !== undefined
				? expandPem(Redacted.value(own.cert))
				: fileOf(context.files, own.certfile);
	const ownKey =
		own === undefined
			? undefined
			: own.key !== undefined
				? expandPem(Redacted.value(own.key))
				: fileOf(context.files, own.keyfile);
	const cert = ownCert ?? topCert;
	const key = ownKey ?? topKey;
	return { ...(cert === undefined ? {} : { cert }), ...(key === undefined ? {} : { key }) };
};

/**
 * The certificate authorities a request trusts, or `undefined` for Node's
 * default store.
 *
 * @remarks
 * npm: `cafile`'s certificates replace `ca`. pnpm: `ca` and then `cafile`'s
 * certificates, together; a registry's own `ca`/`cafile` replace both.
 */
const caOf = (
	registry: Option.Option<NpmRegistryTls>,
	context: ConnectionContext,
): ReadonlyArray<string> | undefined => {
	const transport = context.config.transport;
	const inline = transport.ca === undefined ? undefined : expandPem(transport.ca);
	const file = fileOf(context.files, transport.cafile);
	if (context.packageManager === "pnpm") {
		const own = Option.getOrUndefined(registry);
		if (own !== undefined && (own.ca !== undefined || own.cafile !== undefined)) {
			const list = [own.ca === undefined ? undefined : expandPem(own.ca), fileOf(context.files, own.cafile)].filter(
				(entry): entry is string => entry !== undefined,
			);
			return list.length === 0 ? undefined : list;
		}
		const list = [inline, file].filter((entry): entry is string => entry !== undefined);
		return list.length === 0 ? undefined : list;
	}
	return file !== undefined ? [file] : inline !== undefined ? [inline] : undefined;
};

/** How a request to `url` connects, under {@link ConnectionContext}'s rules. Pure. */
export const connectionFor = (url: string, context: ConnectionContext): Connection => {
	const options = { packageManager: context.packageManager };
	const proxy = Option.getOrUndefined(context.config.proxyFor(url, context.env, options));
	const registry = context.config.tlsFor(url, options);
	const transport = context.config.transport;
	const ca = caOf(registry, context);
	const tls: ConnectionTls = {
		rejectUnauthorized: transport.strictSsl,
		...(ca === undefined ? {} : { ca }),
		...identityOf(registry, context),
		...(transport.localAddress === undefined ? {} : { localAddress: transport.localAddress }),
	};
	const uri = proxy === undefined ? undefined : Redacted.value(proxy);
	return {
		proxy: uri,
		tls,
		key: JSON.stringify([
			uri ?? null,
			tls.ca ?? null,
			tls.cert ?? null,
			tls.key ?? null,
			tls.rejectUnauthorized,
			tls.localAddress ?? null,
		]),
	};
};

/** Node TLS options from a {@link ConnectionTls}, with the readonly array copied. */
const nodeTls = (tls: ConnectionTls) => ({
	rejectUnauthorized: tls.rejectUnauthorized,
	...(tls.ca === undefined ? {} : { ca: [...tls.ca] }),
	...(tls.cert === undefined ? {} : { cert: tls.cert }),
	...(tls.key === undefined ? {} : { key: tls.key }),
	...(tls.localAddress === undefined ? {} : { localAddress: tls.localAddress }),
});

/** A child dispatcher for one {@link Connection}. */
const childFor = (connection: Connection): Dispatcher =>
	connection.proxy === undefined
		? new Agent({ connect: nodeTls(connection.tls) })
		: new ProxyAgent({
				uri: connection.proxy,
				requestTls: nodeTls(connection.tls),
				proxyTls: {
					rejectUnauthorized: connection.tls.rejectUnauthorized,
					...(connection.tls.ca === undefined ? {} : { ca: [...connection.tls.ca] }),
				},
			});

/**
 * An undici dispatcher that routes each request by its URL: it asks
 * {@link connectionFor} which proxy and TLS options the request needs, and
 * delegates to a child `Agent` or `ProxyAgent` created lazily for each
 * distinct answer. Closing or destroying it closes every child.
 *
 * @remarks
 * One client holds one dispatcher, but a proxy, a bypass list and a client
 * certificate can each differ per registry, so a stock `Agent` or
 * `ProxyAgent` cannot serve a configuration with more than one registry.
 */
export class OriginDispatcher extends Dispatcher {
	readonly #children = new Map<string, Dispatcher>();
	readonly #context: ConnectionContext;
	#closed = false;

	constructor(context: ConnectionContext) {
		super();
		this.#context = context;
	}

	override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
		if (this.#closed) throw new Error("The npm transport dispatcher is closed");
		const origin = options.origin === undefined ? "" : String(options.origin);
		const url = new URL(options.path, origin).href;
		const connection = connectionFor(url, this.#context);
		let child = this.#children.get(connection.key);
		if (child === undefined) {
			child = childFor(connection);
			this.#children.set(connection.key, child);
		}
		return child.dispatch(options, handler);
	}

	override close(): Promise<void>;
	override close(callback: () => void): void;
	override close(callback?: () => void): Promise<void> | void {
		this.#closed = true;
		const done = Promise.all([...this.#children.values()].map((child) => child.close())).then(() => undefined);
		if (callback === undefined) return done;
		void done.then(callback, callback);
	}

	override destroy(): Promise<void>;
	override destroy(error: Error | null): Promise<void>;
	override destroy(callback: () => void): void;
	override destroy(error: Error | null, callback: () => void): void;
	override destroy(first?: Error | null | (() => void), second?: () => void): Promise<void> | void {
		this.#closed = true;
		const error = typeof first === "function" ? null : (first ?? null);
		const callback = typeof first === "function" ? first : second;
		const done = Promise.all([...this.#children.values()].map((child) => child.destroy(error))).then(() => undefined);
		if (callback === undefined) return done;
		void done.then(callback, callback);
	}
}

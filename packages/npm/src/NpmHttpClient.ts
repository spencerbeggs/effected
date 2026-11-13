import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import type { NpmConfig } from "@effected/npm";
import { Effect, FileSystem, Layer } from "effect";
import type { HttpClient } from "effect/http";
import type { PackageManagerRules } from "./internal/originDispatcher.js";
import { OriginDispatcher, hasUnusableProxy, transportFiles } from "./internal/originDispatcher.js";
import { NpmTransportError } from "./NpmTransportError.js";

/**
 * Options for {@link NpmHttpClient.layer}.
 *
 * @public
 */
export interface NpmHttpClientOptions {
	/**
	 * The environment, for the proxy variables (`HTTPS_PROXY`, `NO_PROXY`
	 * and the rest). Pass the record given to `NpmConfig.load`; nothing here
	 * reads `process.env`. Defaults to an empty record: no proxy variables.
	 */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/**
	 * Whose rules decide the proxy and a registry's TLS settings: `"npm"`
	 * (the default) or `"pnpm"`. A tool replacing `pnpm view` passes
	 * `"pnpm"`; see `ProxyForOptions`.
	 */
	readonly packageManager?: "npm" | "pnpm";
}

/**
 * The Node HTTP client that honours an npm configuration's transport
 * settings: `proxy`, `https-proxy` (and pnpm's `http-proxy`), `noproxy`,
 * `ca`, `cafile`, `strict-ssl`, `cert`/`key`, `local-address`, and each
 * registry's `//host/:certfile` and `:keyfile` (and, under pnpm's rules,
 * `:ca`, `:cafile`, `:cert` and `:key`).
 *
 * @remarks
 * `NpmRegistry` and `PackageTarball` send every request through the core
 * `HttpClient` in their requirements, and a plain client knows nothing of an
 * npmrc: behind a corporate proxy or against a registry signed by an
 * internal CA, every read fails as `RegistryReadError` `"transport"`. Provide
 * this layer as that client and they connect the way npm (or pnpm) would.
 *
 * It is `@effect/platform-node`'s undici client
 * (`NodeHttpClient.layerUndiciNoDispatcher`) over a dispatcher that routes
 * each request by its URL, because the proxy and the client certificate can
 * differ per registry and a client holds one dispatcher. The decisions are
 * `NpmConfig.proxyFor` and `NpmConfig.tlsFor`, so a bypass list, `proxy=false`
 * under pnpm and a registry's own certificate follow the same rules those
 * methods document. Connections are pooled per distinct proxy and TLS
 * answer and closed with the layer's scope.
 *
 * The environment proxies (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` and their
 * lower-case spellings) apply only when the caller passes `env`: the layer
 * never reads `process.env`, so a layer built without `env` connects directly
 * however the shell is configured.
 *
 * Every file a setting names (`cafile`, and each registry's files that the
 * chosen manager reads) is read through `FileSystem` when the layer is
 * built, and one that cannot be read fails the layer with
 * {@link NpmTransportError}, as does a proxy URL that does not parse. Paths
 * are used as written: a relative `cafile` resolves against the working
 * directory, where pnpm resolves it against the npmrc's directory. The array
 * settings `ca[]` and `noproxy[]` are applied: every `ca[]` line is trusted
 * (npm reads `ca` as a string or a list; pnpm collects successive `ca` lines
 * ahead of `cafile`'s certificates).
 *
 * Node only: it needs `@effect/platform-node`, an optional peer of this
 * package. A runtime without it (Cloudflare Workers) keeps a plain fetch
 * client and has no proxy or custom CA support. The settings are as
 * trustworthy as the npmrc they came from; see `NpmTransportSettings`.
 *
 * Each call builds a new layer, and layers memoize by reference: bind the
 * result to a `const` once and reuse it, or the dispatcher and its
 * connections are built twice.
 *
 * @example
 * ```ts
 * import { NpmConfig, NpmRegistry } from "@effected/npm";
 * import { NpmHttpClient } from "@effected/npm/node";
 * import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
 * import { Effect, Layer } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const config = yield* NpmConfig.load({ cwd: process.cwd(), env: process.env });
 *   const registryLayer = NpmRegistry.layer.pipe(
 *     Layer.provide(NpmHttpClient.layer(config, { env: process.env, packageManager: "pnpm" })),
 *   );
 *   return yield* Effect.gen(function* () {
 *     const registry = yield* NpmRegistry;
 *     return yield* registry.versions("effect", config.targetFor("effect"));
 *   }).pipe(Effect.provide(registryLayer));
 * }).pipe(Effect.provide(NodeFileSystem.layer));
 * ```
 *
 * @public
 */
export class NpmHttpClient {
	private constructor() {}

	/**
	 * An `HttpClient` that applies `config`'s transport settings; see
	 * {@link NpmHttpClient}.
	 *
	 * @param config - The npm configuration whose transport settings apply.
	 * @param options - The environment and whose rules to follow.
	 */
	static readonly layer = (
		config: NpmConfig,
		options: NpmHttpClientOptions = {},
	): Layer.Layer<HttpClient.HttpClient, NpmTransportError, FileSystem.FileSystem> =>
		Layer.provide(
			NodeHttpClient.layerUndiciNoDispatcher,
			Layer.effect(NodeHttpClient.Dispatcher, makeDispatcher(config, options)),
		);
}

/** Reads every transport file, then acquires the routing dispatcher for the layer's scope. */
const makeDispatcher = Effect.fn("NpmHttpClient.layer")(function* (config: NpmConfig, options: NpmHttpClientOptions) {
	const env = options.env ?? {};
	const packageManager: PackageManagerRules = options.packageManager ?? "npm";
	if (hasUnusableProxy(config, env, packageManager)) {
		return yield* new NpmTransportError({ setting: "proxy" });
	}
	const fs = yield* FileSystem.FileSystem;
	const files = new Map<string, string>();
	for (const file of transportFiles(config, packageManager)) {
		if (files.has(file.path)) continue;
		const text = yield* fs
			.readFileString(file.path)
			.pipe(Effect.mapError((cause) => new NpmTransportError({ setting: file.setting, path: file.path, cause })));
		files.set(file.path, text);
	}
	return yield* Effect.acquireRelease(
		Effect.sync(() => new OriginDispatcher({ config, env, packageManager, files })),
		(dispatcher) => Effect.promise(() => dispatcher.destroy()),
	);
});

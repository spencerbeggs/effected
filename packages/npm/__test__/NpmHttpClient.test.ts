// Real servers, real TLS: these tests read their certificates through the
// platform `NodeFileSystem` (and node:https reads them directly), because a
// TLS handshake needs real PEM files a memory volume cannot serve to the
// server side. The tests that need no handshake use `@effected/memfs`.
//
// No certificate or key is committed: `Tls.layer` generates a throwaway CA, a
// server certificate (SAN `DNS:localhost`, `IP:127.0.0.1`) and a client
// certificate with the `openssl` CLI into a temporary directory, removed when
// the suite's layer closes. Without `openssl` on PATH the layer dies and every
// test fails naming it; nothing is skipped.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { assert, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { NpmHttpClient } from "@effected/npm/node";
import { Context, Effect, Layer, Option, Result } from "effect";
import { NpmConfig } from "../src/NpmConfig.js";
import { NpmRegistry } from "../src/NpmRegistry.js";

/** The generated certificates: paths for npmrc settings, PEM text for the servers. */
interface TlsShape {
	readonly dir: string;
	readonly ca: string;
	readonly clientCert: string;
	readonly clientKey: string;
	readonly caPem: string;
	readonly serverPem: string;
	readonly serverKey: string;
}

/** Runs one `openssl` command in `cwd`, throwing (a defect, so every test fails) when it cannot. */
const openssl = (cwd: string, args: ReadonlyArray<string>): void => {
	const result = spawnSync("openssl", args, { cwd, encoding: "utf8" });
	if (result.error !== undefined) {
		throw new Error(
			`The NpmHttpClient tests need the openssl CLI on PATH to generate their TLS certificates: ${result.error.message}`,
		);
	}
	if (result.status !== 0) throw new Error(`openssl ${args.join(" ")} failed: ${result.stderr}`);
};

/** A throwaway CA, a server certificate for localhost/127.0.0.1 and a client certificate, in a new temp directory. */
const generateTls = (): TlsShape => {
	const dir = mkdtempSync(join(tmpdir(), "effected-npm-tls-"));
	try {
		const days = ["-days", "2"];
		openssl(dir, [
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			"ca.key",
			"-out",
			"ca.pem",
			...days,
			"-subj",
			"/CN=effected npm test CA",
			"-addext",
			"basicConstraints=critical,CA:TRUE",
			"-addext",
			"keyUsage=critical,keyCertSign,cRLSign",
		]);
		writeFileSync(
			join(dir, "server.ext"),
			"subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n",
		);
		writeFileSync(join(dir, "client.ext"), "basicConstraints=CA:FALSE\nextendedKeyUsage=clientAuth\n");
		for (const [name, subject] of [
			["server", "/CN=localhost"],
			["client", "/CN=effected npm test client"],
		] as const) {
			openssl(dir, [
				"req",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-keyout",
				`${name}.key`,
				"-out",
				`${name}.csr`,
				"-subj",
				subject,
			]);
			openssl(dir, [
				"x509",
				"-req",
				"-in",
				`${name}.csr`,
				"-CA",
				"ca.pem",
				"-CAkey",
				"ca.key",
				"-CAcreateserial",
				"-out",
				`${name}.pem`,
				...days,
				"-extfile",
				`${name}.ext`,
			]);
		}
		const read = (name: string): string => readFileSync(join(dir, name), "utf8");
		return {
			dir,
			ca: join(dir, "ca.pem"),
			clientCert: join(dir, "client.pem"),
			clientKey: join(dir, "client.key"),
			caPem: read("ca.pem"),
			serverPem: read("server.pem"),
			serverKey: read("server.key"),
		};
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
};

/** The suite's certificates, generated once per suite and removed when its layer closes. */
class Tls extends Context.Service<Tls, TlsShape>()("@effected/npm/test/NpmHttpClient/Tls") {
	static readonly layer = Layer.effect(
		this,
		Effect.acquireRelease(Effect.sync(generateTls), (tls) =>
			Effect.sync(() => rmSync(tls.dir, { recursive: true, force: true })),
		),
	);
}

/** A packument naming one version, as a registry serves it. */
const packument = (name: string) => JSON.stringify({ name, versions: { "1.0.0": {} } });

/** What a registry server saw: one entry per request, the client certificate's CN or undefined. */
interface Registry {
	readonly port: number;
	readonly url: string;
	readonly peers: ReadonlyArray<string | undefined>;
}

const listen = (server: Server): Effect.Effect<number> =>
	Effect.callback<number>((resume) => {
		server.listen(0, "127.0.0.1", () => resume(Effect.succeed((server.address() as AddressInfo).port)));
	});

const close = (server: Server): Effect.Effect<void> =>
	Effect.callback<void>((resume) => {
		server.closeAllConnections();
		server.close(() => resume(Effect.void));
	});

/**
 * An https registry listening on 127.0.0.1, signed by the generated CA, recording any client certificate it
 * was shown. `host` only changes the URL the config names (`localhost` resolves to the same listener).
 */
const httpsRegistry = (options: { readonly requestCert?: boolean; readonly host?: string } = {}) =>
	Effect.gen(function* () {
		const tls = yield* Tls;
		const peers: Array<string | undefined> = [];
		const handler = (request: IncomingMessage, response: ServerResponse) => {
			const certificate = (request.socket as TLSSocket).getPeerCertificate();
			const cn = certificate?.subject?.CN;
			peers.push(Array.isArray(cn) ? cn.join(",") : cn);
			const name = decodeURIComponent((request.url ?? "/").slice(1));
			response.writeHead(200, { "content-type": "application/json" });
			response.end(packument(name));
		};
		const server = createHttpsServer(
			{
				cert: tls.serverPem,
				key: tls.serverKey,
				...(options.requestCert === true ? { requestCert: true, rejectUnauthorized: false } : {}),
			},
			handler,
		);
		const port = yield* Effect.acquireRelease(listen(server), () => close(server));
		return { port, url: `https://${options.host ?? "127.0.0.1"}:${port}/`, peers } satisfies Registry;
	});

/** An http CONNECT proxy on 127.0.0.1 recording every tunnel target. */
const connectProxy = Effect.gen(function* () {
	const targets: Array<string> = [];
	const server = createHttpServer();
	server.on("connect", (request, socket, head) => {
		targets.push(request.url ?? "");
		const [host, port] = (request.url ?? "").split(":");
		const upstream = connect(Number(port), host, () => {
			socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			upstream.write(head);
			upstream.pipe(socket);
			socket.pipe(upstream);
		});
		upstream.on("error", () => socket.destroy());
		socket.on("error", () => upstream.destroy());
	});
	const port = yield* Effect.acquireRelease(listen(server), () => close(server));
	return { url: `http://127.0.0.1:${port}`, targets };
});

const configOf = (...lines: ReadonlyArray<string>): NpmConfig => {
	const result = NpmConfig.fromSourcesResult([{ text: lines.join("\n") }], {});
	if (Result.isFailure(result)) throw new Error(`unexpected failure: ${result.failure.message}`);
	return result.success;
};

/** `NpmRegistry.versions` for `name` over the npm/node client, reading files from the real disk. */
const versions = (config: NpmConfig, name: string, options: Parameters<typeof NpmHttpClient.layer>[1] = {}) =>
	Effect.gen(function* () {
		const registry = yield* NpmRegistry;
		return yield* registry.versions(name, config.targetFor(name));
	}).pipe(
		Effect.provide(
			NpmRegistry.layer.pipe(Layer.provide(NpmHttpClient.layer(config, options)), Layer.provide(NodeFileSystem.layer)),
		),
	);

layer(Tls.layer)("NpmHttpClient", (it) => {
	it.effect("routes https registry reads through https-proxy", () =>
		Effect.gen(function* () {
			const tls = yield* Tls;
			const registry = yield* httpsRegistry();
			const proxy = yield* connectProxy;
			const config = configOf(`registry=${registry.url}`, `cafile=${tls.ca}`, `https-proxy=${proxy.url}`);
			const found = yield* versions(config, "pkg");
			assert.deepStrictEqual(Option.getOrUndefined(found), ["1.0.0"]);
			assert.deepStrictEqual(proxy.targets, [`127.0.0.1:${registry.port}`]);
		}),
	);

	it.effect("bypasses the proxy for a noproxy host", () =>
		Effect.gen(function* () {
			const tls = yield* Tls;
			const registry = yield* httpsRegistry();
			const proxy = yield* connectProxy;
			const config = configOf(
				`registry=${registry.url}`,
				`cafile=${tls.ca}`,
				`https-proxy=${proxy.url}`,
				"noproxy=.localhost,127.0.0.1",
			);
			const found = yield* versions(config, "pkg");
			assert.deepStrictEqual(Option.getOrUndefined(found), ["1.0.0"]);
			assert.deepStrictEqual(proxy.targets, []);
			assert.lengthOf(registry.peers, 1, "the read went direct");
		}),
	);

	it.effect("bypasses the proxy for a noproxy host while other registries still use it", () =>
		Effect.gen(function* () {
			const tls = yield* Tls;
			const direct = yield* httpsRegistry({ host: "localhost" });
			const proxied = yield* httpsRegistry();
			const proxy = yield* connectProxy;
			const config = configOf(
				`registry=${direct.url}`,
				`@other:registry=${proxied.url}`,
				`cafile=${tls.ca}`,
				`https-proxy=${proxy.url}`,
				"noproxy=.localhost",
			);
			// One layer, so one dispatcher, serves both reads.
			const [first, second] = yield* Effect.all([
				Effect.gen(function* () {
					const registry = yield* NpmRegistry;
					return yield* registry.versions("pkg", config.targetFor("pkg"));
				}),
				Effect.gen(function* () {
					const registry = yield* NpmRegistry;
					return yield* registry.versions("@other/pkg", config.targetFor("@other/pkg"));
				}),
			]).pipe(
				Effect.provide(
					NpmRegistry.layer.pipe(Layer.provide(NpmHttpClient.layer(config)), Layer.provide(NodeFileSystem.layer)),
				),
			);
			assert.deepStrictEqual(Option.getOrUndefined(first), ["1.0.0"]);
			assert.deepStrictEqual(Option.getOrUndefined(second), ["1.0.0"]);
			assert.deepStrictEqual(proxy.targets, [`127.0.0.1:${proxied.port}`]);
			assert.lengthOf(direct.peers, 1, "the localhost read went direct");
		}),
	);

	it.effect("proxy=false disables the proxy under pnpm rules", () =>
		Effect.gen(function* () {
			const tls = yield* Tls;
			const registry = yield* httpsRegistry();
			const proxy = yield* connectProxy;
			const config = configOf(`registry=${registry.url}`, `cafile=${tls.ca}`, "proxy=false");
			const env = { HTTPS_PROXY: proxy.url };
			// The control: npm reads `proxy=false` as unset and still takes HTTPS_PROXY.
			yield* versions(config, "pkg", { env });
			assert.deepStrictEqual(proxy.targets, [`127.0.0.1:${registry.port}`]);
			yield* versions(config, "pkg", { env, packageManager: "pnpm" });
			assert.deepStrictEqual(proxy.targets, [`127.0.0.1:${registry.port}`], "pnpm went direct");
			assert.lengthOf(registry.peers, 2);
		}),
	);

	it.effect("trusts a registry signed by cafile", () =>
		Effect.gen(function* () {
			const tls = yield* Tls;
			const registry = yield* httpsRegistry();
			const trusted = yield* versions(configOf(`registry=${registry.url}`, `cafile=${tls.ca}`), "pkg");
			assert.deepStrictEqual(Option.getOrUndefined(trusted), ["1.0.0"]);
			const error = yield* Effect.flip(versions(configOf(`registry=${registry.url}`), "pkg"));
			if (error._tag !== "RegistryReadError") return assert.fail(`expected RegistryReadError, got ${error._tag}`);
			assert.strictEqual(error.kind, "transport");
		}),
	);

	it.effect("trusts an inline ca", () =>
		Effect.gen(function* () {
			const tls = yield* Tls;
			const registry = yield* httpsRegistry();
			// npmrc values are one line: `ca` carries the PEM with its newlines escaped.
			const inline = tls.caPem.trim().split("\n").join("\\n");
			const found = yield* versions(configOf(`registry=${registry.url}`, `ca="${inline}"`), "pkg");
			assert.deepStrictEqual(Option.getOrUndefined(found), ["1.0.0"]);
		}),
	);

	it.effect("strict-ssl=false accepts an untrusted certificate", () =>
		Effect.gen(function* () {
			const registry = yield* httpsRegistry();
			const found = yield* versions(configOf(`registry=${registry.url}`, "strict-ssl=false"), "pkg");
			assert.deepStrictEqual(Option.getOrUndefined(found), ["1.0.0"]);
		}),
	);

	it.effect("presents the per-registry client certificate", () =>
		Effect.gen(function* () {
			const tls = yield* Tls;
			const withCert = yield* httpsRegistry({ requestCert: true });
			const without = yield* httpsRegistry({ requestCert: true });
			const config = configOf(
				`registry=${withCert.url}`,
				`@other:registry=${without.url}`,
				`cafile=${tls.ca}`,
				`//127.0.0.1:${withCert.port}/:certfile=${tls.clientCert}`,
				`//127.0.0.1:${withCert.port}/:keyfile=${tls.clientKey}`,
			);
			yield* versions(config, "pkg");
			yield* versions(config, "@other/pkg");
			assert.deepStrictEqual(withCert.peers, ["effected npm test client"]);
			assert.deepStrictEqual(without.peers, [undefined]);
		}),
	);

	it.effect("fails typed on a missing cafile", () =>
		Effect.gen(function* () {
			const config = configOf("registry=https://registry.example.test/", "cafile=/nope/ca.pem");
			const error = yield* Effect.flip(
				Layer.build(NpmHttpClient.layer(config)).pipe(Effect.provide(MemoryFileSystem.layer)),
			);
			assert.strictEqual(error._tag, "NpmTransportError");
			assert.strictEqual(error.setting, "cafile");
			assert.strictEqual(error.path, "/nope/ca.pem");
		}),
	);

	it.effect("fails typed on a missing per-registry keyfile", () =>
		Effect.gen(function* () {
			const config = configOf(
				"registry=https://registry.example.test/",
				"//registry.example.test/:certfile=/certs/client.pem",
				"//registry.example.test/:keyfile=/certs/client.key",
			);
			const error = yield* Effect.flip(
				Layer.build(NpmHttpClient.layer(config)).pipe(
					Effect.provide(MemoryFileSystem.layerWith({ "/certs/client.pem": "PEM" })),
				),
			);
			assert.strictEqual(error._tag, "NpmTransportError");
			assert.strictEqual(error.setting, "keyfile");
			assert.strictEqual(error.path, "/certs/client.key");
		}),
	);

	it.effect("fails typed on an unparseable proxy without echoing it", () =>
		Effect.gen(function* () {
			const config = configOf("registry=https://registry.example.test/", "https-proxy=http://user:hunter2@[bad");
			const error = yield* Effect.flip(
				Layer.build(NpmHttpClient.layer(config)).pipe(Effect.provide(MemoryFileSystem.layer)),
			);
			assert.strictEqual(error._tag, "NpmTransportError");
			assert.strictEqual(error.setting, "proxy");
			assert.notInclude(JSON.stringify(error), "hunter2");
			assert.notInclude(error.message, "hunter2");
		}),
	);

	it.effect("fails typed on a scheme-less proxy under npm rules, and gives it a scheme under pnpm's", () =>
		Effect.gen(function* () {
			// `proxy.corp:8080` parses as a URL whose protocol is `proxy.corp:`: only the scheme check catches it.
			const config = configOf("registry=https://registry.example.test/", "https-proxy=proxy.corp:8080");
			const build = (packageManager: "npm" | "pnpm") =>
				Layer.build(NpmHttpClient.layer(config, { packageManager })).pipe(Effect.provide(MemoryFileSystem.layer));
			const error = yield* Effect.flip(build("npm"));
			assert.strictEqual(error.setting, "proxy");
			yield* build("pnpm");
		}),
	);

	it.effect("judges only proxies the manager would read", () =>
		Effect.gen(function* () {
			const config = configOf("registry=https://registry.example.test/", "proxy=false");
			// pnpm reads a proxy variable in lower or upper case only, and `proxy=false` turns the variables off.
			const env = { Https_Proxy: "not a url", HTTPS_PROXY: "also not a url" };
			yield* Layer.build(NpmHttpClient.layer(config, { env, packageManager: "pnpm" })).pipe(
				Effect.provide(MemoryFileSystem.layer),
			);
			// The control: npm reads `proxy=false` as unset and takes the variable.
			const error = yield* Effect.flip(
				Layer.build(NpmHttpClient.layer(config, { env })).pipe(Effect.provide(MemoryFileSystem.layer)),
			);
			assert.strictEqual(error.setting, "proxy");
		}),
	);
});

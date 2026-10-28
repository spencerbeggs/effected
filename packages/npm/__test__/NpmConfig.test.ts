import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Option, PlatformError, Redacted, Result } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { NpmConfigSource } from "../src/NpmConfig.js";
import { NpmConfig, NpmConfigError } from "../src/NpmConfig.js";
import { DEFAULT_REGISTRY, NpmRegistry } from "../src/NpmRegistry.js";
import type { RegistryCredential } from "../src/RegistryCredential.js";

const NPM_TOKEN = "npm_SECRET_public_registry_token";
/** An npmrc env expression, `${name}`, spelled so no plain string literal carries a placeholder. */
const ref = (name: string): string => `$\{${name}}`;
const ACME_TOKEN = "acme_SECRET_private_token";

const config = (sources: ReadonlyArray<string | NpmConfigSource>, env: Record<string, string> = {}): NpmConfig => {
	const result = NpmConfig.fromSourcesResult(
		sources.map((source) => (typeof source === "string" ? { text: source } : source)),
		env,
	);
	if (Result.isFailure(result)) throw new Error(`unexpected failure: ${result.failure.message}`);
	return result.success;
};

/** The credential's secret, for assertions, or undefined. */
const secretOf = (
	credential: Option.Option<RegistryCredential> | RegistryCredential | undefined,
): string | undefined => {
	const value =
		credential === undefined ? undefined : Option.isOption(credential) ? Option.getOrUndefined(credential) : credential;
	if (value === undefined) return undefined;
	return value.kind === "token" ? Redacted.value(value.token) : Redacted.value(value.encoded);
};

describe("NpmConfig registries", () => {
	it("defaults to the public registry, and honours registry and @scope:registry", () => {
		assert.strictEqual(config([]).registry, DEFAULT_REGISTRY);
		const c = config(["registry=https://mirror.example/", "@acme:registry=https://npm.acme.dev/"]);
		assert.strictEqual(c.registryFor("left-pad"), "https://mirror.example/");
		assert.strictEqual(c.registryFor("@acme/widget"), "https://npm.acme.dev/");
		assert.strictEqual(c.registryFor("@other/widget"), "https://mirror.example/");
	});

	it("applies precedence: later sources over earlier, npm_config_* over all", () => {
		const c = config(["registry=https://global/", "registry=https://user/"]);
		assert.strictEqual(c.registry, "https://user/");
		const withEnv = config(["registry=https://user/"], { npm_config_registry: "https://env/" });
		assert.strictEqual(withEnv.registry, "https://env/");
		const upper = config([], { NPM_CONFIG_REGISTRY: "https://upper/" });
		assert.strictEqual(upper.registry, "https://upper/");
	});

	it("reads ini comments and quoting the way npm's ini parser does", () => {
		const c = config([
			[
				"; comment",
				"# comment",
				'registry = "https://quoted/" ',
				"@a:registry=https://a/ ; trailing",
				"[section]",
				"registry=https://ignored/",
			].join("\n"),
		]);
		assert.strictEqual(c.registry, "https://quoted/");
		assert.strictEqual(c.registryFor("@a/x"), "https://a/");
	});
});

describe("NpmConfig env substitution", () => {
	it("substitutes a variable, empties an optional one, and keeps an escaped expression", () => {
		const c = config(
			[`registry=https://${ref("HOST")}/`, `@a:registry=https://a${ref("SUFFIX?")}/`, `@b:registry=\\${ref("HOST")}`],
			{
				HOST: "env.example",
			},
		);
		assert.strictEqual(c.registry, "https://env.example/");
		assert.strictEqual(c.registryFor("@a/x"), "https://a/");
		assert.strictEqual(c.registryFor("@b/x"), ref("HOST"));
	});

	it("leaves an unset variable as written in an ordinary setting, as npm does", () => {
		assert.strictEqual(config([`registry=https://${ref("UNSET")}/`]).registry, `https://${ref("UNSET")}/`);
	});

	it("fails missing-env for a credential naming an unset variable, naming the variable and file but no value", () => {
		const result = NpmConfig.fromSourcesResult(
			[{ text: `//registry.npmjs.org/:_authToken=${ref("NPM_TOKEN")}`, path: "/home/u/.npmrc" }],
			{},
		);
		assert.isTrue(Result.isFailure(result));
		const error = (result as Result.Failure<NpmConfig, NpmConfigError>).failure;
		assert.instanceOf(error, NpmConfigError);
		assert.strictEqual(error.reason, "missing-env");
		assert.strictEqual(error.variable, "NPM_TOKEN");
		assert.strictEqual(error.path, "/home/u/.npmrc");
		assert.include(error.message, "NPM_TOKEN");
	});

	it("substitutes a credential from the environment", () => {
		const c = config([`//registry.npmjs.org/:_authToken=${ref("NPM_TOKEN")}`], { NPM_TOKEN });
		assert.strictEqual(secretOf(c.credentialFor("https://registry.npmjs.org/left-pad")), NPM_TOKEN);
	});
});

describe("NpmConfig credentials", () => {
	const auth = config([
		`//registry.npmjs.org/:_authToken=${NPM_TOKEN}`,
		`//npm.acme.dev/:_authToken=${ACME_TOKEN}`,
		"//basic.example/:_auth=dXNlcjpwYXNz",
		`//pair.example/:username=user\n//pair.example/:_password=${btoa("pass")}`,
		"//npm.pkg.github.com/acme/:_authToken=gh_scoped",
		"//localhost:4873/:_authToken=verdaccio",
		"//127.0.0.1/:_authToken=portless",
	]);

	it("finds a token by the request URL's host, walking up its path", () => {
		const found = auth.credentialFor("https://registry.npmjs.org/@scope%2fname/1.0.0");
		assert.isTrue(Option.isSome(found));
		assert.strictEqual(Option.getOrThrow(found).kind, "token");
		assert.strictEqual(secretOf(found), NPM_TOKEN);
	});

	it("reads _auth as basic, and username + base64 _password as basic", () => {
		const basic = Option.getOrThrow(auth.credentialFor("https://basic.example/pkg"));
		assert.strictEqual(basic.kind, "basic");
		assert.strictEqual(secretOf(basic), "dXNlcjpwYXNz");
		assert.strictEqual(secretOf(auth.credentialFor("https://pair.example/pkg")), btoa("user:pass"));
	});

	it("prefers _authToken over _auth over username/_password within one key, as npm does", () => {
		const c = config([`//h/:username=u\n//h/:_password=${btoa("p")}\n//h/:_auth=QUFB\n//h/:_authToken=tok`]);
		assert.strictEqual(Option.getOrThrow(c.credentialFor("https://h/x")).kind, "token");
		const noToken = config([`//h/:username=u\n//h/:_password=${btoa("p")}\n//h/:_auth=QUFB`]);
		assert.strictEqual(secretOf(noToken.credentialFor("https://h/x")), "QUFB");
	});

	describe("never sends one host's credential to another (the negative cases)", () => {
		it("a lookalike host and a host in the path get nothing", () => {
			assert.isTrue(Option.isNone(auth.credentialFor("https://registry.npmjs.org.evil.dev/left-pad")));
			assert.isTrue(Option.isNone(auth.credentialFor("https://evil.dev/registry.npmjs.org/left-pad")));
			assert.isTrue(Option.isNone(auth.credentialFor("https://sub.registry.npmjs.org/left-pad")));
		});

		it("a different port is a different host", () => {
			assert.strictEqual(secretOf(auth.credentialFor("http://localhost:4873/pkg")), "verdaccio");
			assert.isTrue(Option.isNone(auth.credentialFor("http://localhost/pkg")));
			assert.isTrue(Option.isNone(auth.credentialFor("http://localhost:4874/pkg")));
			// A portless key is the default port only, never every port on the host.
			assert.strictEqual(secretOf(auth.credentialFor("http://127.0.0.1/pkg")), "portless");
			assert.isTrue(Option.isNone(auth.credentialFor("http://127.0.0.1:8080/pkg")));
		});

		it("a tarball URL on a CDN host gets no registry credential", () => {
			assert.isTrue(Option.isNone(auth.credentialFor("https://cdn.example/left-pad/-/left-pad-1.0.0.tgz")));
		});

		it("a path-scoped token stays inside its path on the same host", () => {
			assert.strictEqual(secretOf(auth.credentialFor("https://npm.pkg.github.com/acme/@acme%2fwidget")), "gh_scoped");
			assert.isTrue(Option.isNone(auth.credentialFor("https://npm.pkg.github.com/other/@other%2fwidget")));
		});

		it("a scoped registry on another host gets its own token, never the default registry's", () => {
			const scoped = config([`//registry.npmjs.org/:_authToken=${NPM_TOKEN}`, "@acme:registry=https://npm.acme.dev/"]);
			const target = scoped.targetFor("@acme/widget");
			assert.strictEqual(target.registry, "https://npm.acme.dev/");
			assert.isUndefined(target.credential, "the public registry's token must not follow the scope redirect");
			assert.strictEqual(secretOf(scoped.targetFor("left-pad").credential), NPM_TOKEN);
		});

		it("an unscoped top-level token names no host and is never used", () => {
			const legacy = config([`_authToken=${NPM_TOKEN}`, "_auth=dXNlcjpwYXNz"]);
			assert.isTrue(Option.isNone(legacy.credentialFor("https://registry.npmjs.org/x")));
			assert.isUndefined(legacy.targetFor("x").credential);
		});

		it("an unparseable URL gets nothing", () => {
			assert.isTrue(Option.isNone(auth.credentialFor("not a url")));
		});
	});

	it("targetFor finds a path-scoped token for a registry written without a trailing slash", () => {
		const c = config(["@acme:registry=https://npm.pkg.github.com/acme", "//npm.pkg.github.com/acme/:_authToken=gh"]);
		assert.strictEqual(secretOf(c.targetFor("@acme/widget").credential), "gh");
	});

	it("never prints a credential", () => {
		const text = `${String(auth)} ${JSON.stringify(auth)}`;
		assert.notInclude(text, NPM_TOKEN);
		assert.notInclude(text, ACME_TOKEN);
		assert.include(text, "<redacted>");
	});

	it("keeps a __proto__ key an own property, off the prototype", () => {
		const c = config(["__proto__=polluted"]);
		assert.isTrue(Object.hasOwn(c.settings, "__proto__"));
		assert.strictEqual(Object.getPrototypeOf(c.settings), Object.prototype);
		assert.isUndefined(({} as Record<string, unknown>).polluted);
	});
});

describe("NpmConfig through NpmRegistry: what goes on the wire", () => {
	/** A client recording every request's URL and Authorization header. */
	const recording = (respond: (url: string) => { status: number; headers?: Record<string, string> }) => {
		const requests: Array<{ url: string; authorization: string | undefined }> = [];
		const client = HttpClient.make((request, url) =>
			Effect.sync(() => {
				requests.push({ url: url.toString(), authorization: request.headers.authorization });
				const { status, headers } = respond(url.toString());
				return HttpClientResponse.fromWeb(
					request,
					new Response(status === 200 ? JSON.stringify({ "dist-tags": { latest: "1.0.0" } }) : null, {
						status,
						...(headers === undefined ? {} : { headers }),
					}),
				);
			}),
		);
		return { requests, client };
	};

	const both = config([`//registry.npmjs.org/:_authToken=${NPM_TOKEN}`, "@acme:registry=https://npm.acme.dev/"]);

	it.effect("a scoped package's read to another host carries no Authorization header", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			const tags = yield* Effect.flatMap(NpmRegistry, (r) =>
				r.distTags("@acme/widget", both.targetFor("@acme/widget")),
			).pipe(Effect.provide(NpmRegistry.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))));
			assert.strictEqual(tags.latest, "1.0.0");
			assert.strictEqual(requests[0]?.url, "https://npm.acme.dev/%40acme%2Fwidget");
			assert.isUndefined(requests[0]?.authorization);
		}),
	);

	it.effect("the default registry's read carries its own token", () =>
		Effect.gen(function* () {
			const { requests, client } = recording(() => ({ status: 200 }));
			yield* Effect.flatMap(NpmRegistry, (r) => r.distTags("left-pad", both.targetFor("left-pad"))).pipe(
				Effect.provide(NpmRegistry.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))),
			);
			assert.strictEqual(requests[0]?.authorization, `Bearer ${NPM_TOKEN}`);
		}),
	);

	it.effect("a cross-host redirect drops the token under HttpClient.followRedirects", () =>
		Effect.gen(function* () {
			// The registry answers 302 to a CDN on another host. A client that
			// follows redirects must not carry the registry's token there.
			const { requests, client } = recording((url) =>
				url.startsWith("https://registry.npmjs.org/")
					? { status: 302, headers: { location: "https://cdn.example/left-pad" } }
					: { status: 200 },
			);
			yield* Effect.flatMap(NpmRegistry, (r) => r.distTags("left-pad", both.targetFor("left-pad"))).pipe(
				Effect.provide(
					NpmRegistry.layer.pipe(
						Layer.provide(Layer.succeed(HttpClient.HttpClient, HttpClient.followRedirects(client))),
					),
				),
			);
			assert.lengthOf(requests, 2);
			assert.strictEqual(requests[0]?.authorization, `Bearer ${NPM_TOKEN}`);
			assert.strictEqual(requests[1]?.url, "https://cdn.example/left-pad");
			assert.isUndefined(requests[1]?.authorization);
		}),
	);
});

describe("NpmConfig.load", () => {
	const load = (seed: Record<string, string>, options: Partial<Parameters<typeof NpmConfig.load>[0]> = {}) =>
		NpmConfig.load({ cwd: "/work/repo/packages/a", env: { HOME: "/home/u" }, ...options }).pipe(
			Effect.provide(MemoryFileSystem.layerWithPath(seed)),
		);

	it.effect("finds the project npmrc at the nearest package.json, then the user and global npmrc", () =>
		Effect.gen(function* () {
			const c = yield* load(
				{
					"/work/repo/packages/a/package.json": "{}",
					"/work/repo/packages/a/.npmrc": "@acme:registry=https://project/",
					"/home/u/.npmrc": "registry=https://user/\n@acme:registry=https://user-acme/",
					"/opt/node/etc/npmrc": "registry=https://global/\n@g:registry=https://global-g/",
				},
				{ globalPrefix: "/opt/node" },
			);
			assert.strictEqual(c.registryFor("@acme/x"), "https://project/");
			assert.strictEqual(c.registry, "https://user/");
			assert.strictEqual(c.registryFor("@g/x"), "https://global-g/");
			assert.deepStrictEqual([...c.files], ["/opt/node/etc/npmrc", "/home/u/.npmrc", "/work/repo/packages/a/.npmrc"]);
		}),
	);

	it.effect("walks up to a node_modules directory, and skips files that do not exist", () =>
		Effect.gen(function* () {
			const c = yield* load({
				"/work/repo/node_modules/.keep": "",
				"/work/repo/.npmrc": "registry=https://project/",
			});
			assert.strictEqual(c.registry, "https://project/");
			assert.deepStrictEqual([...c.files], ["/work/repo/.npmrc"]);
		}),
	);

	it.effect("honours userconfig, globalconfig and prefix settings, including ~/", () =>
		Effect.gen(function* () {
			const c = yield* load(
				{
					"/work/repo/package.json": "{}",
					"/work/repo/.npmrc": "userconfig=~/custom.npmrc",
					"/home/u/custom.npmrc": "globalconfig=/etc/shared-npmrc",
					"/etc/shared-npmrc": "registry=https://shared/",
				},
				{ cwd: "/work/repo" },
			);
			assert.strictEqual(c.registry, "https://shared/");
			const viaPrefix = yield* load(
				{ "/work/repo/package.json": "{}", "/p/etc/npmrc": "registry=https://prefixed/" },
				{ cwd: "/work/repo", env: { HOME: "/home/u", npm_config_prefix: "/p" } },
			);
			assert.strictEqual(viaPrefix.registry, "https://prefixed/");
		}),
	);

	it.effect("fails read for an npmrc that exists but cannot be read", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				NpmConfig.load({ cwd: "/work/repo", env: { HOME: "/home/u" } }).pipe(
					Effect.provide(
						MemoryFileSystem.layerWithPath(
							{ "/work/repo/package.json": "{}", "/home/u/.npmrc": "registry=x" },
							{
								faults: {
									readFile: (file) =>
										file === "/home/u/.npmrc"
											? Effect.fail(
													PlatformError.systemError({
														_tag: "PermissionDenied",
														module: "FileSystem",
														method: "readFile",
														pathOrDescriptor: file,
													}),
												)
											: undefined,
								},
							},
						),
					),
				),
			);
			assert.strictEqual(error.reason, "read");
			assert.strictEqual(error.path, "/home/u/.npmrc");
		}),
	);
});

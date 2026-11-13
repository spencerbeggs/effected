import { inspect } from "node:util";
import { assert, describe, it } from "@effect/vitest";
import { Option, Redacted, Result } from "effect";
import type { ProxyForOptions } from "../src/NpmConfig.js";
import { NpmConfig, NpmRegistryTls, NpmTransportSettings } from "../src/NpmConfig.js";

const PROXY_PASSWORD = "proxy_SECRET_password";

const config = (lines: ReadonlyArray<string>, env: Record<string, string> = {}): NpmConfig => {
	const result = NpmConfig.fromSourcesResult([{ text: lines.join("\n") }], env);
	if (Result.isFailure(result)) throw new Error(`unexpected failure: ${result.failure.message}`);
	return result.success;
};

/** The proxy URL `proxyFor` answered, unredacted for the assertion, or undefined for a direct connection. */
const proxyOf = (
	c: NpmConfig,
	url: string,
	env: Record<string, string> = {},
	options: ProxyForOptions = {},
): string | undefined => Option.getOrUndefined(Option.map(c.proxyFor(url, env, options), Redacted.value));

/** {@link proxyOf} under pnpm's rules. */
const pnpmProxyOf = (c: NpmConfig, url: string, env: Record<string, string> = {}): string | undefined =>
	proxyOf(c, url, env, { packageManager: "pnpm" });

const reveal = (value: Redacted.Redacted<string> | undefined): string | undefined =>
	value === undefined ? undefined : Redacted.value(value);

describe("NpmConfig.transport (#1307)", () => {
	it("an empty configuration is the default: strict TLS, no proxy, no CA", () => {
		const transport = config([]).transport;
		assert.instanceOf(transport, NpmTransportSettings);
		assert.isTrue(transport.isDefault);
		assert.isTrue(transport.strictSsl);
		assert.deepStrictEqual([...transport.noproxy], []);
		assert.isUndefined(transport.httpsProxy);
		assert.isUndefined(transport.proxy);
		assert.isUndefined(transport.cafile);
	});

	it("reads every transport setting an npmrc holds", () => {
		const transport = config([
			"https-proxy=http://proxy.corp.test:3128",
			"proxy=http://plain.corp.test:8080",
			"noproxy=localhost, .corp.test ,,10.0.0.1",
			"strict-ssl=false",
			"cafile=/etc/ssl/corp-root.pem",
			'ca="-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----"',
			"http-proxy=http://pnpm-http.corp.test:8081",
			"no-proxy=internal.test",
			'cert="-----BEGIN CERTIFICATE-----\\nCERT\\n-----END CERTIFICATE-----"',
			'key="-----BEGIN PRIVATE KEY-----\\nKEY\\n-----END PRIVATE KEY-----"',
			"local-address=10.1.2.3",
		]).transport;
		assert.isFalse(transport.isDefault);
		assert.strictEqual(Redacted.value(transport.httpsProxy ?? Redacted.make("")), "http://proxy.corp.test:3128");
		assert.strictEqual(Redacted.value(transport.proxy ?? Redacted.make("")), "http://plain.corp.test:8080");
		assert.deepStrictEqual([...transport.noproxy], ["localhost", ".corp.test", "10.0.0.1"]);
		assert.isFalse(transport.strictSsl);
		assert.strictEqual(transport.cafile, "/etc/ssl/corp-root.pem");
		assert.strictEqual(transport.ca, "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----");
		assert.strictEqual(reveal(transport.httpProxy), "http://pnpm-http.corp.test:8081");
		assert.deepStrictEqual([...transport.noProxy], ["internal.test"]);
		assert.strictEqual(reveal(transport.cert), "-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----");
		assert.strictEqual(reveal(transport.key), "-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----");
		assert.strictEqual(transport.localAddress, "10.1.2.3");
		assert.isFalse(transport.proxyDisabled);
		// The inline client key is a secret: it never prints.
		assert.notInclude(inspect(transport, { depth: 10 }), "KEY");
	});

	it("holds no top-level certfile or keyfile: neither npm nor pnpm reads them there", () => {
		// npm 11 ignores a top-level pair, npm 12 refuses one (ERR_INVALID_AUTH,
		// `npm config fix`), pnpm reads client-certificate files per registry only.
		const transport = config(["certfile=/etc/ssl/client.pem", "keyfile=/etc/ssl/client.key"]).transport;
		assert.isFalse(Object.hasOwn(transport, "certfile"));
		assert.isFalse(Object.hasOwn(transport, "keyfile"));
		assert.isTrue(transport.isDefault);
	});

	it("keeps a proxy's userinfo, redacted, rather than the stripped setting", () => {
		const c = config([`https-proxy=http://alice:${PROXY_PASSWORD}@proxy.corp.test:3128/`]);
		// Control: the plain settings map holds the URL without its userinfo.
		assert.strictEqual(c.settings["https-proxy"], "http://proxy.corp.test:3128/");
		const proxy = c.transport.httpsProxy;
		if (proxy === undefined) assert.fail("expected the https-proxy setting");
		assert.strictEqual(Redacted.value(proxy), `http://alice:${PROXY_PASSWORD}@proxy.corp.test:3128/`);
		assert.notInclude(inspect(c.transport, { depth: 10 }), PROXY_PASSWORD);
		assert.notInclude(JSON.stringify(c.transport), PROXY_PASSWORD);
	});

	it("reads strict-ssl as npm's request path does: only a literal false turns verification off", () => {
		// npm 11.20: `@npmcli/config` parseField trims, maps `false` → false and
		// `null` → null, keeps any other string; make-fetch-happen then sets
		// `rejectUnauthorized = strictSSL !== false`. Reading it with nopt's
		// boolean rule turned `0` and `null` into "TLS off", where npm verifies.
		const cases: ReadonlyArray<readonly [string, boolean]> = [
			["false", false],
			[" false ", false],
			['"false"', false],
			["null", true],
			["undefined", true],
			["0", true],
			["FALSE", true],
			["False", true],
			["no", true],
			["", true],
			["true", true],
			["1", true],
			["yes", true],
		];
		for (const [value, expected] of cases) {
			assert.strictEqual(config([`strict-ssl=${value}`]).transport.strictSsl, expected, `strict-ssl=${value}`);
		}
	});

	it("an empty, false or null proxy URL is absent, and only proxy=false is pnpm's off switch", () => {
		for (const value of ["", "null"]) {
			const transport = config([`proxy=${value}`, `https-proxy=${value}`]).transport;
			assert.isUndefined(transport.proxy, `proxy=${value}`);
			assert.isUndefined(transport.httpsProxy, `https-proxy=${value}`);
			assert.isFalse(transport.proxyDisabled);
			assert.isTrue(transport.isDefault);
		}
		const off = config(["proxy=false"]).transport;
		assert.isUndefined(off.proxy);
		assert.isTrue(off.proxyDisabled);
		assert.isFalse(off.isDefault);
	});

	it("an npm_config_* variable sets a transport setting, as npm reads it", () => {
		const transport = config([], {
			npm_config_https_proxy: "http://env.corp.test:3128",
			npm_config_strict_ssl: "false",
		}).transport;
		assert.strictEqual(Redacted.value(transport.httpsProxy ?? Redacted.make("")), "http://env.corp.test:3128");
		assert.isFalse(transport.strictSsl);
	});
});

describe("NpmConfig.proxyFor (#1307)", () => {
	it("is None with no proxy configured anywhere", () => {
		assert.isUndefined(proxyOf(config([]), "https://registry.npmjs.org/left-pad"));
	});

	it("uses https-proxy, else proxy, for any scheme (npm-registry-fetch's httpsProxy || proxy)", () => {
		const both = config(["https-proxy=http://secure.corp:1", "proxy=http://plain.corp:2"]);
		assert.strictEqual(proxyOf(both, "https://registry.npmjs.org/x"), "http://secure.corp:1");
		assert.strictEqual(proxyOf(both, "http://localhost:4873/x"), "http://secure.corp:1");
		const plainOnly = config(["proxy=http://plain.corp:2"]);
		assert.strictEqual(proxyOf(plainOnly, "https://registry.npmjs.org/x"), "http://plain.corp:2");
	});

	it("falls back to the proxy environment, by scheme, case-insensitively", () => {
		const c = config([]);
		assert.strictEqual(proxyOf(c, "https://r.example/x", { HTTPS_PROXY: "http://s:1" }), "http://s:1");
		// An https: request reads only HTTPS_PROXY, never HTTP_PROXY.
		assert.isUndefined(proxyOf(c, "https://r.example/x", { HTTP_PROXY: "http://p:2" }));
		assert.strictEqual(proxyOf(c, "http://r.example/x", { http_proxy: "http://p:2" }), "http://p:2");
		assert.strictEqual(
			proxyOf(c, "http://r.example/x", { HTTP_PROXY: "http://p:2", https_proxy: "http://s:1" }),
			"http://s:1",
		);
		// A configured proxy beats the environment.
		assert.strictEqual(
			proxyOf(config(["proxy=http://cfg:3"]), "https://r.example/x", { HTTPS_PROXY: "http://s:1" }),
			"http://cfg:3",
		);
	});

	it("bypasses the proxy for a noproxy host, matching labels from the right", () => {
		const c = config(["https-proxy=http://proxy.corp:3128", "noproxy=example.com,.internal.test"]);
		assert.isUndefined(proxyOf(c, "https://example.com/x"));
		assert.isUndefined(proxyOf(c, "https://registry.example.com/x"));
		assert.isUndefined(proxyOf(c, "https://npm.internal.test/x"));
		// A label boundary, not a substring: `badexample.com` is not `example.com`.
		assert.strictEqual(proxyOf(c, "https://badexample.com/x"), "http://proxy.corp:3128");
		assert.strictEqual(proxyOf(c, "https://registry.npmjs.org/x"), "http://proxy.corp:3128");
	});

	it("reads NO_PROXY when noproxy is unset, and the setting wins when both are", () => {
		const c = config(["https-proxy=http://proxy.corp:3128"]);
		assert.isUndefined(proxyOf(c, "https://registry.corp.test/x", { NO_PROXY: "corp.test" }));
		const withSetting = config(["https-proxy=http://proxy.corp:3128", "noproxy=other.test"]);
		assert.strictEqual(
			proxyOf(withSetting, "https://registry.corp.test/x", { NO_PROXY: "corp.test" }),
			"http://proxy.corp:3128",
		);
	});

	it("is None for an unparseable URL", () => {
		assert.isUndefined(proxyOf(config(["https-proxy=http://proxy.corp:3128"]), "not a url"));
		assert.isUndefined(pnpmProxyOf(config(["https-proxy=http://proxy.corp:3128"]), "not a url"));
	});

	it("npm reads proxy=false as unset, so the environment still applies", () => {
		assert.strictEqual(
			proxyOf(config(["proxy=false"]), "https://r.example/x", { HTTPS_PROXY: "http://s:1" }),
			"http://s:1",
		);
	});

	it("npm ignores pnpm's http-proxy and no-proxy", () => {
		const c = config(["http-proxy=http://pnpm-only:1", "https-proxy=http://both:2", "no-proxy=r.example"]);
		assert.strictEqual(proxyOf(c, "http://r.example/x"), "http://both:2");
	});
});

describe("NpmConfig.proxyFor with packageManager: pnpm (#1307)", () => {
	it("splits by scheme: https-proxy for https:, http-proxy for http:", () => {
		const c = config(["https-proxy=http://secure:1", "http-proxy=http://plain:2"]);
		assert.strictEqual(pnpmProxyOf(c, "https://r.example/x"), "http://secure:1");
		assert.strictEqual(pnpmProxyOf(c, "http://r.example/x"), "http://plain:2");
		// With no http-proxy, an http: request reuses the https: answer.
		assert.strictEqual(pnpmProxyOf(config(["https-proxy=http://secure:1"]), "http://r.example/x"), "http://secure:1");
		assert.strictEqual(pnpmProxyOf(config(["proxy=http://legacy:3"]), "http://r.example/x"), "http://legacy:3");
	});

	it("proxy=false turns proxying off, the environment included", () => {
		const env = { HTTPS_PROXY: "http://s:1", HTTP_PROXY: "http://p:2" };
		assert.isUndefined(pnpmProxyOf(config(["proxy=false"]), "https://r.example/x", env));
		assert.isUndefined(pnpmProxyOf(config(["proxy=false"]), "http://r.example/x", env));
		// Control: without it, the environment is used.
		assert.strictEqual(pnpmProxyOf(config([]), "https://r.example/x", env), "http://s:1");
		// An explicit https-proxy still wins over proxy=false.
		assert.strictEqual(
			pnpmProxyOf(config(["proxy=false", "https-proxy=http://x:9"]), "https://r.example/x"),
			"http://x:9",
		);
	});

	it("reads a variable in upper case, else lower case, never mixed, as pnpm 12 does", () => {
		const c = config([]);
		for (const [upper, lower, url] of [
			["HTTPS_PROXY", "https_proxy", "https://r.example/x"],
			["HTTP_PROXY", "http_proxy", "http://r.example/x"],
			["PROXY", "proxy", "http://r.example/x"],
		] as const) {
			assert.strictEqual(pnpmProxyOf(c, url, { [lower]: "http://lo:1", [upper]: "http://up:2" }), "http://up:2", upper);
			assert.strictEqual(pnpmProxyOf(c, url, { [upper]: "http://up:2", [lower]: "http://lo:1" }), "http://up:2", upper);
			assert.strictEqual(pnpmProxyOf(c, url, { [lower]: "http://lo:1" }), "http://lo:1", lower);
		}
		const proxied = config(["https-proxy=http://p:1"]);
		// NO_PROXY wins over no_proxy too: the upper-case list bypasses, the lower-case one would not.
		assert.isUndefined(
			pnpmProxyOf(proxied, "https://up.example/x", { no_proxy: "lo.example", NO_PROXY: "up.example" }),
		);
		assert.strictEqual(
			pnpmProxyOf(proxied, "https://lo.example/x", { no_proxy: "lo.example", NO_PROXY: "up.example" }),
			"http://p:1",
		);
		assert.isUndefined(pnpmProxyOf(c, "https://r.example/x", { Https_Proxy: "http://mixed:3" }));
		// npm reads the mixed spelling.
		assert.strictEqual(proxyOf(c, "https://r.example/x", { Https_Proxy: "http://mixed:3" }), "http://mixed:3");
		assert.strictEqual(pnpmProxyOf(c, "http://r.example/x", { PROXY: "http://legacy:4" }), "http://legacy:4");
	});

	it("npm reads a variable in any case, the last spelling in the environment's order winning", () => {
		// `@npmcli/agent`'s PROXY_ENV folds `process.env` by lower-cased name, so a later entry replaces an earlier one.
		const c = config([]);
		assert.strictEqual(
			proxyOf(c, "https://r.example/x", { https_proxy: "http://lo:1", HTTPS_PROXY: "http://up:2" }),
			"http://up:2",
		);
		assert.strictEqual(
			proxyOf(c, "https://r.example/x", { HTTPS_PROXY: "http://up:2", https_proxy: "http://lo:1" }),
			"http://lo:1",
		);
	});

	it("bypasses by no-proxy, else noproxy, else NO_PROXY; a bare true bypasses every host", () => {
		const base = "https-proxy=http://proxy.corp:3128";
		assert.isUndefined(
			pnpmProxyOf(config([base, "no-proxy=corp.test", "noproxy=other.test"]), "https://r.corp.test/x"),
		);
		assert.strictEqual(
			pnpmProxyOf(config([base, "no-proxy=corp.test", "noproxy=other.test"]), "https://r.other.test/x"),
			"http://proxy.corp:3128",
		);
		assert.isUndefined(pnpmProxyOf(config([base, "noproxy=other.test"]), "https://r.other.test/x"));
		assert.isUndefined(pnpmProxyOf(config([base]), "https://r.env.test/x", { NO_PROXY: "env.test" }));
		assert.isUndefined(pnpmProxyOf(config([base, "no-proxy"]), "https://anything.example/x"));
		// Label boundary, as npm: `badexample.com` is not `example.com`.
		assert.strictEqual(
			pnpmProxyOf(config([base, "no-proxy=example.com"]), "https://badexample.com/x"),
			"http://proxy.corp:3128",
		);
	});

	it("gives a scheme-less proxy the request's scheme", () => {
		assert.strictEqual(
			pnpmProxyOf(config(["https-proxy=proxy.corp:3128"]), "https://r.example/x"),
			"https://proxy.corp:3128",
		);
	});
});

describe("NpmConfig.tlsFor (#1307)", () => {
	const pnpm = { packageManager: "pnpm" } as const;

	it("pnpm: reads all six of a registry's TLS keys, deepest directory first", () => {
		const c = config([
			"//npm.corp.test/:cafile=/etc/ssl/corp.pem",
			"//npm.corp.test/:certfile=/etc/ssl/client.pem",
			"//npm.corp.test/:keyfile=/etc/ssl/client.key",
			'//npm.corp.test/:key="-----BEGIN PRIVATE KEY-----\\nK\\n-----END PRIVATE KEY-----"',
			"//npm.corp.test/team/:ca=TEAM-CA",
		]);
		const tls = c.tlsFor("https://npm.corp.test/left-pad", pnpm);
		if (Option.isNone(tls)) assert.fail("expected the registry's TLS settings");
		assert.instanceOf(tls.value, NpmRegistryTls);
		assert.strictEqual(tls.value.cafile, "/etc/ssl/corp.pem");
		assert.strictEqual(tls.value.certfile, "/etc/ssl/client.pem");
		assert.strictEqual(tls.value.keyfile, "/etc/ssl/client.key");
		assert.strictEqual(reveal(tls.value.key), "-----BEGIN PRIVATE KEY-----\nK\n-----END PRIVATE KEY-----");
		assert.notInclude(inspect(tls.value, { depth: 10 }), "BEGIN PRIVATE KEY");
		// A deeper directory key answers for a request under it, alone: no merge.
		const team = c.tlsFor("https://npm.corp.test/team/pkg", pnpm);
		assert.deepStrictEqual(team, Option.some(NpmRegistryTls.make({ ca: "TEAM-CA" })));
	});

	it("npm: answers only the certfile/keyfile pair, and only as a pair", () => {
		const c = config([
			"//npm.corp.test/:cafile=/etc/ssl/corp.pem",
			"//npm.corp.test/:certfile=/etc/ssl/client.pem",
			"//npm.corp.test/:keyfile=/etc/ssl/client.key",
		]);
		assert.deepStrictEqual(
			c.tlsFor("https://npm.corp.test/left-pad"),
			Option.some(NpmRegistryTls.make({ certfile: "/etc/ssl/client.pem", keyfile: "/etc/ssl/client.key" })),
		);
		// A lone certfile is not a pair: npm reads nothing.
		assert.isTrue(Option.isNone(config(["//npm.corp.test/:certfile=/c.pem"]).tlsFor("https://npm.corp.test/x")));
	});

	it("same host, two rules: npm stops at a credential, pnpm walks past it to the TLS keys", () => {
		// npm's regFromURI stops at `//host/acme/` (it holds a token) and sends
		// no client certificate for /acme/…; pnpm's pickSettingByUrl ignores
		// credentials and finds the root pair.
		const c = config([
			"//npm.corp.test/acme/:_authToken=tok",
			"//npm.corp.test/:certfile=/root.pem",
			"//npm.corp.test/:keyfile=/root.key",
		]);
		assert.isTrue(Option.isNone(c.tlsFor("https://npm.corp.test/acme/widget")));
		assert.deepStrictEqual(
			c.tlsFor("https://npm.corp.test/acme/widget", pnpm),
			Option.some(NpmRegistryTls.make({ certfile: "/root.pem", keyfile: "/root.key" })),
		);
		// Control: outside /acme/ npm reaches the root pair too.
		assert.isTrue(Option.isSome(c.tlsFor("https://npm.corp.test/other")));
	});

	it("same host, two rules: a deeper lone certfile or pnpm-only ca stops pnpm, not npm", () => {
		const c = config([
			"//npm.corp.test/deep/:ca=DEEP-CA",
			"//npm.corp.test/:certfile=/root.pem",
			"//npm.corp.test/:keyfile=/root.key",
		]);
		assert.deepStrictEqual(
			c.tlsFor("https://npm.corp.test/deep/pkg"),
			Option.some(NpmRegistryTls.make({ certfile: "/root.pem", keyfile: "/root.key" })),
		);
		assert.deepStrictEqual(
			c.tlsFor("https://npm.corp.test/deep/pkg", pnpm),
			Option.some(NpmRegistryTls.make({ ca: "DEEP-CA" })),
		);
	});

	it("pnpm retries without the port; npm keeps the port strict", () => {
		const c = config(["//npm.corp.test/:certfile=/c.pem", "//npm.corp.test/:keyfile=/k.pem"]);
		assert.isTrue(Option.isSome(c.tlsFor("https://npm.corp.test:8443/x", pnpm)));
		assert.isTrue(Option.isNone(c.tlsFor("https://npm.corp.test:8443/x")));
	});

	it("pnpm matches only slash-terminated keys", () => {
		const c = config(["//npm.corp.test:ca=NO-SLASH"]);
		assert.isTrue(Option.isNone(c.tlsFor("https://npm.corp.test/x", pnpm)));
	});

	it("is None for another host, a lookalike host and a non-https URL, under both rules", () => {
		const c = config(["//npm.corp.test/:certfile=/c.pem", "//npm.corp.test/:keyfile=/k.pem"]);
		for (const options of [{}, pnpm]) {
			assert.isTrue(Option.isNone(c.tlsFor("https://other.test/x", options)));
			assert.isTrue(Option.isNone(c.tlsFor("https://npm.corp.test.evil.dev/x", options)));
			assert.isTrue(Option.isNone(c.tlsFor("https://evil.dev/npm.corp.test/x", options)));
			assert.isTrue(Option.isNone(c.tlsFor("http://npm.corp.test/x", options)));
			assert.isTrue(Option.isNone(c.tlsFor("not a url", options)));
			// Control: the configured host answers.
			assert.isTrue(Option.isSome(c.tlsFor("https://npm.corp.test/x", options)));
		}
	});
});

describe("proxy userinfo never sits in plain settings (#1307 review B1)", () => {
	const PW = "proxy_SECRET_pw";
	const forms: ReadonlyArray<readonly [string, string, string]> = [
		// key, as written, the setting it leaves behind
		["https-proxy", `alice:${PW}@proxy.corp:3128`, "proxy.corp:3128"],
		["http-proxy", `//alice:${PW}@proxy.corp:3128`, "//proxy.corp:3128"],
		["proxy", `http://alice:${PW}@proxy.corp:3128/`, "http://proxy.corp:3128/"],
		["https-proxy", `alice:p@ss:${PW}@proxy.corp:3128`, "proxy.corp:3128"],
	];
	for (const [key, written, left] of forms) {
		it(`${key}=${written.replace(PW, "…")} keeps the password out of every rendering`, () => {
			const c = config([`${key}=${written}`]);
			// `http-proxy` routes only `http:` requests (pnpm).
			const target = key === "http-proxy" ? "http://registry.example/x" : "https://registry.npmjs.org/x";
			assert.strictEqual(c.settings[key], left);
			const renderings = [
				inspect(c, { depth: 10 }),
				JSON.stringify(c),
				String(c),
				inspect(c.transport, { depth: 10 }),
				JSON.stringify(c.transport),
				String(c.transport),
				inspect(c.proxyFor(target, {}, { packageManager: "pnpm" })),
			];
			for (const rendering of renderings) assert.notInclude(rendering, PW);
			// The original is held redacted, and resolves.
			assert.include(Redacted.value(c.secrets[key] ?? Redacted.make("")), PW);
			assert.include(proxyOf(c, target, {}, { packageManager: "pnpm" }) ?? "", PW);
		});
	}

	it("an error from the same configuration carries no proxy password", () => {
		const result = NpmConfig.fromSourcesResult(
			[{ text: `https-proxy=alice:${PW}@proxy.corp:3128\n//r.example/:_authToken=$\{UNSET_TOKEN}`, path: "/p/.npmrc" }],
			{},
		);
		if (Result.isSuccess(result)) assert.fail("expected missing-env");
		for (const rendering of [result.failure.message, String(result.failure), inspect(result.failure, { depth: 10 })]) {
			assert.notInclude(rendering, PW);
		}
	});

	it("an email-shaped non-proxy value is not mistaken for userinfo (control)", () => {
		const c = config(["email=me@example.com"]);
		assert.strictEqual(c.settings.email, "me@example.com");
		assert.isFalse(Object.hasOwn(c.secrets, "email"));
	});
});

describe("pnpm env edge cases (#1307 review N1, N2)", () => {
	const base = "https-proxy=http://proxy.corp:3128";

	it("NO_PROXY=true from the environment is a host name, not bypass-all", () => {
		assert.strictEqual(
			pnpmProxyOf(config([base]), "https://r.example/x", { NO_PROXY: "true" }),
			"http://proxy.corp:3128",
		);
		// Control: the setting form does bypass every host.
		assert.isUndefined(pnpmProxyOf(config([base, "no-proxy=true"]), "https://r.example/x"));
	});

	it("a set-but-empty upper-case variable means no proxy and stops the fallback", () => {
		assert.isUndefined(pnpmProxyOf(config([]), "https://r.example/x", { HTTPS_PROXY: "", https_proxy: "http://lo:1" }));
		assert.isUndefined(pnpmProxyOf(config([]), "http://r.example/x", { HTTPS_PROXY: "", HTTP_PROXY: "http://p:2" }));
		// Control: unset, the lower-case variable is read.
		assert.strictEqual(pnpmProxyOf(config([]), "https://r.example/x", { https_proxy: "http://lo:1" }), "http://lo:1");
	});

	it("a trailing-dot host is bypassed by its domain under pnpm, not under npm", () => {
		const c = config([base, "noproxy=example.com"]);
		assert.isUndefined(pnpmProxyOf(c, "https://registry.example.com./x"));
		assert.strictEqual(proxyOf(c, "https://registry.example.com./x"), "http://proxy.corp:3128");
	});
});

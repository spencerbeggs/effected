// `PnpmNpmConfig`: pnpm 12's registry, proxy and TLS view as an `NpmConfig`.
//
// Each precedence test carries the naive control: `NpmConfig` over the same
// npmrc text alone, which is what a tool got before, answering differently.

import { assert, describe, it, layer } from "@effect/vitest";
import type { NpmConfigSource } from "@effected/npm";
import { DEFAULT_REGISTRY, NpmConfig } from "@effected/npm";
import { Effect, Option, Redacted, Result } from "effect";
import type { PnpmNpmConfigSources, PnpmSettingsSources } from "../src/index.js";
import { PnpmNpmConfig, PnpmSettings } from "../src/index.js";
import { manifest, platform } from "./fixtures.js";

/** An env expression, `${name}`, spelled so no plain string literal carries a placeholder. */
const ref = (name: string): string => `$\{${name}}`;

interface Fixture {
	readonly user?: string;
	readonly authIni?: string;
	readonly project?: string;
	readonly trustProject?: boolean;
	readonly workspace?: string;
	readonly global?: string;
	readonly env?: Record<string, string>;
}

const settingsOf = (fixture: Fixture): PnpmSettings => {
	const sources: PnpmSettingsSources = {
		env: fixture.env ?? {},
		...(fixture.workspace === undefined
			? {}
			: { workspace: { text: fixture.workspace, path: "/r/pnpm-workspace.yaml" } }),
		...(fixture.global === undefined ? {} : { global: { text: fixture.global, path: "/g/config.yaml" } }),
	};
	const result = PnpmSettings.fromSourcesResult(sources);
	if (Result.isFailure(result)) throw new Error(result.failure.message);
	return result.success;
};

const sourcesOf = (fixture: Fixture): PnpmNpmConfigSources => {
	const npmrc = (text: string | undefined, path: string): NpmConfigSource | undefined =>
		text === undefined ? undefined : { text, path };
	const user = npmrc(fixture.user, "/home/u/.npmrc");
	const authIni = npmrc(fixture.authIni, "/g/auth.ini");
	const project = npmrc(fixture.project, "/r/.npmrc");
	return {
		settings: settingsOf(fixture),
		env: fixture.env ?? {},
		...(fixture.trustProject === undefined ? {} : { trustProject: fixture.trustProject }),
		...(user === undefined ? {} : { user }),
		...(authIni === undefined ? {} : { authIni }),
		...(project === undefined ? {} : { project }),
	};
};

const pnpmConfig = (fixture: Fixture): NpmConfig => {
	const result = PnpmNpmConfig.fromSourcesResult(sourcesOf(fixture));
	if (Result.isFailure(result)) throw new Error(`unexpected failure: ${result.failure.message}`);
	return result.success;
};

/** The naive control: npm's reading of the same npmrc texts and environment. */
const npmConfig = (fixture: Fixture): NpmConfig => {
	const texts = [fixture.user, fixture.project].filter((text): text is string => text !== undefined);
	const result = NpmConfig.fromSourcesResult(
		texts.map((text) => ({ text })),
		fixture.env ?? {},
	);
	if (Result.isFailure(result)) throw new Error(result.failure.message);
	return result.success;
};

const proxyOf = (config: NpmConfig, url: string, env: Record<string, string> = {}): string | undefined =>
	Option.getOrUndefined(Option.map(config.proxyFor(url, env, { packageManager: "pnpm" }), Redacted.value));

const tokenOf = (config: NpmConfig, url: string): string | undefined => {
	const credential = Option.getOrUndefined(config.credentialFor(url));
	return credential === undefined
		? undefined
		: credential.kind === "token"
			? Redacted.value(credential.token)
			: Redacted.value(credential.encoded);
};

describe("PnpmNpmConfig precedence: variable > pnpm-workspace.yaml > config.yaml > npmrc", () => {
	it("a pnpm-workspace.yaml registry beats the npmrc registry", () => {
		const fixture = { project: "registry=https://npmrc.example/", workspace: "registry: https://workspace.example/\n" };
		assert.strictEqual(npmConfig(fixture).registry, "https://npmrc.example/", "control: npm reads the npmrc");
		assert.strictEqual(pnpmConfig(fixture).registry, "https://workspace.example/");
	});

	it("the global config.yaml beats the npmrc and loses to the workspace file", () => {
		const npmrc = "registry=https://npmrc.example/";
		assert.strictEqual(
			pnpmConfig({ user: npmrc, global: "registry: https://global.example/\n" }).registry,
			"https://global.example/",
		);
		assert.strictEqual(
			pnpmConfig({
				user: npmrc,
				global: "registry: https://global.example/\n",
				workspace: "registry: https://workspace.example/\n",
			}).registry,
			"https://workspace.example/",
		);
	});

	it("a PNPM_CONFIG_REGISTRY variable beats every file, and npm_config_registry is not read", () => {
		const fixture = {
			project: "registry=https://npmrc.example/",
			workspace: "registry: https://workspace.example/\n",
		};
		assert.strictEqual(
			pnpmConfig({ ...fixture, env: { PNPM_CONFIG_REGISTRY: "https://env.example/" } }).registry,
			"https://env.example/",
		);
		const npmVariable = { ...fixture, env: { npm_config_registry: "https://npm-env.example/" } };
		assert.strictEqual(npmConfig(npmVariable).registry, "https://npm-env.example/", "control: npm reads it");
		assert.strictEqual(pnpmConfig(npmVariable).registry, "https://workspace.example/");
	});

	it("httpsProxy in pnpm-workspace.yaml reaches proxyFor", () => {
		const fixture = { workspace: "httpsProxy: http://proxy.corp:3128\n" };
		assert.isUndefined(proxyOf(npmConfig(fixture), "https://registry.npmjs.org/x"), "control: npm sees no proxy");
		assert.strictEqual(proxyOf(pnpmConfig(fixture), "https://registry.npmjs.org/x"), "http://proxy.corp:3128");
	});

	it("pnpm_config_https_proxy reaches proxyFor, and beats the workspace file", () => {
		const config = pnpmConfig({
			workspace: "httpsProxy: http://ws.corp:3128\n",
			env: { pnpm_config_https_proxy: "http://env.corp:3128" },
		});
		assert.strictEqual(proxyOf(config, "https://registry.npmjs.org/x"), "http://env.corp:3128");
		// npm's variable is not a pnpm setting.
		assert.isUndefined(
			proxyOf(pnpmConfig({ env: { npm_config_https_proxy: "http://npm.corp:3128" } }), "https://registry.npmjs.org/x"),
		);
	});

	it("an empty httpsProxy in the workspace file masks the npmrc proxy", () => {
		const fixture = { project: "https-proxy=http://npmrc.corp:3128", workspace: 'httpsProxy: ""\n' };
		assert.strictEqual(
			proxyOf(pnpmConfig({ project: fixture.project }), "https://r.example/"),
			"http://npmrc.corp:3128",
		);
		assert.isUndefined(proxyOf(pnpmConfig(fixture), "https://r.example/"));
	});

	it("noProxy: true in the workspace file bypasses every host, and httpProxy routes http: requests", () => {
		const config = pnpmConfig({ workspace: "httpProxy: http://plain.corp:8080\nnoProxy: true\n" });
		assert.isUndefined(proxyOf(config, "http://r.example/"));
		const routed = pnpmConfig({ workspace: "httpProxy: http://plain.corp:8080\n" });
		assert.strictEqual(proxyOf(routed, "http://r.example/"), "http://plain.corp:8080");
	});

	it("strictSsl and localAddress come from the settings files and variables", () => {
		assert.isTrue(pnpmConfig({}).transport.strictSsl);
		assert.isFalse(pnpmConfig({ project: "strict-ssl=true", workspace: "strictSsl: false\n" }).transport.strictSsl);
		assert.isFalse(pnpmConfig({ global: "strictSsl: no\n" }).transport.strictSsl, "a boolean word in a file");
		assert.isFalse(
			pnpmConfig({ workspace: "strictSsl: true\n", env: { PNPM_CONFIG_STRICT_SSL: "false" } }).transport.strictSsl,
		);
		// An environment value that is not a JSON boolean is skipped to the next source.
		assert.isFalse(
			pnpmConfig({ workspace: "strictSsl: false\n", env: { PNPM_CONFIG_STRICT_SSL: "no" } }).transport.strictSsl,
		);
		assert.strictEqual(pnpmConfig({ workspace: "localAddress: 10.0.0.5\n" }).transport.localAddress, "10.0.0.5");
	});

	it("takes no CA, client certificate or credential from a settings file", () => {
		const config = pnpmConfig({
			workspace: "ca: WORKSPACE-CA\ncafile: /ws/ca.pem\ncert: WS-CERT\n'//registry.npmjs.org/:_authToken': ws-token\n",
		});
		assert.isTrue(config.transport.isDefault);
		assert.isUndefined(tokenOf(config, "https://registry.npmjs.org/x"));
	});
});

describe("PnpmNpmConfig registries", () => {
	it("routes scopes from the older <scope>: <url> shape", () => {
		const config = pnpmConfig({
			workspace: "registries:\n  default: https://mirror.example/\n  '@acme': https://npm.acme.dev/\n",
		});
		assert.strictEqual(config.registry, "https://mirror.example/");
		assert.strictEqual(config.registryFor("@acme/widget"), "https://npm.acme.dev/");
	});

	it("routes scopes from the declaration shape, and registry wins the default within the file", () => {
		const declared = "registries:\n  https://npm.acme.dev/:\n    scopes: ['@', '@acme']\n";
		assert.strictEqual(pnpmConfig({ workspace: declared }).registry, "https://npm.acme.dev/");
		const config = pnpmConfig({ workspace: `${declared}registry: https://mirror.example/\n` });
		assert.strictEqual(config.registry, "https://mirror.example/");
		assert.strictEqual(config.registryFor("@acme/widget"), "https://npm.acme.dev/");
	});

	it("a workspace scope route beats the npmrc's, and the variable registry beats registries", () => {
		const fixture = {
			project: "@acme:registry=https://npmrc.acme/",
			workspace: "registries:\n  '@acme': https://ws.acme/\n  default: https://ws.default/\n",
		};
		assert.strictEqual(pnpmConfig(fixture).registryFor("@acme/x"), "https://ws.acme/");
		assert.strictEqual(
			pnpmConfig({ ...fixture, env: { pnpm_config_registry: "https://env.example/" } }).registry,
			"https://env.example/",
		);
	});
});

describe("PnpmNpmConfig npmrc readings", () => {
	it("expands no variable in a project .npmrc credential, where the user npmrc expands it", () => {
		const line = `//registry.npmjs.org/:_authToken=${ref("NPM_TOKEN")}`;
		const env = { NPM_TOKEN: "npm_SECRET" };
		assert.strictEqual(
			tokenOf(npmConfig({ project: line, env }), "https://registry.npmjs.org/x"),
			"npm_SECRET",
			"control",
		);
		assert.isUndefined(tokenOf(pnpmConfig({ project: line, env }), "https://registry.npmjs.org/x"));
		assert.strictEqual(tokenOf(pnpmConfig({ user: line, env }), "https://registry.npmjs.org/x"), "npm_SECRET");
		assert.strictEqual(
			tokenOf(pnpmConfig({ project: line, env, trustProject: true }), "https://registry.npmjs.org/x"),
			"npm_SECRET",
		);
	});

	it("refuses a registry URL with a placeholder in the project .npmrc or the workspace file", () => {
		for (const fixture of [
			{ project: `registry=https://${ref("HOST")}/`, path: "/r/.npmrc", setting: "registry" },
			{ workspace: `registry: https://${ref("HOST")}/\n`, path: "/r/pnpm-workspace.yaml", setting: "registry" },
			{
				workspace: `registries:\n  '@acme': https://${ref("HOST")}/\n`,
				path: "/r/pnpm-workspace.yaml",
				setting: "registries['@acme']",
			},
			// A declaration is refused by its key, whether or not it routes a scope.
			{
				workspace: `registries:\n  https://${ref("HOST")}/:\n    serverType: verdaccio\n`,
				path: "/r/pnpm-workspace.yaml",
				setting: `registries['https://${ref("HOST")}/']`,
			},
			{
				workspace: `registries:\n  https://${ref("HOST")}/:\n    scopes: ['@acme']\n`,
				path: "/r/pnpm-workspace.yaml",
				setting: `registries['https://${ref("HOST")}/']`,
			},
			{
				workspace: `namedRegistries:\n  work: https://${ref("HOST")}/\n`,
				path: "/r/pnpm-workspace.yaml",
				setting: "namedRegistries['work']",
			},
			// pnpm checks registry first, then namedRegistries, then registries.
			{
				workspace: `registries:\n  '@acme': https://${ref("HOST")}/\nnamedRegistries:\n  work: https://${ref("HOST")}/\nregistry: https://${ref("HOST")}/\n`,
				path: "/r/pnpm-workspace.yaml",
				setting: "registry",
			},
		]) {
			const result = PnpmNpmConfig.fromSourcesResult(sourcesOf({ ...fixture, env: { HOST: "evil.example" } }));
			assert.isTrue(Result.isFailure(result), fixture.setting);
			const error = (result as Result.Failure<NpmConfig, never>).failure as {
				reason: string;
				path: string;
				setting: string;
			};
			assert.strictEqual(error.reason, "untrusted-env");
			assert.strictEqual(error.path, fixture.path);
			assert.strictEqual(error.setting, fixture.setting);
		}
		// A route-less declaration with a literal key is read, and the global file is trusted.
		assert.strictEqual(
			pnpmConfig({ workspace: "registries:\n  https://npm.acme.dev/:\n    serverType: verdaccio\n" }).registry,
			DEFAULT_REGISTRY,
		);
		assert.strictEqual(
			pnpmConfig({
				global: `registries:\n  https://${ref("HOST")}/:\n    scopes: ['@acme']\n`,
				env: { HOST: "ok.example" },
			}).registryFor("@acme/x"),
			"https://ok.example/",
		);
		// The user npmrc and the global file are trusted.
		assert.strictEqual(
			pnpmConfig({ user: `registry=https://${ref("HOST")}/`, env: { HOST: "ok.example" } }).registry,
			"https://ok.example/",
		);
	});

	it("drops a placeholder proxy from a repository file and expands it from a trusted one", () => {
		const env = { PROXY_HOST: "proxy.corp:3128" };
		const proxy = `http://${ref("PROXY_HOST")}`;
		assert.isUndefined(proxyOf(pnpmConfig({ project: `https-proxy=${proxy}`, env }), "https://r.example/"));
		assert.isUndefined(proxyOf(pnpmConfig({ workspace: `httpsProxy: ${proxy}\n`, env }), "https://r.example/"));
		assert.strictEqual(
			proxyOf(pnpmConfig({ global: `httpsProxy: ${proxy}\n`, env }), "https://r.example/"),
			"http://proxy.corp:3128",
		);
	});

	it("pins an unscoped credential and client certificate to the file's own registry", () => {
		const config = pnpmConfig({ user: "registry=https://npm.acme.dev/\n_authToken=acme-token\ncert=CERT-PEM" });
		assert.strictEqual(tokenOf(config, "https://npm.acme.dev/x"), "acme-token");
		assert.isUndefined(tokenOf(config, "https://registry.npmjs.org/x"));
		assert.isUndefined(config.transport.cert, "no top-level certificate");
		const tls = Option.getOrUndefined(config.tlsFor("https://npm.acme.dev/x", { packageManager: "pnpm" }));
		assert.strictEqual(tls?.cert === undefined ? undefined : Redacted.value(tls.cert), "CERT-PEM");
		// With no registry in the file, the public registry is the pin; a scoped line for it wins.
		const pinned = pnpmConfig({ user: "_authToken=unscoped\n//registry.npmjs.org/:_authToken=scoped" });
		assert.strictEqual(tokenOf(pinned, "https://registry.npmjs.org/x"), "scoped");
		assert.strictEqual(
			tokenOf(pnpmConfig({ user: "_authToken=unscoped" }), "https://registry.npmjs.org/x"),
			"unscoped",
		);
	});

	it("reads the npm_config_// and pnpm_config_// credential variables above every file, pnpm's winning", () => {
		const url = "https://registry.npmjs.org/x";
		const project = "//registry.npmjs.org/:_authToken=file-token";
		assert.strictEqual(
			tokenOf(pnpmConfig({ project, env: { "npm_config_//registry.npmjs.org/:_authToken": "npm-env" } }), url),
			"npm-env",
		);
		assert.strictEqual(
			tokenOf(
				pnpmConfig({
					project,
					env: {
						"NPM_CONFIG_//registry.npmjs.org/:_authToken": "npm-env",
						"pnpm_config_//registry.npmjs.org/:_authToken": "pnpm-env",
					},
				}),
				url,
			),
			"pnpm-env",
		);
	});

	it("reads no-proxy and noproxy as one npmrc setting, the higher file winning", () => {
		const config = pnpmConfig({
			user: "https-proxy=http://p.corp:1\nno-proxy=user.example",
			project: "noproxy=project.example",
		});
		assert.isUndefined(proxyOf(config, "https://project.example/"));
		assert.strictEqual(proxyOf(config, "https://user.example/"), "http://p.corp:1");
	});

	it("accumulates repeated ca lines, ignores ca[] lines, and drops a strict-ssl that is not a boolean", () => {
		const config = pnpmConfig({ user: "ca=CA-ONE\nca=CA-TWO\nca[]=CA-ARRAY\nstrict-ssl=0" });
		assert.deepStrictEqual(config.transport.caList, ["CA-ONE", "CA-TWO"]);
		assert.isTrue(config.transport.strictSsl);
	});

	it("follows pnpm's placeholder dialect: defaults, an unset variable read as empty, an escape kept literal", () => {
		const config = pnpmConfig({
			user: [
				`registry=https://${ref("HOST:-fallback.example")}/`,
				`@a:registry=https://a${ref("UNSET")}.example/`,
				`@b:registry=https://\\${ref("HOST")}/`,
			].join("\n"),
			env: {},
		});
		assert.strictEqual(config.registry, "https://fallback.example/");
		assert.strictEqual(config.registryFor("@a/x"), "https://a.example/");
		assert.strictEqual(config.registryFor("@b/x"), `https://${ref("HOST")}/`, "kept literal through NpmConfig");
	});

	it("keeps only the keys pnpm reads from an npmrc", () => {
		const config = pnpmConfig({ user: "min-release-age=5\nregistry=https://r.example/\ntokenHelper=/bin/x" });
		assert.deepStrictEqual(Object.keys(config.settings), ["registry"]);
	});
});

describe("PnpmNpmConfig never lets a settings value write an npmrc line", () => {
	// Each payload would, if a rendered line were not quoted, end the value and
	// start a credential line for another host, or cut the value at a comment.
	const payloads = [
		"\n//evil.example/:_authToken=stolen",
		"\r\n//evil.example/:_authToken=stolen",
		";//evil.example/:_authToken=stolen",
		"#//evil.example/:_authToken=stolen",
		"=//evil.example/:_authToken=stolen",
	];
	/** A YAML double-quoted scalar holding exactly `value`. */
	const yamlString = (value: string): string => JSON.stringify(value);

	const assertInert = (config: NpmConfig, key: string, value: string, label: string): void => {
		assert.isTrue(Option.isNone(config.credentialFor("https://evil.example/pkg")), `${label}: no credential`);
		assert.deepStrictEqual(Object.keys(config.secrets), [], `${label}: no secret`);
		assert.deepStrictEqual(Object.keys(config.settings), [key], `${label}: no extra key`);
		assert.strictEqual(config.settings[key], value, `${label}: the whole value`);
	};

	it("keeps a hostile registry, httpsProxy or noProxy from pnpm-workspace.yaml whole", () => {
		for (const payload of payloads) {
			for (const [setting, key, prefix] of [
				["registry", "registry", "https://ok.example/"],
				["httpsProxy", "https-proxy", "http://proxy.corp:3128/"],
				["noProxy", "no-proxy", "internal.example"],
			] as const) {
				const value = `${prefix}${payload}`;
				assertInert(
					pnpmConfig({ workspace: `${setting}: ${yamlString(value)}\n` }),
					key,
					value,
					`${setting} ${JSON.stringify(payload)}`,
				);
			}
		}
	});

	it("keeps a hostile PNPM_CONFIG_REGISTRY whole", () => {
		for (const payload of payloads) {
			const value = `https://ok.example/${payload}`;
			assertInert(pnpmConfig({ env: { PNPM_CONFIG_REGISTRY: value } }), "registry", value, JSON.stringify(payload));
		}
	});
});

const tree: Readonly<Record<string, string>> = {
	"/repo/pnpm-workspace.yaml": "packages:\n  - 'packages/*'\nhttpsProxy: http://ws.corp:3128\n",
	"/repo/package.json": manifest("repo"),
	"/repo/.npmrc": "@acme:registry=https://npm.acme.dev/\n//npm.acme.dev/:_authToken=root-token\n",
	"/repo/packages/a/package.json": manifest("a"),
	// npm reads the nearest package's npmrc; pnpm reads the workspace root's.
	"/repo/packages/a/.npmrc": "@acme:registry=https://wrong.example/\n",
	"/home/u/.npmrc": "registry=https://user.example/\n",
	"/home/u/.config/pnpm/auth.ini": "//user.example/:_authToken=login-token\n",
	"/home/u/.config/pnpm/config.yaml": "strictSsl: false\n",
	// npm's global npmrc, which pnpm 12 never reads.
	"/usr/local/etc/npmrc": "registry=https://npm-global.example/\n",
	"/alt/.npmrc": "registry=https://alt.example/\n",
	"/locked/.npmrc": "registry=https://locked.example/\n",
	"/locked/package.json": manifest("locked"),
};

layer(platform(tree, { unreadableFiles: new Set(["/locked/.npmrc"]) }))("PnpmNpmConfig.load", (it) => {
	const options = { env: { HOME: "/home/u" }, platform: "linux" } as const;

	it.effect("reads the workspace root's .npmrc, auth.ini, the user npmrc and the settings files", () =>
		Effect.gen(function* () {
			const config = yield* PnpmNpmConfig.load({ ...options, cwd: "/repo/packages/a" });
			assert.strictEqual(config.registryFor("@acme/x"), "https://npm.acme.dev/");
			assert.strictEqual(tokenOf(config, "https://npm.acme.dev/x"), "root-token");
			assert.strictEqual(config.registry, "https://user.example/");
			assert.strictEqual(tokenOf(config, "https://user.example/x"), "login-token");
			assert.strictEqual(proxyOf(config, "https://user.example/x"), "http://ws.corp:3128");
			assert.isFalse(config.transport.strictSsl);
			assert.deepStrictEqual(config.files, ["/home/u/.npmrc", "/home/u/.config/pnpm/auth.ini", "/repo/.npmrc"]);
			// The control: npm, from the same directory, reads the package's own npmrc and no settings file.
			const npm = yield* NpmConfig.load({ cwd: "/repo/packages/a", env: options.env, globalPrefix: "/usr/local" });
			assert.strictEqual(npm.registryFor("@acme/x"), "https://wrong.example/");
			assert.isTrue(npm.transport.isDefault);
		}),
	);

	it.effect("never reads npm's global npmrc, and takes the user npmrc from npm_config_userconfig", () =>
		Effect.gen(function* () {
			const config = yield* PnpmNpmConfig.load({
				...options,
				cwd: "/alt",
				env: { HOME: "/nohome", npm_config_prefix: "/usr/local", npm_config_userconfig: "/alt/.npmrc" },
			});
			assert.strictEqual(config.registry, "https://alt.example/");
			assert.deepStrictEqual(config.files, ["/alt/.npmrc"]);
		}),
	);

	it.effect("prefers pnpm_config_npmrc_auth_file, and trusts a project .npmrc it names", () =>
		Effect.gen(function* () {
			const config = yield* PnpmNpmConfig.load({
				...options,
				cwd: "/repo",
				env: { HOME: "/home/u", pnpm_config_npmrc_auth_file: "/repo/.npmrc", npm_config_userconfig: "/alt/.npmrc" },
			});
			assert.deepStrictEqual(config.files, ["/home/u/.config/pnpm/auth.ini", "/repo/.npmrc"]);
			// `~/.npmrc` is not read: the named file is the user npmrc.
			assert.strictEqual(config.registry, DEFAULT_REGISTRY);
			assert.strictEqual(config.registryFor("@acme/x"), "https://npm.acme.dev/");
		}),
	);

	it.effect("fails NpmConfigError read for an npmrc that exists but cannot be read", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(PnpmNpmConfig.load({ ...options, cwd: "/locked" }));
			assert.strictEqual(error._tag, "NpmConfigError");
			assert.strictEqual(error.reason, "read");
			assert.strictEqual((error as { path?: string }).path, "/locked/.npmrc");
		}),
	);
});

// Congruence tests: npm and pnpm settings that look alike and are not one
// definition, pinned side by side. Each row cites the source it was read from:
//   npm  = workspaces/config/lib/definitions/definitions.js (npm 12.2.2 and
//          11.21.2) and workspaces/config/lib/index.js;
//   pnpm = pnpm 12.20.0: pnpm/crates/config (settings.rs, defaults.rs,
//          env_overlay.rs) and pnpm/docs/settings/*.md.
// The npm values are copied here, never read from an npm checkout.

import { assert, describe, it } from "@effect/vitest";
import { NpmConfig, NpmReleaseAge } from "@effected/npm";
import { Option, Result } from "effect";
import { PnpmSettings, ReleaseAgeGate } from "../src/index.js";
import { PnpmSettingsCatalog } from "../src/settings.js";

const npmConfig = (text: string, env: Record<string, string> = {}): NpmConfig => {
	const result = NpmConfig.fromSourcesResult([{ text }], env);
	if (Result.isFailure(result)) throw new Error("npm config failed");
	return result.success;
};

const pnpmSettings = (env: Record<string, string>): PnpmSettings => {
	const result = PnpmSettings.fromSourcesResult({ env });
	if (Result.isFailure(result)) throw new Error("pnpm settings failed");
	return result.success;
};

const DAY = 86_400_000;
const now = new Date("2026-11-12T00:00:00Z");

describe("release age: npm counts days, pnpm counts minutes", () => {
	// npm: `min-release-age` Number in days, default null (off) — npm 12.2.2
	// definitions.js:1542, npm 11.21.2 :1473. Excludes are minimatch globs.
	// pnpm: `minimumReleaseAge` in minutes, default 1440 — docs/settings/
	// dependency-resolution.md; excludes use @pnpm/matcher.
	const npm = NpmReleaseAge.fromConfig(npmConfig("min-release-age=1"));
	const pnpm = ReleaseAgeGate.combine({ ageMinutes: 1440 });
	const times = (published: Date): Record<string, string> => ({ "1.0.0": published.toISOString() });
	const pnpmAdmits = (published: Date): boolean =>
		pnpm.filterVersions(["1.0.0"], times(published), "left-pad", now.getTime()).length === 1;

	it("1 day and 1440 minutes admit the same version at the same instant", () => {
		const exactlyOneDay = new Date(now.getTime() - DAY);
		const justYounger = new Date(now.getTime() - DAY + 1);
		assert.isTrue(npm.admits("left-pad", exactlyOneDay, now));
		assert.isTrue(pnpmAdmits(exactlyOneDay));
		assert.isFalse(npm.admits("left-pad", justYounger, now));
		assert.isFalse(pnpmAdmits(justYounger));
	});

	it("npm is off by default and pnpm is on at 1440", () => {
		assert.isTrue(Option.isNone(NpmReleaseAge.fromConfig(npmConfig("")).days));
		assert.deepStrictEqual(PnpmSettingsCatalog.entries.minimumReleaseAge.default, Option.some(1440));
	});

	it("the exclude dialects differ: minimatch `*` stops at `/`, @pnpm/matcher's does not", () => {
		const young = new Date(now.getTime() - 1000);
		const npmStar = NpmReleaseAge.fromConfig(npmConfig("min-release-age=1\nmin-release-age-exclude=*"));
		assert.isFalse(npmStar.admits("@scope/pkg", young, now));
		assert.isTrue(npmStar.admits("pkg", young, now));
		const pnpmStar = ReleaseAgeGate.combine({ ageMinutes: 1440, exclude: ["*"] });
		assert.isTrue(pnpmStar.isExcluded("@scope/pkg"));
		assert.isTrue(pnpmStar.isExcluded("pkg"));
	});
});

describe("defaults that differ", () => {
	// Copied npm defaults: fetch-timeout 5 * 60 * 1000 (npm 12.2.2
	// definitions.js:844, npm 11.21.2 :819) and maxsockets 15 (12.2.2 :1520,
	// 11.21.2 :1451). The two majors agree.
	const NPM_FETCH_TIMEOUT = 5 * 60 * 1000;
	const NPM_MAXSOCKETS = 15;

	it("fetch-timeout: npm 300000, pnpm 60000", () => {
		// pnpm 12.20.0: crates/config/src/settings.rs:1020 and docs/settings/network.md:148.
		assert.strictEqual(NPM_FETCH_TIMEOUT, 300000);
		assert.deepStrictEqual(PnpmSettingsCatalog.entries.fetchTimeout.default, Option.some(60000));
	});

	it("maxsockets: npm 15, pnpm has no default", () => {
		// pnpm 12.20.0: settings.rs:1017 (`max_sockets: Option<usize>`, `None` by
		// default) and docs/settings/network.md:67, "Default: unset". The 50 in
		// those docs is a cap applied to proxied connections when unset, not a
		// default value of the setting.
		assert.strictEqual(NPM_MAXSOCKETS, 15);
		assert.isTrue(Option.isNone(PnpmSettingsCatalog.entries.maxsockets.default));
		assert.isTrue(Option.isNone(PnpmSettingsCatalog.entries.maxSockets.default));
	});
});

describe("proxy=false", () => {
	// pnpm: `proxy=false` is "no proxy" and stops the fallback to the proxy
	// variables. npm 11 and 12: `false` reads as unset, so the variables apply.
	const config = npmConfig("proxy=false");
	const env = { HTTPS_PROXY: "http://envproxy.example:3128" };
	const url = "https://registry.npmjs.org/left-pad";

	it("npm falls back to the environment", () => {
		const proxy = config.proxyFor(url, env, { packageManager: "npm" });
		assert.isTrue(Option.isSome(proxy));
	});

	it("pnpm uses no proxy", () => {
		assert.isTrue(Option.isNone(config.proxyFor(url, env, { packageManager: "pnpm" })));
	});
});

describe("per-registry TLS", () => {
	// npm reads only the `certfile`/`keyfile` pair (npm-registry-fetch
	// regFromURI); pnpm 12.20.0 reads all six keys (pickSettingByUrl).
	const all = npmConfig(
		[
			"//reg.example.com/:ca=PEM-CA",
			"//reg.example.com/:cafile=/etc/ca.pem",
			"//reg.example.com/:cert=PEM-CERT",
			"//reg.example.com/:certfile=/etc/cert.pem",
			"//reg.example.com/:key=PEM-KEY",
			"//reg.example.com/:keyfile=/etc/key.pem",
		].join("\n"),
	);
	const url = "https://reg.example.com/pkg";

	it("npm reads the file pair alone", () => {
		const tls = all.tlsFor(url, { packageManager: "npm" });
		assert.isTrue(Option.isSome(tls));
		if (Option.isSome(tls)) {
			assert.strictEqual(tls.value.certfile, "/etc/cert.pem");
			assert.strictEqual(tls.value.keyfile, "/etc/key.pem");
			assert.isUndefined(tls.value.ca);
			assert.isUndefined(tls.value.cafile);
			assert.isUndefined(tls.value.cert);
			assert.isUndefined(tls.value.key);
		}
	});

	it("pnpm reads all six", () => {
		const tls = all.tlsFor(url, { packageManager: "pnpm" });
		assert.isTrue(Option.isSome(tls));
		if (Option.isSome(tls)) {
			assert.strictEqual(tls.value.ca, "PEM-CA");
			assert.strictEqual(tls.value.cafile, "/etc/ca.pem");
			assert.strictEqual(tls.value.certfile, "/etc/cert.pem");
			assert.strictEqual(tls.value.keyfile, "/etc/key.pem");
			assert.isDefined(tls.value.cert);
			assert.isDefined(tls.value.key);
		}
	});

	it("a lone certfile is ignored by npm and read by pnpm", () => {
		const lone = npmConfig("//reg.example.com/:certfile=/etc/cert.pem");
		assert.isTrue(Option.isNone(lone.tlsFor(url, { packageManager: "npm" })));
		assert.isTrue(Option.isSome(lone.tlsFor(url, { packageManager: "pnpm" })));
	});
});

describe("credential lookup", () => {
	// npm stops at the first key holding any auth; pnpm walks parent keys.
	const config = npmConfig(
		[
			"//reg.example.com/a/:_authToken=t",
			"//reg.example.com/:certfile=/etc/cert.pem",
			"//reg.example.com/:keyfile=/etc/key.pem",
		].join("\n"),
	);
	const url = "https://reg.example.com/a/pkg";

	it("npm stops at the deeper key that holds a token", () => {
		assert.isTrue(Option.isNone(config.tlsFor(url, { packageManager: "npm" })));
	});

	it("pnpm walks up to the parent key that holds TLS settings", () => {
		const tls = config.tlsFor(url, { packageManager: "pnpm" });
		assert.isTrue(Option.isSome(tls));
	});
});

describe("environment prefix", () => {
	it("npm reads npm_config_*; pnpm_config_* is not npm's", () => {
		const npm = npmConfig("", { npm_config_min_release_age: "2", pnpm_config_min_release_age: "9" });
		assert.strictEqual(npm.settings["min-release-age"], "2");
	});

	it("pnpm reads pnpm_config_*; npm_config_* is not a pnpm setting source", () => {
		const settings = pnpmSettings({ pnpm_config_minimum_release_age: "5", npm_config_minimum_release_age: "7" });
		const read = PnpmSettingsCatalog.read(settings, "minimumReleaseAge");
		assert.isTrue(Result.isSuccess(read));
		if (Result.isSuccess(read)) assert.deepStrictEqual(read.success, Option.some(5));
		const npmOnly = PnpmSettingsCatalog.read(
			pnpmSettings({ npm_config_minimum_release_age: "7" }),
			"minimumReleaseAge",
		);
		assert.isTrue(Result.isSuccess(npmOnly) && Option.isNone(npmOnly.success));
	});
});

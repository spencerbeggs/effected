// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/bundle-manifest.test.ts on 2026-11-06
import { assert, describe, it } from "@effect/vitest";
import {
	composeBundleManifest,
	githubOwnerRepo,
	ogImageInfoOf,
	registriesFromTargets,
} from "../../src/meta/bundle-manifest.js";

const base = {
	config: undefined,
	leaf: undefined,
	project: undefined,
	packageName: "@scope/pkg",
	isPrivate: false,
	targets: [{ name: "npm", registry: "https://registry.npmjs.org" }],
	generatedImage: undefined,
};

describe("composeBundleManifest", () => {
	it("returns undefined when nothing is configured and the package is private", () => {
		assert.isUndefined(composeBundleManifest({ ...base, isPrivate: true, targets: [] }));
	});

	it("derives registries from targets for a public package", () => {
		assert.deepStrictEqual(composeBundleManifest(base), {
			spec: 1,
			registries: [{ type: "npm", name: "npm", url: "https://www.npmjs.com/package/@scope/pkg" }],
		});
	});

	it("skips derived registries for a private package and when registries is false", () => {
		assert.isUndefined(composeBundleManifest({ ...base, isPrivate: true }));
		assert.deepStrictEqual(composeBundleManifest({ ...base, config: { registries: false, name: "X" } }), {
			spec: 1,
			name: "X",
		});
	});

	it("lets an explicit registries list (config over leaf) replace the derived one", () => {
		const explicit = [{ type: "jsr", name: "jsr", url: "https://jsr.io/@scope/pkg" }];
		assert.deepStrictEqual(composeBundleManifest({ ...base, leaf: { registries: explicit } })?.registries, explicit);
		assert.deepStrictEqual(
			composeBundleManifest({ ...base, config: { registries: explicit }, leaf: { registries: [] } })?.registries,
			explicit,
		);
	});

	it("lets config beat leaf beat project per field and keeps project nested", () => {
		const manifest = composeBundleManifest({
			...base,
			config: { name: "Config" },
			leaf: { name: "Leaf", tagline: "leaf tag" },
			project: { name: "Project", tagline: "project tag", description: "project desc" },
		});
		assert.strictEqual(manifest?.name, "Config");
		assert.strictEqual(manifest?.tagline, "leaf tag");
		assert.isUndefined(manifest?.description);
		assert.deepStrictEqual(manifest?.project, { name: "Project", tagline: "project tag" });
	});

	it("puts the generated image first, then config, leaf, project images", () => {
		const manifest = composeBundleManifest({
			...base,
			generatedImage: { path: "og/pkg.png", type: "image/png", width: 1200, height: 630 },
			config: { openGraph: { images: [{ url: "https://c/og.png" }] } },
			leaf: { openGraph: { images: [{ url: "https://l/og.png" }], themeColor: "#111" } },
			project: { openGraph: { images: [{ url: "https://p/og.png" }], themeColor: "#222" } },
		});
		assert.deepStrictEqual(
			manifest?.openGraph?.images?.map((i) => i.path ?? i.url),
			["og/pkg.png", "https://c/og.png", "https://l/og.png", "https://p/og.png"],
		);
		assert.strictEqual(manifest?.openGraph?.themeColor, "#111");
	});

	it("omits openGraph entirely when no tier declares an image or theme color", () => {
		assert.notProperty(composeBundleManifest({ ...base, config: { name: "X" } }), "openGraph");
	});

	it("never writes an sbom pointer", () => {
		const manifest = composeBundleManifest({ ...base, leaf: { sbom: { path: "x.json" } } });
		assert.isUndefined(manifest?.sbom);
	});
});

describe("registriesFromTargets", () => {
	const github = [{ name: "github", registry: "https://npm.pkg.github.com/" }];

	it("links a GitHub Packages target to the repository's package page", () => {
		assert.deepStrictEqual(
			registriesFromTargets({
				packageName: "@scope/pkg",
				isPrivate: false,
				targets: github,
				repository: { url: "git+https://github.com/owner/repo.git", directory: "packages/pkg" },
			}),
			[{ type: "npm", name: "github", url: "https://github.com/owner/repo/pkgs/npm/pkg" }],
		);
	});

	it("omits a GitHub Packages target when the repository is missing or unparseable", () => {
		assert.deepStrictEqual(registriesFromTargets({ packageName: "@scope/pkg", isPrivate: false, targets: github }), []);
		assert.deepStrictEqual(
			registriesFromTargets({
				packageName: "@scope/pkg",
				isPrivate: false,
				targets: github,
				repository: { url: "https://gitlab.com/owner/repo" },
			}),
			[],
		);
	});

	it("strips any run of trailing slashes from the registry endpoint", () => {
		assert.deepStrictEqual(
			registriesFromTargets({
				packageName: "@scope/pkg",
				isPrivate: false,
				targets: [{ name: "npm", registry: `https://registry.npmjs.org${"/".repeat(5000)}` }],
			}),
			[{ type: "npm", name: "npm", url: "https://www.npmjs.com/package/@scope/pkg" }],
		);
	});

	it("links any other non-npmjs registry to <host>/package/<name> and keeps type npm", () => {
		assert.deepStrictEqual(
			registriesFromTargets({
				packageName: "@scope/pkg",
				isPrivate: false,
				targets: [{ name: "verdaccio", registry: "https://npm.example.com/" }],
			}),
			[{ type: "npm", name: "verdaccio", url: "https://npm.example.com/package/@scope/pkg" }],
		);
	});
});

describe("githubOwnerRepo", () => {
	it.each([
		"https://github.com/owner/repo",
		"https://github.com/owner/repo.git",
		"git+https://github.com/owner/repo.git",
		"git@github.com:owner/repo.git",
		"ssh://git@github.com/owner/repo.git",
		"git://github.com/owner/repo.git",
		"github:owner/repo",
		"https://www.github.com/owner/repo/",
	])("parses %s", (url) => {
		assert.deepStrictEqual(githubOwnerRepo(url), { owner: "owner", repo: "repo" });
	});

	it.each(["https://gitlab.com/owner/repo", "https://github.com/owner", "not a url", ""])("rejects %s", (url) => {
		assert.isUndefined(githubOwnerRepo(url));
	});
});

describe("ogImageInfoOf", () => {
	it("falls back to the package name and carries the project tier", () => {
		assert.deepStrictEqual(ogImageInfoOf({ ...base, version: "1.2.3", project: { name: "P" } }), {
			name: "@scope/pkg",
			packageName: "@scope/pkg",
			version: "1.2.3",
			project: { name: "P" },
		});
	});

	it("takes the tagline from the project tier when config and leaf are silent", () => {
		const info = ogImageInfoOf({
			...base,
			version: "0.0.1",
			leaf: { name: "Leaf", description: "leaf desc" },
			project: { tagline: "project tag" },
		});
		assert.deepStrictEqual(info, {
			name: "Leaf",
			packageName: "@scope/pkg",
			version: "0.0.1",
			tagline: "project tag",
			description: "leaf desc",
			project: { tagline: "project tag" },
		});
	});
});

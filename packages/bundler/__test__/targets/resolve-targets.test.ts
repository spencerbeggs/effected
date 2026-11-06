import { assert, describe, it } from "@effect/vitest";
import { releaseWarnings, resolveTargets } from "../../src/targets/resolve-targets.js";

describe("resolveTargets", () => {
	it("collapses npm:true + github:true into one canonical base-name group (scoped base)", () => {
		const r = resolveTargets({ targets: { npm: true, github: true }, baseName: "@savvy-web/x" });
		assert.lengthOf(r.groups, 1);
		assert.strictEqual(r.groups[0]?.id, "npm");
		assert.strictEqual(r.groups[0]?.name, "@savvy-web/x");
		assert.strictEqual(r.groups[0]?.dir, "dist/prod/npm/pkg");
		assert.deepStrictEqual(r.targets.map((t) => t.id).sort(), ["github", "npm"]);
		assert.strictEqual(r.targets.find((t) => t.id === "github")?.registry, "https://npm.pkg.github.com");
		assert.strictEqual(
			r.targets.every((t) => t.group === "npm"),
			true,
		);
	});

	it("npm:true (base) + github string override produces two groups with distinct names", () => {
		const r = resolveTargets({ targets: { npm: true, github: "@spencerbeggs/x" }, baseName: "x" });
		assert.deepStrictEqual(r.groups.map((g) => g.id).sort(), ["github", "npm"]);
		assert.strictEqual(r.groups.find((g) => g.id === "npm")?.name, "x");
		assert.strictEqual(r.groups.find((g) => g.id === "github")?.name, "@spencerbeggs/x");
		assert.strictEqual(r.groups.find((g) => g.id === "github")?.dir, "dist/prod/github/pkg");
	});

	it("from reuses the referenced group's bytes (no new group) and sets its own registry", () => {
		const r = resolveTargets({
			targets: { npm: true, mirror: { from: "npm", registry: "https://mirror.test" } },
			baseName: "x",
		});
		assert.lengthOf(r.groups, 1);
		assert.strictEqual(r.groups[0]?.id, "npm");
		const mirror = r.targets.find((t) => t.id === "mirror");
		assert.strictEqual(mirror?.group, "npm");
		assert.strictEqual(mirror?.name, "x");
		assert.strictEqual(mirror?.registry, "https://mirror.test");
	});

	it("object name override on a custom key gets its own group and requires a registry", () => {
		const r = resolveTargets({
			targets: { npm: true, gh2: { name: "@a/x", registry: "https://r2.test" } },
			baseName: "x",
		});
		assert.deepStrictEqual(r.groups.map((g) => g.id).sort(), ["gh2", "npm"]);
		assert.strictEqual(r.targets.find((t) => t.id === "gh2")?.name, "@a/x");
	});

	it("folders the canonical group after the first true id when no npm key is present", () => {
		const r = resolveTargets({ targets: { github: true }, baseName: "@s/x" });
		assert.strictEqual(r.groups[0]?.id, "github");
		assert.strictEqual(r.groups[0]?.dir, "dist/prod/github/pkg");
	});

	it("throws on from+name together", () => {
		assert.throws(
			() =>
				resolveTargets({
					targets: { npm: true, x: { from: "npm", name: "@a/x", registry: "https://r" } },
					baseName: "x",
				}),
			/mutually exclusive/,
		);
	});

	it("throws on a dangling from", () => {
		assert.throws(
			() => resolveTargets({ targets: { x: { from: "nope", registry: "https://r" } }, baseName: "x" }),
			/dangling/,
		);
	});

	it("throws a ConfigValidationError (typed) on a dangling from", () => {
		try {
			resolveTargets({ targets: { x: { from: "nope", registry: "https://r" } }, baseName: "x" });
			assert.fail("should have thrown");
		} catch (e) {
			assert.strictEqual((e as { _tag?: string })._tag, "ConfigValidationError");
		}
	});

	it("throws on chained from", () => {
		assert.throws(
			() =>
				resolveTargets({
					targets: { npm: true, a: { from: "b", registry: "https://a" }, b: { from: "npm", registry: "https://b" } },
					baseName: "x",
				}),
			/chained/,
		);
	});

	it("throws on a custom key with no registry", () => {
		assert.throws(() => resolveTargets({ targets: { custom: { name: "@a/x" } }, baseName: "x" }), /registry/);
	});

	it("throws on github:true with an unscoped base name", () => {
		assert.throws(() => resolveTargets({ targets: { github: true }, baseName: "x" }), /scoped/);
	});

	it("throws on an unknown registry key with value true", () => {
		assert.throws(() => resolveTargets({ targets: { custom: true }, baseName: "x" }), /not a known registry/);
	});

	it("throws when targets is empty", () => {
		assert.throws(() => resolveTargets({ targets: {}, baseName: "x" }), /at least one/);
	});

	it("permits npm:true with an unscoped base name", () => {
		const r = resolveTargets({ targets: { npm: true }, baseName: "unscoped" });
		assert.strictEqual(r.groups[0]?.name, "unscoped");
	});

	it("throws on a self-referencing from", () => {
		assert.throws(
			() => resolveTargets({ targets: { a: { from: "a", registry: "https://r" } }, baseName: "x" }),
			/self-referencing/,
		);
	});

	it("from reuses a string-override group's bytes", () => {
		const r = resolveTargets({
			targets: { github: "@scope/x", mirror: { from: "github", registry: "https://mirror.test" } },
			baseName: "x",
		});
		assert.lengthOf(r.groups, 1);
		assert.strictEqual(r.groups[0]?.id, "github");
		assert.strictEqual(r.targets.find((t) => t.id === "mirror")?.group, "github");
		assert.strictEqual(r.targets.find((t) => t.id === "mirror")?.name, "@scope/x");
	});

	describe("releases and provenance", () => {
		it("defaults releases to all on every target form and omits an undeclared provenance", () => {
			const r = resolveTargets({
				targets: { npm: true, github: "@s/x", pnpr: { registry: "https://r.test" } },
				baseName: "x",
			});
			assert.deepStrictEqual(
				r.targets.map((t) => t.releases),
				["all", "all", "all"],
			);
			assert.strictEqual(
				r.targets.every((t) => !("provenance" in t)),
				true,
			);
		});

		it("carries a declared releases and provenance onto the resolved target", () => {
			const r = resolveTargets({
				targets: {
					npm: { releases: "stable" },
					pnpr: { registry: "https://r.test", releases: "all", provenance: false },
				},
				baseName: "x",
			});
			const npm = r.targets.find((t) => t.id === "npm");
			assert.strictEqual(npm?.releases, "stable");
			assert.isFalse(npm !== undefined && "provenance" in npm);
			const pnpr = r.targets.find((t) => t.id === "pnpr");
			assert.strictEqual(pnpr?.releases, "all");
			assert.strictEqual(pnpr?.provenance, false);
		});

		it("resolves a from target's filter from its own object, not the group it reuses", () => {
			const r = resolveTargets({
				targets: { npm: { releases: "stable" }, pnpr: { from: "npm", registry: "https://r.test", releases: "all" } },
				baseName: "x",
			});
			assert.lengthOf(r.groups, 1);
			assert.strictEqual(r.targets.find((t) => t.id === "npm")?.releases, "stable");
			const pnpr = r.targets.find((t) => t.id === "pnpr");
			assert.strictEqual(pnpr?.group, "npm");
			assert.strictEqual(pnpr?.releases, "all");
		});

		it("throws a ConfigValidationError on an unknown releases value", () => {
			try {
				resolveTargets({ targets: { npm: { releases: "beta" as never } }, baseName: "x" });
				assert.fail("should have thrown");
			} catch (e) {
				assert.strictEqual((e as { _tag?: string })._tag, "ConfigValidationError");
				assert.strictEqual((e as { path?: string }).path, "publishConfig.targets.npm.releases");
			}
		});

		it("throws on a non-boolean provenance", () => {
			assert.throws(
				() => resolveTargets({ targets: { npm: { provenance: "yes" as never } }, baseName: "x" }),
				/non-boolean provenance/,
			);
		});
	});

	describe("releaseWarnings", () => {
		it("warns when every target is prerelease-only", () => {
			const r = resolveTargets({
				targets: {
					npm: { releases: "prerelease" },
					pnpr: { from: "npm", registry: "https://r.test", releases: "prerelease" },
				},
				baseName: "x",
			});
			assert.lengthOf(releaseWarnings(r), 1);
			assert.match(releaseWarnings(r)[0], /final versions publish nowhere/);
		});

		it("stays quiet when any target still receives final versions", () => {
			const r = resolveTargets({
				targets: {
					npm: { releases: "stable" },
					pnpr: { from: "npm", registry: "https://r.test", releases: "prerelease" },
				},
				baseName: "x",
			});
			assert.deepStrictEqual(releaseWarnings(r), []);
		});
	});
});

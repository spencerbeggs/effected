// `CatalogSet`'s resolution against pnpm 12's catalog crates
// (okf/decisions/catalog-and-workspace-protocol-owner.md). Each case is one
// rule of `resolve_from_catalog` or `get_catalogs_from_workspace_manifest`.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { CatalogSet } from "../src/index.js";

describe("CatalogSet.resolveSpecifier — pnpm 12 catalog resolution", () => {
	const set = CatalogSet.fromCatalogs({
		default: { effect: "^4.0.0", local: "link:../local", tarball: "file:./x.tgz", loop: "catalog:other" },
		build: { typescript: "7.1.0" },
	});

	it("`catalog:` and `catalog:default` both name the default catalog", () => {
		assert.deepStrictEqual(set.resolveSpecifier("effect", "catalog:"), Option.some("^4.0.0"));
		assert.deepStrictEqual(set.resolveSpecifier("effect", "catalog:default"), Option.some("^4.0.0"));
		assert.deepStrictEqual(set.resolveSpecifier("effect", "catalog: default "), Option.some("^4.0.0"));
	});

	it("a named catalog resolves its own entry and not the default's", () => {
		assert.deepStrictEqual(set.resolveSpecifier("typescript", "catalog:build"), Option.some("7.1.0"));
		assert.isTrue(Option.isNone(set.resolveSpecifier("effect", "catalog:build")));
	});

	it("a `link:` or `file:` entry resolves as written, as pnpm 12 resolves it", () => {
		assert.deepStrictEqual(set.resolveSpecifier("local", "catalog:"), Option.some("link:../local"));
		assert.deepStrictEqual(set.resolveSpecifier("tarball", "catalog:"), Option.some("file:./x.tgz"));
	});

	it("an entry that is itself a `catalog:` reference is a misconfiguration, never followed", () => {
		assert.isTrue(Option.isNone(set.resolveSpecifier("loop", "catalog:")));
	});

	it("a non-catalog specifier and a missing entry resolve to nothing", () => {
		assert.isTrue(Option.isNone(set.resolveSpecifier("effect", "^4.0.0")));
		assert.isTrue(Option.isNone(set.resolveSpecifier("absent", "catalog:")));
	});

	it("an inherited name is not an entry", () => {
		assert.isTrue(Option.isNone(set.resolveSpecifier("constructor", "catalog:")));
		assert.isTrue(Option.isNone(set.resolveSpecifier("effect", "catalog:constructor")));
	});
});

describe("CatalogSet.fromWorkspaceYaml — the default catalog's two spellings", () => {
	it.effect("a top-level `catalog` lands under `default` beside the named catalogs", () =>
		Effect.gen(function* () {
			const set = yield* CatalogSet.fromWorkspaceYaml("catalog:\n  a: ^1.0.0\ncatalogs:\n  b:\n    c: ^2.0.0\n");
			assert.deepStrictEqual(set.entries, { default: { a: "^1.0.0" }, b: { c: "^2.0.0" } });
		}),
	);

	it.effect("the default catalog defined twice is refused, so nothing is assembled", () =>
		Effect.gen(function* () {
			const set = yield* CatalogSet.fromWorkspaceYaml(
				"catalog:\n  a: ^1.0.0\ncatalogs:\n  default:\n    a: ^2.0.0\n  b:\n    c: ^2.0.0\n",
			);
			assert.isTrue(set.isEmpty);
		}),
	);
});

describe("CatalogSet.merge", () => {
	it("later sets win per entry, and catalogs and entries from both survive", () => {
		const merged = CatalogSet.merge(
			CatalogSet.fromCatalogs({ default: { a: "1", b: "1" }, x: { y: "1" } }),
			CatalogSet.fromCatalogs({ default: { b: "2", c: "2" } }),
		);
		assert.deepStrictEqual(merged.entries, { default: { a: "1", b: "2", c: "2" }, x: { y: "1" } });
	});
});

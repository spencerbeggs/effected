import { assert, describe, it } from "@effect/vitest";
import { mergeApiModels } from "../../src/meta/merge-models.js";

function model(entryName: string, pkg: string, memberRef: string): Record<string, unknown> {
	return {
		kind: "Package",
		canonicalReference: `${pkg}!`,
		members: [
			{
				kind: "EntryPoint",
				name: "",
				canonicalReference: `${pkg}!`,
				members: [{ kind: "Variable", name: entryName, canonicalReference: memberRef }],
			},
		],
	};
}

describe("mergeApiModels", () => {
	it("merges entry points and rewrites sub-entry canonical references", () => {
		const perEntryModels = new Map<string, Record<string, unknown>>([
			["index", model("a", "@scope/pkg", "@scope/pkg!a:var")],
			["sub", model("b", "@scope/pkg", "@scope/pkg!b:var")],
		]);
		const merged = mergeApiModels({
			perEntryModels,
			packageName: "@scope/pkg",
			exportPaths: { index: ".", sub: "./sub" },
		});
		const members = merged.members as Array<Record<string, unknown>>;
		assert.strictEqual(members.length, 2);
		// main entry first, untouched
		assert.strictEqual(members[0]?.canonicalReference, "@scope/pkg!");
		// sub entry rewritten
		const sub = members.find((m) => m.name === "sub") as Record<string, unknown>;
		assert.strictEqual(sub.canonicalReference, "@scope/pkg/sub!");
		const subMember = (sub.members as Array<Record<string, unknown>>)[0];
		assert.strictEqual(subMember?.canonicalReference, "@scope/pkg/sub!b:var");
	});

	it("returns the single model unchanged in shape when only one entry", () => {
		const perEntryModels = new Map([["index", model("a", "@scope/pkg", "@scope/pkg!a:var")]]);
		const merged = mergeApiModels({ perEntryModels, packageName: "@scope/pkg", exportPaths: { index: "." } });
		assert.strictEqual((merged.members as unknown[]).length, 1);
	});
});

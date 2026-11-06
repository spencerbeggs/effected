import { assert, describe, it } from "@effect/vitest";
import { normalizeMetaOptions } from "../../src/meta/config.js";

describe("normalizeMetaOptions", () => {
	it("defaults localPaths and tsdoc to empty", () => {
		const n = normalizeMetaOptions({});
		assert.deepStrictEqual(n.localPaths, []);
		assert.deepStrictEqual(n.tsdoc.suppressWarnings, []);
		assert.deepStrictEqual(n.tsdoc.tagDefinitions, []);
	});

	it("preserves provided values", () => {
		const n = normalizeMetaOptions({
			localPaths: ["../../website/lib/models/sdk"],
			tsdoc: {
				suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
				tagDefinitions: [{ tagName: "@since", syntaxKind: "block" }],
			},
		});
		assert.deepStrictEqual(n.localPaths, ["../../website/lib/models/sdk"]);
		assert.strictEqual(n.tsdoc.suppressWarnings[0]?.messageId, "ae-forgotten-export");
		assert.strictEqual(n.tsdoc.tagDefinitions[0]?.tagName, "@since");
	});
});

describe("normalizeMetaOptions optimistic", () => {
	it('defaults to "auto" -> true outside CI', () => {
		assert.strictEqual(normalizeMetaOptions({}, {}).optimistic, true);
	});

	it('"auto" -> false when CI is set', () => {
		assert.strictEqual(normalizeMetaOptions({ optimistic: "auto" }, { CI: "true" }).optimistic, false);
	});

	it('"auto" -> false when GITHUB_ACTIONS is set', () => {
		assert.strictEqual(normalizeMetaOptions({}, { GITHUB_ACTIONS: "true" }).optimistic, false);
	});

	it("explicit true/false override the env entirely", () => {
		assert.strictEqual(normalizeMetaOptions({ optimistic: true }, { CI: "true" }).optimistic, true);
		assert.strictEqual(normalizeMetaOptions({ optimistic: false }, {}).optimistic, false);
	});
});

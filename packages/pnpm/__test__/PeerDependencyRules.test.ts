import { assert, describe, it } from "@effect/vitest";
import { PeerDependencyRules } from "../src/index.js";

// `ignoreMissing` and `allowAny` are `@pnpm/matcher` lists over the peer NAME;
// the per-pattern semantics are pinned in PnpmMatcher.test.ts and
// `PeerDependencyRules` delegates to it. The rows here pin the delegation and
// the three-axis shape. The `allowedVersions` entries mirror what
// rolldown-pnpm-config's `allowedVersionsFromCatalogs` derives
// (package/__test__/plugin/allowed-versions.test.ts) and what its
// `resolvePeerDependencyRules` leaves untouched when no directive is present
// (`{ allowedVersions: { react: "18" } }`).

describe("PeerDependencyRules", () => {
	it("an absent axis matches nothing", () => {
		const rules = PeerDependencyRules.make({});
		assert.isFalse(rules.matchesIgnoreMissing("react"));
		assert.isFalse(rules.matchesAllowAny("react"));
	});

	it("matchesIgnoreMissing applies the ignoreMissing list only", () => {
		const rules = PeerDependencyRules.make({ ignoreMissing: ["react*"], allowAny: ["redux"] });
		assert.isTrue(rules.matchesIgnoreMissing("react"));
		assert.isTrue(rules.matchesIgnoreMissing("react-dom"));
		assert.isFalse(rules.matchesIgnoreMissing("redux"));
	});

	it("matchesAllowAny applies the allowAny list only", () => {
		const rules = PeerDependencyRules.make({ ignoreMissing: ["react"], allowAny: ["redux", "@types/*"] });
		assert.isTrue(rules.matchesAllowAny("redux"));
		assert.isTrue(rules.matchesAllowAny("@types/node"));
		assert.isFalse(rules.matchesAllowAny("react"));
	});

	it("honours negations and order like @pnpm/matcher", () => {
		const rules = PeerDependencyRules.make({ allowAny: ["*", "!redux"], ignoreMissing: ["!redux", "*"] });
		assert.isTrue(rules.matchesAllowAny("react"));
		assert.isFalse(rules.matchesAllowAny("redux"));
		assert.isTrue(rules.matchesIgnoreMissing("redux"));
	});

	it("a parent>peer entry is a literal name, never a parent match", () => {
		const rules = PeerDependencyRules.make({ ignoreMissing: ["react-dom>react"] });
		assert.isFalse(rules.matchesIgnoreMissing("react"));
		assert.isFalse(rules.matchesIgnoreMissing("react-dom"));
	});

	it("carries allowedVersions as a key to range record", () => {
		const rules = PeerDependencyRules.make({
			allowedVersions: { "@effect/platform-node@4.0.0-beta.99>effect": "4.0.0-beta.99", react: "18" },
		});
		assert.strictEqual(rules.allowedVersions?.react, "18");
		assert.strictEqual(rules.allowedVersions?.["@effect/platform-node@4.0.0-beta.99>effect"], "4.0.0-beta.99");
	});

	it("empty has every axis present and empty, and matches nothing", () => {
		assert.deepStrictEqual(PeerDependencyRules.empty.allowedVersions, {});
		assert.deepStrictEqual(PeerDependencyRules.empty.ignoreMissing, []);
		assert.deepStrictEqual(PeerDependencyRules.empty.allowAny, []);
		assert.isFalse(PeerDependencyRules.empty.matchesIgnoreMissing("react"));
		assert.isFalse(PeerDependencyRules.empty.matchesAllowAny("react"));
	});

	it("empty is frozen on every axis", () => {
		assert.isTrue(Object.isFrozen(PeerDependencyRules.empty));
		assert.isTrue(Object.isFrozen(PeerDependencyRules.empty.ignoreMissing));
		assert.isTrue(Object.isFrozen(PeerDependencyRules.empty.allowAny));
		assert.isTrue(Object.isFrozen(PeerDependencyRules.empty.allowedVersions));
	});

	it("rejects an explicit undefined axis", () => {
		assert.throws(() => PeerDependencyRules.make({ ignoreMissing: undefined } as never));
	});
});

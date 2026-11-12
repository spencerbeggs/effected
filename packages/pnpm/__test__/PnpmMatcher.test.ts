import { assert, describe, it } from "@effect/vitest";
import { PnpmMatcher } from "../src/index.js";

// The `peerDependencyRules.ignoreMissing` / `allowAny` pattern grammar.
// `@effected/workspaces`' PeerCheck oracle fixtures carry only
// `react`/`redux`-shaped names, so the scoped-name and order-sensitivity
// cases have no oracle row to fire on and are pinned here against the
// `@pnpm/matcher@1000.1.0` source they restate. The oracle file names cited
// below live under `packages/workspaces/__test__/fixtures/peers/`.
describe("PnpmMatcher.compile — @pnpm/matcher semantics", () => {
	it("an empty list matches nothing", () => {
		assert.isFalse(PnpmMatcher.compile([])("react"));
	});

	it("a lone `*` matches everything", () => {
		const m = PnpmMatcher.compile(["*"]);
		assert.isTrue(m("react"));
		assert.isTrue(m("@types/react"));
		assert.isTrue(m(""));
	});

	it("a pattern without `*` is plain equality, not a prefix", () => {
		const m = PnpmMatcher.compile(["react"]);
		assert.isTrue(m("react"));
		assert.isFalse(m("react-dom"));
		assert.isFalse(m("preact"));
	});

	it("`re*` is an anchored wildcard", () => {
		const m = PnpmMatcher.compile(["re*"]);
		assert.isTrue(m("react"));
		assert.isTrue(m("redux"));
		assert.isTrue(m("re"));
		assert.isFalse(m("preact"));
		assert.isFalse(m("@re/x"));
	});

	it("a scoped pattern keeps regex-special characters literal", () => {
		const m = PnpmMatcher.compile(["@types/*"]);
		assert.isTrue(m("@types/react"));
		assert.isTrue(m("@types/node"));
		assert.isFalse(m("@typesXreact"));
		assert.isFalse(m("types/react"));
		// `.` in a name must not become "any character".
		assert.isFalse(PnpmMatcher.compile(["lodash.*"])("lodashXmerge"));
		assert.isTrue(PnpmMatcher.compile(["lodash.*"])("lodash.merge"));
		assert.isTrue(PnpmMatcher.compile(["@types/react"])("@types/react"));
	});

	it("a single negation matches everything except", () => {
		const m = PnpmMatcher.compile(["!redux"]);
		assert.isTrue(m("react"));
		assert.isFalse(m("redux"));
	});

	it("a list of only negations matches everything none of them excludes", () => {
		const m = PnpmMatcher.compile(["!redux", "!re*"]);
		assert.isTrue(m("zustand"));
		assert.isFalse(m("redux"));
		assert.isFalse(m("react"));
	});

	it("a list of only includes matches when any does", () => {
		const m = PnpmMatcher.compile(["react", "redux"]);
		assert.isTrue(m("react"));
		assert.isTrue(m("redux"));
		assert.isFalse(m("zustand"));
	});

	it("a mixed list is walked in order: a later negation resets an earlier include", () => {
		assert.isFalse(PnpmMatcher.compile(["*", "!redux"])("redux"));
		assert.isTrue(PnpmMatcher.compile(["*", "!redux"])("react"));
		// The other order: the negation runs first, then `*` includes redux again
		// (oracle: allowany/peers-check-negation-then-star.json).
		assert.isTrue(PnpmMatcher.compile(["!redux", "*"])("redux"));
	});

	it("a lone `!` negates the empty name, which nothing has, so it matches everything", () => {
		// Oracle: allowany/peers-check-lone-negation.json clears both bad rows.
		const m = PnpmMatcher.compile(["!"]);
		assert.isTrue(m("react"));
		assert.isTrue(m("redux"));
	});
});

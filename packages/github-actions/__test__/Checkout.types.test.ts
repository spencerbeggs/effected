import { assert, describe, it } from "@effect/vitest";
import { Redacted, Schema } from "effect";
import {
	Checkout,
	CheckoutAuth,
	CheckoutAuthError,
	CheckoutCommitMismatchError,
	CheckoutDefaultBranchError,
	CheckoutGitTooOldError,
	CheckoutPathError,
	CheckoutRef,
	CheckoutRefNotFoundError,
	CheckoutResult,
	CheckoutUnsafePullRequestError,
} from "../src/index.js";

describe("Checkout errors", () => {
	it("render every field in the message, never undefined", () => {
		const errors = [
			new CheckoutGitTooOldError({ found: "2.30.0", required: "2.39.0" }),
			new CheckoutUnsafePullRequestError({ event: "pull_request_target", repository: "o/r", ref: "refs/pull/1/head" }),
			new CheckoutRefNotFoundError({ ref: "refs/heads/nope" }),
			new CheckoutCommitMismatchError({ ref: "main", expected: "abc123" }),
			new CheckoutAuthError({ repository: "o/r", detail: "bad credentials" }),
			new CheckoutPathError({ path: "../x", workspace: "/w" }),
			new CheckoutDefaultBranchError({ repository: "o/r" }),
		];
		for (const error of errors) {
			assert.notInclude(error.message, "undefined", error._tag);
		}
		assert.include(errors[0]?.message, "2.30.0");
		assert.include(errors[0]?.message, "2.39.0");
		assert.include(errors[1]?.message, "pull_request_target");
		assert.include(errors[1]?.message, "on the checkout");
		assert.notInclude(errors[1]?.message, "actions/checkout");
		assert.include(errors[2]?.message, "refs/heads/nope");
		assert.include(errors[3]?.message, "abc123");
		assert.include(errors[4]?.message, "bad credentials");
		assert.include(errors[5]?.message, "../x");
		assert.include(errors[5]?.message, "/w");
		assert.include(errors[6]?.message, "o/r");
	});
});

describe("CheckoutResult", () => {
	it("round-trips through its schema", () => {
		const result = new CheckoutResult({
			ref: "refs/heads/main",
			commit: "a".repeat(40),
			path: "/w",
			repository: { owner: "o", name: "r" },
		});
		const encoded = Schema.encodeSync(CheckoutResult)(result);
		const decoded = Schema.decodeUnknownSync(CheckoutResult)(encoded);
		assert.deepStrictEqual(decoded, result);
	});
});

describe("CheckoutRef and CheckoutAuth", () => {
	it("decode each ref member by tag", () => {
		for (const value of [
			{ _tag: "Event" },
			{ _tag: "Default" },
			{ _tag: "Branch", name: "main" },
			{ _tag: "Tag", name: "v1", commit: "abc" },
			{ _tag: "Commit", sha: "abc" },
			{ _tag: "PullRequest", number: 3, kind: "merge" },
			{ _tag: "Ref", ref: "refs/heads/x" },
		]) {
			assert.strictEqual(Schema.decodeUnknownSync(CheckoutRef)(value)._tag, value._tag);
		}
	});

	it("carries secrets as Redacted", () => {
		const auth = Schema.decodeUnknownSync(CheckoutAuth)({ _tag: "Token", token: Redacted.make("t") });
		assert.strictEqual(auth._tag, "Token");
		assert.notInclude(String(auth), '"t"');
	});

	it("declares its statics", () => {
		for (const name of ["checkout", "cleanup", "fromInputs", "inputs", "writeOutputs"] as const) {
			assert.isFunction(Checkout[name], name);
		}
	});
});

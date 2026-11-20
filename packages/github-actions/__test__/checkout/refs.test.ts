import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { CheckoutRefNotFoundError } from "../../src/Checkout.js";
import {
	checkoutInfo,
	fetchUrl,
	refSpec,
	refSpecForAllHistory,
	serverOrigin,
	testRef,
} from "../../src/internal/checkout/refs.js";

const commit = "1234567890123456789012345678901234567890";
const sha256Commit = "1234567890123456789012345678901234567890123456789012345678901234";

const noGit = {
	branchExists: () => Effect.die("branchExists unexpected"),
	tagExists: () => Effect.die("tagExists unexpected"),
};

const lookup = (branch: boolean, tag: boolean) => ({
	branchExists: (_: string) => Effect.succeed(branch),
	tagExists: (_: string) => Effect.succeed(tag),
});

const info = (l: typeof noGit | ReturnType<typeof lookup>, ref: string, sha: string) =>
	Effect.runPromise(checkoutInfo(l as never, ref, sha));

describe("checkoutInfo", () => {
	it("requires ref or commit", async () => {
		const exit = await Effect.runPromiseExit(checkoutInfo(noGit, "", ""));
		assert.isTrue(Exit.isFailure(exit));
		assert.include(
			Cause.pretty((exit as Exit.Failure<unknown, unknown>).cause),
			"Args ref and commit cannot both be empty",
		);
	});

	it("sha only", async () => {
		const r = await info(noGit, "", commit);
		assert.strictEqual(r.ref, commit);
		assert.isTrue(Option.isNone(r.startPoint));
	});

	it("sha-256 only", async () => {
		const r = await info(noGit, "", sha256Commit);
		assert.strictEqual(r.ref, sha256Commit);
		assert.isTrue(Option.isNone(r.startPoint));
	});

	it("refs/heads/", async () => {
		const r = await info(noGit, "refs/heads/my/branch", commit);
		assert.strictEqual(r.ref, "my/branch");
		assert.deepStrictEqual(r.startPoint, Option.some("refs/remotes/origin/my/branch"));
	});

	it("refs/pull/", async () => {
		const r = await info(noGit, "refs/pull/123/merge", commit);
		assert.strictEqual(r.ref, "refs/remotes/pull/123/merge");
		assert.isTrue(Option.isNone(r.startPoint));
	});

	it("refs/tags/", async () => {
		const r = await info(noGit, "refs/tags/my-tag", commit);
		assert.strictEqual(r.ref, "refs/tags/my-tag");
		assert.isTrue(Option.isNone(r.startPoint));
	});

	it("refs/", async () => {
		const r = await info(noGit, "refs/gh/queue/main/pr-123", commit);
		assert.strictEqual(r.ref, commit);
		assert.isTrue(Option.isNone(r.startPoint));
	});

	it("refs/ without commit", async () => {
		const r = await info(noGit, "refs/non-standard-ref", "");
		assert.strictEqual(r.ref, "refs/non-standard-ref");
		assert.isTrue(Option.isNone(r.startPoint));
	});

	it("matches the prefix case-insensitively", async () => {
		const r = await info(noGit, "REFS/HEADS/x", commit);
		assert.strictEqual(r.ref, "x");
	});

	it("unqualified branch only", async () => {
		const r = await info(lookup(true, false), "my/branch", "");
		assert.strictEqual(r.ref, "my/branch");
		assert.deepStrictEqual(r.startPoint, Option.some("refs/remotes/origin/my/branch"));
	});

	it("looks the branch up as origin/<ref>", async () => {
		const seen: Array<string> = [];
		await Effect.runPromise(
			checkoutInfo(
				{
					branchExists: (n) =>
						Effect.sync(() => {
							seen.push(n);
							return true;
						}),
					tagExists: () => Effect.succeed(false),
				},
				"my/branch",
				"",
			),
		);
		assert.deepStrictEqual(seen, ["origin/my/branch"]);
	});

	it("unqualified tag only", async () => {
		const r = await info(lookup(false, true), "my-tag", "");
		assert.strictEqual(r.ref, "refs/tags/my-tag");
		assert.isTrue(Option.isNone(r.startPoint));
	});

	it("unqualified ref that is neither branch nor tag", async () => {
		const error = await Effect.runPromise(Effect.flip(checkoutInfo(lookup(false, false), "my-ref", "")));
		assert.instanceOf(error, CheckoutRefNotFoundError);
		assert.strictEqual(error.ref, "my-ref");
	});
});

describe("refSpec", () => {
	it("requires ref or commit", () => {
		assert.throws(() => refSpec("", "", false), /Args ref and commit cannot both be empty/);
	});

	it("sha + refs/heads/", () => {
		assert.deepStrictEqual(refSpec("refs/heads/my/branch", commit, false), [
			`+${commit}:refs/remotes/origin/my/branch`,
		]);
	});

	it("sha + refs/pull/", () => {
		assert.deepStrictEqual(refSpec("refs/pull/123/merge", commit, false), [`+${commit}:refs/remotes/pull/123/merge`]);
	});

	it("sha + refs/tags/", () => {
		assert.deepStrictEqual(refSpec("refs/tags/my-tag", commit, false), ["+refs/tags/my-tag:refs/tags/my-tag"]);
	});

	it("sha + refs/tags/ with fetchTags", () => {
		assert.deepStrictEqual(refSpec("refs/tags/my-tag", commit, true), ["+refs/tags/*:refs/tags/*"]);
	});

	it("sha + refs/heads/ with fetchTags", () => {
		assert.deepStrictEqual(refSpec("refs/heads/my/branch", commit, true), [
			"+refs/tags/*:refs/tags/*",
			`+${commit}:refs/remotes/origin/my/branch`,
		]);
	});

	it("sha only", () => {
		assert.deepStrictEqual(refSpec("", commit, false), [commit]);
	});

	it("unqualified ref only", () => {
		assert.deepStrictEqual(refSpec("my-ref", "", false), [
			"+refs/heads/my-ref*:refs/remotes/origin/my-ref*",
			"+refs/tags/my-ref*:refs/tags/my-ref*",
		]);
	});

	it("unqualified ref only with fetchTags", () => {
		assert.deepStrictEqual(refSpec("my-ref", "", true), [
			"+refs/tags/*:refs/tags/*",
			"+refs/heads/my-ref*:refs/remotes/origin/my-ref*",
		]);
	});

	it("refs/heads/ only", () => {
		assert.deepStrictEqual(refSpec("refs/heads/my/branch", "", false), [
			"+refs/heads/my/branch:refs/remotes/origin/my/branch",
		]);
	});

	it("refs/pull/ only", () => {
		assert.deepStrictEqual(refSpec("refs/pull/123/merge", "", false), [
			"+refs/pull/123/merge:refs/remotes/pull/123/merge",
		]);
	});

	it("refs/tags/ only", () => {
		assert.deepStrictEqual(refSpec("refs/tags/my-tag", "", false), ["+refs/tags/my-tag:refs/tags/my-tag"]);
	});

	it("refs/tags/ only with fetchTags", () => {
		assert.deepStrictEqual(refSpec("refs/tags/my-tag", "", true), ["+refs/tags/*:refs/tags/*"]);
	});

	it("refs/heads/ only with fetchTags", () => {
		assert.deepStrictEqual(refSpec("refs/heads/my/branch", "", true), [
			"+refs/tags/*:refs/tags/*",
			"+refs/heads/my/branch:refs/remotes/origin/my/branch",
		]);
	});

	it("other refs", () => {
		assert.deepStrictEqual(refSpec("refs/gh/queue/x", "", false), ["+refs/gh/queue/x:refs/gh/queue/x"]);
	});
});

describe("refSpecForAllHistory", () => {
	it("is heads and tags for a branch", () => {
		assert.deepStrictEqual(refSpecForAllHistory("refs/heads/main", commit), [
			"+refs/heads/*:refs/remotes/origin/*",
			"+refs/tags/*:refs/tags/*",
		]);
	});

	it("adds the pull ref, by commit when there is one", () => {
		assert.deepStrictEqual(refSpecForAllHistory("refs/pull/1/merge", commit), [
			"+refs/heads/*:refs/remotes/origin/*",
			"+refs/tags/*:refs/tags/*",
			`+${commit}:refs/remotes/pull/1/merge`,
		]);
		assert.deepStrictEqual(
			refSpecForAllHistory("refs/pull/1/merge", "").at(-1),
			"+refs/pull/1/merge:refs/remotes/pull/1/merge",
		);
	});
});

describe("testRef", () => {
	const git = (over: Partial<Record<string, unknown>>) => ({
		shaExists: () => Effect.succeed(false),
		branchExists: () => Effect.succeed(false),
		revParse: () => Effect.succeed(""),
		tagExists: () => Effect.succeed(false),
		...over,
	});
	const run = (l: object, ref: string, sha: string) => Effect.runPromise(testRef(l as never, ref, sha));

	it("is true with no commit", async () => {
		assert.isTrue(await run(git({}), "refs/heads/x", ""));
	});

	it("tests sha existence for a bare commit", async () => {
		assert.isTrue(await run(git({ shaExists: () => Effect.succeed(true) }), "", commit));
		assert.isFalse(await run(git({}), "", commit));
	});

	it("checks a branch's remote tip", async () => {
		const seen: Array<string> = [];
		const l = git({
			branchExists: () => Effect.succeed(true),
			revParse: (r: string) =>
				Effect.sync(() => {
					seen.push(r);
					return commit;
				}),
		});
		assert.isTrue(await run(l, "refs/heads/my/branch", commit));
		assert.deepStrictEqual(seen, ["refs/remotes/origin/my/branch"]);
		assert.isFalse(await run({ ...l, revParse: () => Effect.succeed("other") }, "refs/heads/my/branch", commit));
		assert.isFalse(await run({ ...l, branchExists: () => Effect.succeed(false) }, "refs/heads/my/branch", commit));
	});

	it("assumes a pull ref matches", async () => {
		assert.isTrue(await run(git({}), "refs/pull/1/merge", commit));
	});

	it("dereferences a tag to its commit", async () => {
		const seen: Array<string> = [];
		const l = git({
			tagExists: () => Effect.succeed(true),
			revParse: (r: string) =>
				Effect.sync(() => {
					seen.push(r);
					return commit;
				}),
		});
		assert.isTrue(await run(l, "refs/tags/v1", commit));
		assert.deepStrictEqual(seen, ["refs/tags/v1^{commit}"]);
		assert.isFalse(await run({ ...l, tagExists: () => Effect.succeed(false) }, "refs/tags/v1", commit));
	});

	it("is true for an unexpected ref shape", async () => {
		assert.isTrue(await run(git({}), "refs/gh/x", commit));
	});
});

describe("url helpers", () => {
	const settings = (over: object) => ({
		owner: "some-owner",
		name: "some repo",
		serverUrl: "https://github.com",
		auth: { _tag: "Token" },
		...over,
	});

	it("serverOrigin is scheme, host and port", () => {
		assert.strictEqual(serverOrigin("https://contoso.com/a/b"), "https://contoso.com");
		assert.strictEqual(serverOrigin("http://contoso.com:8080"), "http://contoso.com:8080");
		assert.strictEqual(serverOrigin("https://GitHub.com"), "https://github.com");
	});

	it("fetchUrl is the encoded https url", () => {
		assert.strictEqual(fetchUrl(settings({}) as never), "https://github.com/some-owner/some%20repo");
		assert.strictEqual(
			fetchUrl(settings({ serverUrl: "https://contoso.com/a/b" }) as never),
			"https://contoso.com/some-owner/some%20repo",
		);
	});

	it("fetchUrl is scp-like for ssh, user defaulting to git", () => {
		const ssh = { _tag: "Ssh", key: "k" };
		assert.strictEqual(fetchUrl(settings({ auth: ssh }) as never), "git@github.com:some-owner/some%20repo.git");
		assert.strictEqual(
			fetchUrl(settings({ auth: { ...ssh, user: "bob" } }) as never),
			"bob@github.com:some-owner/some%20repo.git",
		);
		assert.strictEqual(
			fetchUrl(settings({ auth: { ...ssh, user: "" } }) as never),
			"git@github.com:some-owner/some%20repo.git",
		);
	});
});

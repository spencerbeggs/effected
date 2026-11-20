import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Path, Redacted } from "effect";
import { ActionEnvironment } from "../../src/ActionEnvironment.js";
import { ActionInput } from "../../src/ActionInput.js";
import { ActionOutputs } from "../../src/ActionOutputs.js";
import type { CheckoutOptions } from "../../src/Checkout.js";
import { Checkout, CheckoutResult, CheckoutUnsafePullRequestError } from "../../src/Checkout.js";
import { lower } from "../../src/internal/checkout/settings.js";

const SHA40 = "a".repeat(40);
const TOKEN = { token: "ghs_x" };

const read = (inputs: Record<string, string>, options?: { prefix?: string }, env: Record<string, string> = {}) =>
	Checkout.fromInputs(options).pipe(
		Effect.provide(Layer.mergeAll(ActionInput.layer({ ...TOKEN, ...inputs }), ActionEnvironment.layerTest(env))),
	);

const run = (inputs: Record<string, string>, options?: { prefix?: string }, env?: Record<string, string>) =>
	Effect.runPromise(read(inputs, options, env));

describe("Checkout.fromInputs", () => {
	it("an empty record for the workflow's own repository is the default self-checkout", async () => {
		const o = await run({});
		assert.deepStrictEqual(o.ref, { _tag: "Event" });
		assert.strictEqual(o.credentials, "job");
		assert.strictEqual(o.depth, 1);
		assert.deepStrictEqual(o.repository, { owner: "acme", name: "example" });
		assert.strictEqual(o.auth._tag, "Token");
		assert.strictEqual(o.clean, true);
		assert.strictEqual(o.lfs, false);
		assert.strictEqual(o.fetchTags, false);
		assert.strictEqual(o.submodules, false);
		assert.strictEqual(o.safeDirectory, true);
		assert.strictEqual(o.allowUnsafePrCheckout, false);
		assert.isUndefined(o.sparse);
		assert.isUndefined(o.filter);
		assert.isUndefined(o.path);
		assert.isUndefined(o.serverUrl);
	});

	it("another repository with no ref defaults to the default branch", async () => {
		const o = await run({ repository: "other/thing" });
		assert.deepStrictEqual(o.ref, { _tag: "Default" });
		assert.deepStrictEqual(o.repository, { owner: "other", name: "thing" });
	});

	it("the workflow repository comparison ignores case", async () => {
		const o = await run({ repository: "ACME/Example" });
		assert.deepStrictEqual(o.ref, { _tag: "Event" });
	});

	it("an invalid repository fails", async () => {
		const exit = await Effect.runPromiseExit(read({ repository: "nope" }));
		assert.strictEqual(exit._tag, "Failure");
	});

	it("a 40 hex ref is a Commit", async () => {
		const o = await run({ ref: SHA40 });
		assert.deepStrictEqual(o.ref, { _tag: "Commit", sha: SHA40 });
	});

	it("a 64 hex ref is a Commit", async () => {
		const o = await run({ ref: "b".repeat(64) });
		assert.deepStrictEqual(o.ref, { _tag: "Commit", sha: "b".repeat(64) });
	});

	it("ASCII whitespace around a sha is trimmed", async () => {
		const o = await run({ ref: ` \t${SHA40}\n` });
		assert.deepStrictEqual(o.ref, { _tag: "Commit", sha: SHA40 });
	});

	it("a branch name is a Ref", async () => {
		const o = await run({ ref: "refs/heads/feature" });
		assert.deepStrictEqual(o.ref, { _tag: "Ref", ref: "refs/heads/feature" });
	});

	it("a leading BOM survives, so the ref is a Ref rather than a Commit", async () => {
		const o = await run({ ref: `﻿${SHA40}` });
		assert.deepStrictEqual(o.ref, { _tag: "Ref", ref: `﻿${SHA40}` });
	});

	it("a leading NBSP survives", async () => {
		const o = await run({ ref: ` ${SHA40}` });
		assert.strictEqual(o.ref?._tag, "Ref");
	});

	it("under a fork pull_request_target payload, a sha is refused as a Commit and a BOM ref is a Ref lower still refuses for the fork", async () => {
		const forkPayload = {
			repository: { id: 100 },
			pull_request: { head: { sha: SHA40, repo: { id: 200, full_name: "fork/example" } } },
		};
		const env = { GITHUB_EVENT_NAME: "pull_request_target" };
		const github = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* ActionEnvironment).github;
			}).pipe(Effect.provide(ActionEnvironment.layerTest(env))),
		);
		const refuse = (options: CheckoutOptions) =>
			Effect.runPromise(
				Effect.flip(lower(options, { github, workspace: "/workspace", payload: forkPayload })).pipe(
					Effect.provide(Path.layer),
				),
			);

		const plain = await run({ ref: SHA40 }, undefined, env);
		assert.strictEqual(plain.ref?._tag, "Commit");
		assert.instanceOf(await refuse(plain), CheckoutUnsafePullRequestError);

		const bom = await run({ ref: `\uFEFF${SHA40}`, repository: "fork/example" }, undefined, env);
		assert.strictEqual(bom.ref?._tag, "Ref");
		assert.instanceOf(await refuse(bom), CheckoutUnsafePullRequestError);
	});

	it("fetch-depth 0, negative and non-numeric are full; a number is that depth", async () => {
		assert.strictEqual((await run({ "fetch-depth": "0" })).depth, "full");
		assert.strictEqual((await run({ "fetch-depth": "-3" })).depth, "full");
		assert.strictEqual((await run({ "fetch-depth": "abc" })).depth, "full");
		assert.strictEqual((await run({ "fetch-depth": "5" })).depth, 5);
	});

	it("submodules is recursive, true or false, case-insensitively", async () => {
		assert.strictEqual((await run({ submodules: "RECURSIVE" })).submodules, "recursive");
		assert.strictEqual((await run({ submodules: "true" })).submodules, true);
		assert.strictEqual((await run({ submodules: "false" })).submodules, false);
		assert.strictEqual((await run({ submodules: "nonsense" })).submodules, false);
	});

	it("persist-credentials maps true to job and false to none", async () => {
		assert.strictEqual((await run({ "persist-credentials": "true" })).credentials, "job");
		assert.strictEqual((await run({ "persist-credentials": "false" })).credentials, "none");
	});

	it("a present but malformed boolean fails rather than defaulting", async () => {
		for (const name of ["clean", "lfs", "fetch-tags", "persist-credentials", "set-safe-directory"]) {
			const exit = await Effect.runPromiseExit(read({ [name]: "yes" }));
			assert.strictEqual(exit._tag, "Failure", name);
		}
	});

	it("sparse-checkout is multiline, with cone mode defaulting true", async () => {
		const o = await run({ "sparse-checkout": "src\n  docs\n\n" });
		assert.deepStrictEqual(o.sparse, { patterns: ["src", "docs"], cone: true });
		const n = await run({ "sparse-checkout": "src", "sparse-checkout-cone-mode": "false" });
		assert.deepStrictEqual(n.sparse, { patterns: ["src"], cone: false });
	});

	it("filter, path, server url and the flags are carried", async () => {
		const o = await run({
			filter: "blob:none",
			path: "sub/dir",
			"github-server-url": "https://ghe.example.com",
			clean: "false",
			lfs: "true",
			"fetch-tags": "true",
			"set-safe-directory": "false",
			"allow-unsafe-pr-checkout": "true",
			"show-progress": "false",
		});
		assert.strictEqual(o.filter, "blob:none");
		assert.strictEqual(o.path, "sub/dir");
		assert.strictEqual(o.serverUrl, "https://ghe.example.com");
		assert.strictEqual(o.clean, false);
		assert.strictEqual(o.lfs, true);
		assert.strictEqual(o.fetchTags, true);
		assert.strictEqual(o.safeDirectory, false);
		assert.strictEqual(o.allowUnsafePrCheckout, true);
	});

	it("token maps to Token auth", async () => {
		const o = await run({});
		assert.strictEqual(o.auth._tag, "Token");
		if (o.auth._tag === "Token") assert.strictEqual(Redacted.value(o.auth.token), "ghs_x");
	});

	it("a missing token fails", async () => {
		const exit = await Effect.runPromiseExit(
			Checkout.fromInputs().pipe(Effect.provide(Layer.mergeAll(ActionInput.layer({}), ActionEnvironment.layerTest()))),
		);
		assert.strictEqual(exit._tag, "Failure");
	});

	it("an ssh-key maps to Ssh auth carrying the token too", async () => {
		const o = await run({ "ssh-key": "KEY", "ssh-known-hosts": "h", "ssh-strict": "false", "ssh-user": "deploy" });
		assert.strictEqual(o.auth._tag, "Ssh");
		if (o.auth._tag === "Ssh") {
			assert.strictEqual(Redacted.value(o.auth.key), "KEY");
			assert.strictEqual(o.auth.knownHosts, "h");
			assert.strictEqual(o.auth.strict, false);
			assert.strictEqual(o.auth.user, "deploy");
			assert.strictEqual(Redacted.value(o.auth.token as Redacted.Redacted<string>), "ghs_x");
		}
	});

	it("a prefix reads every input as <prefix><name>", async () => {
		const o = await run(
			{ "checkout-ref": SHA40, "checkout-token": "pt", "checkout-fetch-depth": "0", token: "wrong", ref: "wrong" },
			{ prefix: "checkout-" },
		);
		assert.deepStrictEqual(o.ref, { _tag: "Commit", sha: SHA40 });
		assert.strictEqual(o.depth, "full");
		if (o.auth._tag === "Token") assert.strictEqual(Redacted.value(o.auth.token), "pt");
	});

	it("reads INPUT_CHECKOUT-REF from the runner environment under a prefix", async () => {
		const o = await Effect.runPromise(
			Checkout.fromInputs({ prefix: "checkout-" }).pipe(
				Effect.provide(
					Layer.mergeAll(
						ActionInput.layer({ "INPUT_CHECKOUT-TOKEN": "t", "INPUT_CHECKOUT-REF": SHA40 }),
						ActionEnvironment.layerTest(),
					),
				),
			),
		);
		assert.deepStrictEqual(o.ref, { _tag: "Commit", sha: SHA40 });
	});
});

describe("Checkout.inputs", () => {
	const NAMES = [
		"repository",
		"ref",
		"token",
		"ssh-key",
		"ssh-known-hosts",
		"ssh-strict",
		"ssh-user",
		"persist-credentials",
		"path",
		"clean",
		"filter",
		"sparse-checkout",
		"sparse-checkout-cone-mode",
		"fetch-depth",
		"fetch-tags",
		"show-progress",
		"lfs",
		"submodules",
		"set-safe-directory",
		"github-server-url",
		"allow-unsafe-pr-checkout",
	];

	it("declares exactly the 21 names", () => {
		assert.deepStrictEqual(Object.keys(Checkout.inputs()).sort(), [...NAMES].sort());
	});

	it("prefixes each name", () => {
		assert.deepStrictEqual(
			Object.keys(Checkout.inputs({ prefix: "checkout-" })).sort(),
			NAMES.map((n) => `checkout-${n}`).sort(),
		);
	});

	it("carries checkout's defaults and descriptions", () => {
		const i = Checkout.inputs();
		assert.strictEqual(i.token?.default, "${{ github.token }}");
		assert.strictEqual(i.repository?.default, "${{ github.repository }}");
		assert.strictEqual(i["persist-credentials"]?.default, "true");
		assert.strictEqual(i["fetch-depth"]?.default, "1");
		assert.strictEqual(i["ssh-user"]?.default, "git");
		assert.strictEqual(i.submodules?.default, "false");
		assert.strictEqual(i.path?.description, "Relative path under $GITHUB_WORKSPACE to place the repository");
		assert.isUndefined(i.ref?.default);
		for (const name of NAMES) assert.isString(i[name]?.description, name);
	});
});

describe("Checkout.writeOutputs", () => {
	const result = CheckoutResult.make({
		ref: "refs/heads/main",
		commit: SHA40,
		path: "/workspace",
		repository: { owner: "a", name: "b" },
	});

	it("sets ref and commit", async () => {
		const rec = ActionOutputs.recording();
		await Effect.runPromise(Checkout.writeOutputs(result).pipe(Effect.provide(rec.layer)));
		assert.deepStrictEqual(
			rec.entries().map((e) => [e.member, e.name, e.value]),
			[
				["set", "ref", "refs/heads/main"],
				["set", "commit", SHA40],
			],
		);
	});

	it("prefixes the output names", async () => {
		const rec = ActionOutputs.recording();
		await Effect.runPromise(Checkout.writeOutputs(result, { prefix: "checkout-" }).pipe(Effect.provide(rec.layer)));
		assert.deepStrictEqual(
			rec.entries().map((e) => e.name),
			["checkout-ref", "checkout-commit"],
		);
	});
});

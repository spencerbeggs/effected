// The step log a checkout writes: its structure through the recording double,
// and, for a failed fetch, the rendered text through the real logger, which
// must show the transcript and never the token.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { GitHubClient, GitHubError } from "@effected/github";
import { Effect, Layer, Redacted, Schedule } from "effect";
import { Base64 } from "effect/encoding";
import { TestConsole } from "effect/testing";
import { ActionEnvironment } from "../../src/ActionEnvironment.js";
import type { StepLogEntry } from "../../src/ActionLogger.js";
import { ActionLogger } from "../../src/ActionLogger.js";
import { ActionOutputs } from "../../src/ActionOutputs.js";
import { ActionState } from "../../src/ActionState.js";
import type { CheckoutOptions } from "../../src/Checkout.js";
import { Checkout } from "../../src/Checkout.js";
import { CheckoutApiClient, CheckoutRetry } from "../../src/internal/checkout/source.js";

const TOKEN = "ghs_0123456789abcdefTOKEN";
const BASIC = Base64.encode(`x-access-token:${TOKEN}`);
const FIXTURE_ENV = { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" };

const fixtureGit = (cwd: string, args: ReadonlyArray<string>): string =>
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], {
		cwd,
		env: FIXTURE_ENV,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();

let root: string;
let url: string;

beforeAll(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "checkout-log-")));
	const work = join(root, "work");
	await mkdir(work, { recursive: true });
	fixtureGit(work, ["init", "-q"]);
	await writeFile(join(work, "a.txt"), "a\n");
	fixtureGit(work, ["add", "a.txt"]);
	fixtureGit(work, ["commit", "-q", "-m", "the subject"]);
	fixtureGit(root, ["clone", "-q", "--bare", work, join(root, "remote.git")]);
	url = `file://${join(root, "remote.git")}`;
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

let counter = 0;
const env = () => {
	counter += 1;
	const base = join(root, `run-${counter}`);
	return {
		RUNNER_TEMP: join(base, "temp"),
		GITHUB_WORKSPACE: join(base, "ws"),
		HOME: join(base, "home"),
		GITHUB_REPOSITORY: "own/repo",
		GITHUB_REPOSITORY_OWNER: "own",
		RUNNER_OS: process.platform === "win32" ? "Windows" : "Linux",
	};
};

const services = (vars: Readonly<Record<string, string>>) =>
	Layer.mergeAll(
		Git.layer,
		ActionEnvironment.layerTest(vars, {}),
		ActionOutputs.recording().layer,
		ActionState.layerTest({ save: () => Effect.void }),
		// The client a checkout builds from its token: the object format lookup answers 404, and nothing reaches the network.
		Layer.succeed(CheckoutApiClient, () =>
			Effect.succeed(
				GitHubClient.makeTest({
					requestDecoded: () => Effect.fail(GitHubError.notFound("hash-algorithm", "the repository")),
				}),
			),
		),
		NodeCrypto.layerSecureRandom,
	).pipe(Layer.provideMerge(NodeServices.layer));

const options = (over: Partial<CheckoutOptions> = {}): CheckoutOptions => ({
	repository: { owner: "own", name: "repo" },
	ref: { _tag: "Branch", name: "main" },
	path: "repo",
	auth: { _tag: "Token", token: Redacted.make(TOKEN) },
	remoteUrl: url,
	...over,
});

const prepare = (vars: Readonly<Record<string, string>>) =>
	Effect.promise(async () => {
		for (const dir of [vars.RUNNER_TEMP, vars.GITHUB_WORKSPACE, vars.HOME]) {
			await mkdir(dir as string, { recursive: true });
		}
	});

const steps = (entries: ReadonlyArray<StepLogEntry>) =>
	entries.filter((entry): entry is Extract<StepLogEntry, { kind: "step" }> => entry.kind === "step");

describe("the checkout step log", () => {
	it.live("records one phase and a green step per phase of work", () =>
		Effect.gen(function* () {
			const vars = env();
			yield* prepare(vars);
			const recording = ActionLogger.recording();
			yield* Effect.scoped(Checkout.checkout(options())).pipe(
				Effect.provideService(CheckoutRetry, Schedule.recurs(0)),
				Effect.provide(Layer.merge(services(vars), recording.layer)),
			);
			const entries = recording.entries();
			assert.deepStrictEqual(entries[0], { kind: "phase", title: "Checkout own/repo @ main" });
			const recorded = steps(entries);
			assert.strictEqual(recorded.length, entries.length - 1, "nothing outside the phase's steps");
			for (const step of recorded) assert.strictEqual(step.outcome, "success", step.summary);
			const summaries = recorded.map((step) => step.summary);
			assert.match(summaries[0] ?? "", /^git \d+\.\d+\.\d+ · fresh clone$/);
			assert.match(summaries[1] ?? "", /^fetched [0-9a-f]{7} · depth 1$/);
			assert.match(summaries[2] ?? "", /^checked out [0-9a-f]{7} \(main\) "the subject"$/);
			assert.strictEqual(summaries[3], "credentials kept for the job");
			assert.strictEqual(summaries.length, 4);
			assert.deepStrictEqual(recorded[3]?.detail, []);
			// The git transcript is each step's detail.
			assert.isTrue(recorded[1]?.detail.some((line) => line.includes(" fetch ")));
		}),
	);

	it.live("records a red fetch step whose detail holds the fetch argv and git's stderr", () =>
		Effect.gen(function* () {
			const vars = env();
			yield* prepare(vars);
			const recording = ActionLogger.recording();
			yield* Effect.scoped(Checkout.checkout(options({ ref: { _tag: "Branch", name: "missing" } }))).pipe(
				Effect.provideService(CheckoutRetry, Schedule.recurs(0)),
				Effect.provide(Layer.merge(services(vars), recording.layer)),
				Effect.flip,
			);
			const failed = steps(recording.entries()).find((step) => step.outcome === "failure");
			assert.isDefined(failed);
			assert.strictEqual(failed?.summary, "fetch failed · branch or tag 'missing' not found");
			const detail = failed?.detail.join("\n") ?? "";
			assert.match(detail, /git -c protocol\.version=2 fetch .*refs\/heads\/missing/);
			assert.include(detail, "couldn't find remote ref");
		}),
	);

	it.effect("renders the failing transcript through the real logger without the token", () =>
		Effect.gen(function* () {
			const vars = env();
			yield* prepare(vars);
			const failure = yield* Effect.scoped(
				Checkout.checkout(options({ ref: { _tag: "Branch", name: "missing" } })),
			).pipe(
				Effect.provideService(CheckoutRetry, Schedule.recurs(0)),
				Effect.provide(
					Layer.mergeAll(
						services(vars),
						ActionLogger.layer.pipe(Layer.provide(ActionEnvironment.layerTest(vars, {}))),
						ActionLogger.layerLogger,
					),
				),
				Effect.flip,
			);
			assert.strictEqual(failure._tag, "CheckoutRefNotFoundError");
			const output = (yield* TestConsole.logLines).map(String).join("\n");
			assert.include(output, "fetch failed · branch or tag 'missing' not found");
			assert.include(output, "couldn't find remote ref");
			assert.match(output, /git -c protocol\.version=2 fetch /);
			assert.notInclude(output, TOKEN);
			assert.notInclude(output, BASIC);
			const errors = (yield* TestConsole.errorLines).map(String).join("\n");
			assert.notInclude(errors, TOKEN);
			assert.notInclude(errors, BASIC);
		}),
	);
});

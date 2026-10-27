import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import type { CiName } from "../src/CiName.js";
import type { CiProvider } from "../src/internal/ci.js";
import {
	PROVIDERS,
	ciCoordinateKeys,
	ciDetectKeys,
	ciNames,
	detectCi as detectCiRaw,
	detectCiRun as detectCiRunRaw,
	providerOf,
} from "../src/internal/ci.js";
import { normalizeEnv } from "../src/internal/envRecord.js";

// The detectors take a normalized record (an empty value is absent): `readEnv` and `RuntimeEnv.fromRecord` guarantee it.
const detectCi = (env: Record<string, string | undefined>) => detectCiRaw(normalizeEnv(env));
const detectCiRun = (env: Record<string, string | undefined>) => detectCiRunRaw(normalizeEnv(env));

// std-env 4.3.0's provider table (dist/index.mjs), transcribed row by row in its declared order: [std-env name, the
// variable std-env tests, the CiName this package reports, or null where the row is deliberately left out].
const STD_ENV: ReadonlyArray<readonly [string, string, CiName | null]> = [
	["APPVEYOR", "APPVEYOR", "appveyor"],
	["AWS_AMPLIFY", "AWS_APP_ID", "aws-amplify"],
	["AZURE_PIPELINES", "SYSTEM_TEAMFOUNDATIONCOLLECTIONURI", "azure-pipelines"],
	["AZURE_STATIC", "INPUT_AZURE_STATIC_WEB_APPS_API_TOKEN", "azure-static"],
	["APPCIRCLE", "AC_APPCIRCLE", "appcircle"],
	["BAMBOO", "bamboo_planKey", "bamboo"],
	["BITBUCKET", "BITBUCKET_COMMIT", "bitbucket"],
	["BITRISE", "BITRISE_IO", "bitrise"],
	["BUDDY", "BUDDY_WORKSPACE_ID", "buddy"],
	["BUILDKITE", "BUILDKITE", "buildkite"],
	["CIRCLE", "CIRCLECI", "circleci"],
	["CIRRUS", "CIRRUS_CI", "cirrus"],
	["CLOUDFLARE_PAGES", "CF_PAGES", "cloudflare-pages"],
	["CLOUDFLARE_WORKERS", "WORKERS_CI", "cloudflare-workers"],
	["GOOGLE_CLOUDRUN", "K_SERVICE", null],
	["GOOGLE_CLOUDRUN_JOB", "CLOUD_RUN_JOB", null],
	["CODEBUILD", "CODEBUILD_BUILD_ARN", "codebuild"],
	["CODEFRESH", "CF_BUILD_ID", "codefresh"],
	["DRONE", "DRONE", "drone"],
	["DRONE", "DRONE_BUILD_EVENT", "drone"],
	["DSARI", "DSARI", "dsari"],
	["GITHUB_ACTIONS", "GITHUB_ACTIONS", "github-actions"],
	["GITLAB", "GITLAB_CI", "gitlab"],
	["GITLAB", "CI_MERGE_REQUEST_ID", "gitlab"],
	["GOCD", "GO_PIPELINE_LABEL", "gocd"],
	["LAYERCI", "LAYERCI", "layerci"],
	["JENKINS", "JENKINS_URL", "jenkins"],
	["HUDSON", "HUDSON_URL", "hudson"],
	["MAGNUM", "MAGNUM", "magnum"],
	["NETLIFY", "NETLIFY", "netlify"],
	["NETLIFY", "NETLIFY_LOCAL", null],
	["NEVERCODE", "NEVERCODE", "nevercode"],
	["RENDER", "RENDER", null],
	["SAIL", "SAILCI", "sail"],
	["SEMAPHORE", "SEMAPHORE", "semaphore"],
	["SCREWDRIVER", "SCREWDRIVER", "screwdriver"],
	["SHIPPABLE", "SHIPPABLE", "shippable"],
	["SOLANO", "TDDIUM", "solano"],
	["STRIDER", "STRIDER", "strider"],
	["TEAMCITY", "TEAMCITY_VERSION", "teamcity"],
	["TRAVIS", "TRAVIS", "travis"],
	["VERCEL", "NOW_BUILDER", "vercel"],
	["VERCEL", "VERCEL", null],
	["VERCEL", "VERCEL_ENV", null],
	["APPCENTER", "APPCENTER_BUILD_ID", "appcenter"],
	["CODESANDBOX", "CODESANDBOX_SSE", null],
	["CODESANDBOX", "CODESANDBOX_HOST", null],
	["STACKBLITZ", "STACKBLITZ", null],
	["STORMKIT", "STORMKIT", null],
	["CLEAVR", "CLEAVR", "cleavr"],
	["ZEABUR", "ZEABUR", null],
	["CODESPHERE", "CODESPHERE_APP_ID", null],
	["RAILWAY", "RAILWAY_PROJECT_ID", null],
	["RAILWAY", "RAILWAY_SERVICE_ID", null],
	["DENO-DEPLOY", "DENO_DEPLOY", null],
	["DENO-DEPLOY", "DENO_DEPLOYMENT_ID", null],
	["FIREBASE_APP_HOSTING", "FIREBASE_APP_HOSTING", null],
	["EDGEONE_PAGES", "EO_PAGES_CI", "edgeone-pages"],
];

describe("detectCi against std-env 4.3.0's provider table", () => {
	for (const [row, variable, expected] of STD_ENV) {
		if (expected === null) {
			it(`${row} (${variable}) is left out: not a CI on its own`, () =>
				assert.deepStrictEqual(detectCi({ [variable]: "1" }), Option.none()));
			it(`${row} (${variable}) under CI=true is generic`, () =>
				assert.deepStrictEqual(detectCi({ [variable]: "1", CI: "true" }), Option.some("generic")));
		} else {
			it(`${row} (${variable}) → ${expected}`, () =>
				assert.deepStrictEqual(detectCi({ [variable]: "1" }), Option.some(expected)));
		}
	}

	it("names exactly the table's included rows plus generic, with no extra provider", () => {
		const included = new Set(STD_ENV.flatMap(([, , name]) => (name === null ? [] : [name])));
		assert.deepStrictEqual(new Set(ciNames), new Set([...included, "generic"]));
	});

	it("the CiName union and the decoded literal set agree (exhaustive record over the type)", () => {
		const all: Record<CiName, true> = Object.fromEntries(ciNames.map((name) => [name, true])) as Record<CiName, true>;
		const fromType: ReadonlyArray<CiName> = Object.keys({
			"github-actions": 1,
			appveyor: 1,
			"aws-amplify": 1,
			"azure-pipelines": 1,
			"azure-static": 1,
			appcircle: 1,
			bamboo: 1,
			bitbucket: 1,
			bitrise: 1,
			buddy: 1,
			buildkite: 1,
			circleci: 1,
			cirrus: 1,
			"cloudflare-pages": 1,
			"cloudflare-workers": 1,
			codebuild: 1,
			codefresh: 1,
			drone: 1,
			dsari: 1,
			gitlab: 1,
			gocd: 1,
			layerci: 1,
			jenkins: 1,
			hudson: 1,
			magnum: 1,
			netlify: 1,
			nevercode: 1,
			sail: 1,
			semaphore: 1,
			screwdriver: 1,
			shippable: 1,
			solano: 1,
			strider: 1,
			teamcity: 1,
			travis: 1,
			vercel: 1,
			appcenter: 1,
			cleavr: 1,
			"edgeone-pages": 1,
			generic: 1,
		} satisfies Record<CiName, 1>) as ReadonlyArray<CiName>;
		assert.deepStrictEqual(new Set(Object.keys(all)), new Set(fromType));
	});

	// std-env tests one variable per row, with no second condition: JENKINS_URL alone is Jenkins there, so it is here.
	// A developer shell exporting JENKINS_URL therefore reads as CI, exactly as under std-env.
	it("JENKINS_URL alone is jenkins, as in std-env (no BUILD_ID required)", () =>
		assert.deepStrictEqual(detectCi({ JENKINS_URL: "https://ci.example" }), Option.some("jenkins")));
	it("GitHub Actions wins over every other provider signal, as it always has", () =>
		assert.deepStrictEqual(detectCi({ APPVEYOR: "1", GITHUB_ACTIONS: "true" }), Option.some("github-actions")));
	it("std-env's order decides between two other providers: the earlier row wins", () =>
		assert.deepStrictEqual(detectCi({ TRAVIS: "true", BUILDKITE: "true" }), Option.some("buildkite")));
	it("a provider signal wins even under CI=false", () => {
		assert.deepStrictEqual(detectCi({ GITHUB_ACTIONS: "true", CI: "false" }), Option.some("github-actions"));
		assert.deepStrictEqual(detectCi({ GITLAB_CI: "true", CI: "false" }), Option.some("gitlab"));
	});
	for (const v of ["true", "1", "yes", "anything"]) {
		it(`CI=${v} → generic`, () => assert.deepStrictEqual(detectCi({ CI: v }), Option.some("generic")));
		it(`CONTINUOUS_INTEGRATION=${v} → generic`, () =>
			assert.deepStrictEqual(detectCi({ CONTINUOUS_INTEGRATION: v }), Option.some("generic")));
	}
	// Departure from std-env 4.3.0, which tests `!!env.CI` (so `CI=false` is CI there): the falsy spellings mean not CI,
	// for CI and for a provider's marker alike, because users set `CI=false` to get interactive output back.
	for (const v of ["false", "0", "FALSE", "off", "No"]) {
		it(`CI=${JSON.stringify(v)} → none`, () => assert.deepStrictEqual(detectCi({ CI: v }), Option.none()));
		it(`CONTINUOUS_INTEGRATION=${JSON.stringify(v)} → none`, () =>
			assert.deepStrictEqual(detectCi({ CONTINUOUS_INTEGRATION: v }), Option.none()));
		it(`GITHUB_ACTIONS=${JSON.stringify(v)} is not github-actions`, () =>
			assert.deepStrictEqual(detectCi({ GITHUB_ACTIONS: v }), Option.none()));
		it(`TRAVIS=${JSON.stringify(v)} is not travis, and CI=true is then generic`, () =>
			assert.deepStrictEqual(detectCi({ TRAVIS: v, CI: "true" }), Option.some("generic")));
	}
	it(`CI="" → none`, () => assert.deepStrictEqual(detectCi({ CI: "" }), Option.none()));
	it("nothing set → none", () => assert.deepStrictEqual(detectCi({}), Option.none()));
});

// Each provider's documented run variables, written out here rather than read from the source table.
describe("detectCiRun", () => {
	const none = Option.none();
	it("GitHub Actions: GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_JOB, GITHUB_SHA, GITHUB_REF_NAME, RUNNER_OS/ARCH", () =>
		assert.deepStrictEqual(
			detectCiRun({
				GITHUB_ACTIONS: "true",
				GITHUB_RUN_ID: "123",
				GITHUB_RUN_ATTEMPT: "2",
				GITHUB_JOB: "test",
				GITHUB_SHA: "abc",
				GITHUB_REF_NAME: "main",
				RUNNER_OS: "Linux",
				RUNNER_ARCH: "X64",
			}),
			Option.some({
				runId: Option.some("123"),
				attempt: Option.some("2"),
				jobId: Option.some("test"),
				sha: Option.some("abc"),
				refName: Option.some("main"),
				runner: Option.some({ os: "Linux", arch: Option.some("X64") }),
			}),
		));
	it("GitLab: CI_PIPELINE_ID, CI_JOB_ID, CI_COMMIT_SHA, CI_COMMIT_REF_NAME", () =>
		assert.deepStrictEqual(
			detectCiRun({
				GITLAB_CI: "true",
				CI_PIPELINE_ID: "9",
				CI_JOB_ID: "77",
				CI_COMMIT_SHA: "def",
				CI_COMMIT_REF_NAME: "feat",
			}),
			Option.some({
				runId: Option.some("9"),
				attempt: none,
				jobId: Option.some("77"),
				sha: Option.some("def"),
				refName: Option.some("feat"),
				runner: none,
			}),
		));
	it("Buildkite: BUILDKITE_BUILD_ID, BUILDKITE_RETRY_COUNT, BUILDKITE_JOB_ID, BUILDKITE_COMMIT, BUILDKITE_BRANCH", () =>
		assert.deepStrictEqual(
			detectCiRun({
				BUILDKITE: "true",
				BUILDKITE_BUILD_ID: "b",
				BUILDKITE_RETRY_COUNT: "0",
				BUILDKITE_JOB_ID: "j",
				BUILDKITE_COMMIT: "c",
				BUILDKITE_BRANCH: "main",
			}),
			Option.some({
				runId: Option.some("b"),
				attempt: Option.some("0"),
				jobId: Option.some("j"),
				sha: Option.some("c"),
				refName: Option.some("main"),
				runner: none,
			}),
		));
	it("CircleCI: CIRCLE_WORKFLOW_ID, CIRCLE_BUILD_NUM, CIRCLE_SHA1, CIRCLE_BRANCH then CIRCLE_TAG", () =>
		assert.deepStrictEqual(
			detectCiRun({
				CIRCLECI: "true",
				CIRCLE_WORKFLOW_ID: "w",
				CIRCLE_BUILD_NUM: "42",
				CIRCLE_SHA1: "s",
				CIRCLE_TAG: "v1",
			}),
			Option.some({
				runId: Option.some("w"),
				attempt: none,
				jobId: Option.some("42"),
				sha: Option.some("s"),
				refName: Option.some("v1"),
				runner: none,
			}),
		));
	it("Azure Pipelines: BUILD_BUILDID, SYSTEM_JOBATTEMPT, SYSTEM_JOBID, BUILD_SOURCEVERSION, AGENT_OS", () =>
		assert.deepStrictEqual(
			detectCiRun({
				SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: "https://dev.azure.com/x/",
				BUILD_BUILDID: "5",
				SYSTEM_JOBATTEMPT: "1",
				SYSTEM_JOBID: "jid",
				BUILD_SOURCEVERSION: "sha",
				BUILD_SOURCEBRANCHNAME: "main",
				AGENT_OS: "Linux",
			}),
			Option.some({
				runId: Option.some("5"),
				attempt: Option.some("1"),
				jobId: Option.some("jid"),
				sha: Option.some("sha"),
				refName: Option.some("main"),
				runner: Option.some({ os: "Linux", arch: none }),
			}),
		));
	it("generic CI: present, every coordinate None, even when a provider's run variables happen to be set", () =>
		assert.deepStrictEqual(
			detectCiRun({ CI: "true", GITHUB_RUN_ID: "1" }),
			Option.some({ runId: none, attempt: none, jobId: none, sha: none, refName: none, runner: none }),
		));
	it("Amplify writes HEAD as the commit on a rebuild: that is no commit, so sha is None", () => {
		const sha = (value: string) =>
			Option.flatMap(detectCiRun({ AWS_APP_ID: "app", AWS_COMMIT_ID: value }), (run) => run.sha);
		assert.deepStrictEqual(sha("HEAD"), Option.none());
		// Control: a real commit id is kept.
		assert.deepStrictEqual(sha("0a1b2c3"), Option.some("0a1b2c3"));
	});
	it("Buddy: the BUDDY_RUN_* names first, the BUDDY_EXECUTION_* names as fallbacks", () => {
		const run = (env: Record<string, string>) => Option.getOrThrow(detectCiRun({ BUDDY_WORKSPACE_ID: "w", ...env }));
		const current = run({ BUDDY_RUN_ID: "r", BUDDY_RUN_COMMIT: "c", BUDDY_RUN_BRANCH: "b", BUDDY_EXECUTION_ID: "old" });
		assert.deepStrictEqual(
			[current.runId, current.sha, current.refName],
			[Option.some("r"), Option.some("c"), Option.some("b")],
		);
		const legacy = run({ BUDDY_EXECUTION_ID: "e", BUDDY_EXECUTION_REVISION: "x", BUDDY_EXECUTION_BRANCH: "y" });
		assert.deepStrictEqual(
			[legacy.runId, legacy.sha, legacy.refName],
			[Option.some("e"), Option.some("x"), Option.some("y")],
		);
	});
	it("Appcircle: the build id is AC_BUILD_NUMBER", () =>
		assert.deepStrictEqual(
			Option.flatMap(
				detectCiRun({ AC_APPCIRCLE: "true", AC_BUILD_NUMBER: "17", AC_BUILD_ID: "x" }),
				(run) => run.runId,
			),
			Option.some("17"),
		));
	it("no CI: None, even with run variables set", () =>
		assert.deepStrictEqual(detectCiRun({ GITHUB_RUN_ID: "1", GITHUB_SHA: "x" }), Option.none()));
	it("an empty coordinate reads as unset and falls through to the next variable", () =>
		assert.deepStrictEqual(
			Option.map(detectCiRun({ BITBUCKET_COMMIT: "c", BITBUCKET_BRANCH: "", BITBUCKET_TAG: "v2" }), (r) => r.refName),
			Option.some(Option.some("v2")),
		));
});

// The key lists and the table cannot drift: every variable a row names is read, detection first, coordinates after.
describe("ciDetectKeys and ciCoordinateKeys", () => {
	it("ciDetectKeys lists every detection variable, plus CI and CONTINUOUS_INTEGRATION, without duplicates", () => {
		for (const provider of PROVIDERS) for (const key of provider.detect) assert.include(ciDetectKeys, key);
		assert.include(ciDetectKeys, "CI");
		assert.include(ciDetectKeys, "CONTINUOUS_INTEGRATION");
		assert.strictEqual(new Set(ciDetectKeys).size, ciDetectKeys.length, "no duplicates");
	});
	it("ciCoordinateKeys lists exactly the matched provider's coordinate variables", () => {
		for (const provider of PROVIDERS as ReadonlyArray<CiProvider>) {
			const expected = new Set([
				...(provider.runId ?? []),
				...(provider.attempt ?? []),
				...(provider.jobId ?? []),
				...(provider.sha ?? []),
				...(provider.refName ?? []),
				...(provider.os ?? []),
				...(provider.arch ?? []),
			]);
			assert.deepStrictEqual(new Set(ciCoordinateKeys(provider)), expected, provider.name);
		}
	});
	it("a record holding only the detect keys picks the provider whose coordinates are then read", () =>
		assert.strictEqual(providerOf({ GITLAB_CI: "true" })?.name, "gitlab"));
	it("the source names an env variable only in the table or as CI / CONTINUOUS_INTEGRATION", () => {
		const source = readFileSync(fileURLToPath(new URL("../src/internal/ci.ts", import.meta.url)), "utf8");
		const reads = /(?<![\w./])env\.([A-Z][A-Za-z_]+)/g;
		// Control: the regex does see a direct read when one is written.
		assert.deepStrictEqual(
			[..."env.CI".matchAll(reads)].map((m) => m[1]),
			["CI"],
		);
		assert.deepStrictEqual(
			[...source.matchAll(reads)].map((m) => m[1]),
			[],
		);
		const named = new Set([...source.matchAll(/isSet\(env, "([A-Z_]+)"\)/g)].map((m) => m[1]));
		assert.deepStrictEqual(named, new Set(["CI", "CONTINUOUS_INTEGRATION"]));
	});
});

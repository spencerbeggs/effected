// CI detection from a pure env record. The provider set and its detection variables are transcribed from std-env
// 4.3.0 (dist/index.mjs), minus the rows std-env itself marks `ci: false` and the runtime hosts listed below; the run
// coordinates are each provider's documented build variables.
import { Option } from "effect";
import type { CiName } from "../CiName.js";
import type { Env } from "./types.js";

/**
 * One CI provider: the variables that identify it, and the variables each run coordinate is read from. Every list is
 * read in order and the first non-empty value wins.
 *
 * @internal
 */
export interface CiProvider {
	readonly name: CiName;
	readonly detect: ReadonlyArray<string>;
	readonly runId?: ReadonlyArray<string>;
	readonly attempt?: ReadonlyArray<string>;
	readonly jobId?: ReadonlyArray<string>;
	readonly sha?: ReadonlyArray<string>;
	readonly refName?: ReadonlyArray<string>;
	readonly os?: ReadonlyArray<string>;
	readonly arch?: ReadonlyArray<string>;
	/** Values of the `sha` variables that name no commit (Amplify writes `HEAD` on a rebuild): read as unset. */
	readonly shaPlaceholders?: ReadonlyArray<string>;
}

// GitHub Actions is checked before the std-env order, as it always has been here: its signal is explicit and wins even
// under CI=false. The rest follow std-env's table order, which decides between two matching rows.
//
// Left out on purpose:
// - every row std-env marks `ci: false` (VERCEL, VERCEL_ENV, NETLIFY_LOCAL, CODESANDBOX_*), which std-env does not call
//   CI either;
// - the runtime hosts, whose variable is set in the serving process as well as the build, so a production server
//   would read as CI and get CI output: GOOGLE_CLOUDRUN (K_SERVICE), GOOGLE_CLOUDRUN_JOB (CLOUD_RUN_JOB), RENDER,
//   RAILWAY_*, DENO_DEPLOY*, and STACKBLITZ, a browser development environment;
// - four hosting platforms excluded for lack of evidence that the detection variable is build-only: STORMKIT, ZEABUR,
//   CODESPHERE_APP_ID and FIREBASE_APP_HOSTING. No provider document found confines the variable to the build, and a
//   variable set in the deployed service would make every request read as CI. Under CI=true each reads as `generic`.
//
// Kept, because the provider documents the variable as build-only or lists it only for the build: NETLIFY (Netlify:
// only URL, SITE_NAME and SITE_ID reach functions at runtime), CF_PAGES and WORKERS_CI (Cloudflare: injected into the
// build), NOW_BUILDER (Vercel's legacy build-image variable; VERCEL itself, set at build and runtime, is std-env's
// ci:false row and is left out above).
const PROVIDERS: ReadonlyArray<CiProvider> = [
	{
		name: "github-actions",
		detect: ["GITHUB_ACTIONS"],
		runId: ["GITHUB_RUN_ID"],
		attempt: ["GITHUB_RUN_ATTEMPT"],
		jobId: ["GITHUB_JOB"],
		sha: ["GITHUB_SHA"],
		refName: ["GITHUB_REF_NAME"],
		os: ["RUNNER_OS"],
		arch: ["RUNNER_ARCH"],
	},
	{
		name: "appveyor",
		detect: ["APPVEYOR"],
		runId: ["APPVEYOR_BUILD_ID"],
		jobId: ["APPVEYOR_JOB_ID"],
		sha: ["APPVEYOR_REPO_COMMIT"],
		refName: ["APPVEYOR_REPO_BRANCH"],
	},
	{
		name: "aws-amplify",
		detect: ["AWS_APP_ID"],
		runId: ["AWS_JOB_ID"],
		sha: ["AWS_COMMIT_ID"],
		refName: ["AWS_BRANCH"],
		shaPlaceholders: ["HEAD"],
	},
	{
		name: "azure-pipelines",
		detect: ["SYSTEM_TEAMFOUNDATIONCOLLECTIONURI"],
		runId: ["BUILD_BUILDID"],
		attempt: ["SYSTEM_JOBATTEMPT"],
		jobId: ["SYSTEM_JOBID"],
		sha: ["BUILD_SOURCEVERSION"],
		refName: ["BUILD_SOURCEBRANCHNAME"],
		os: ["AGENT_OS"],
		arch: ["AGENT_OSARCHITECTURE"],
	},
	{ name: "azure-static", detect: ["INPUT_AZURE_STATIC_WEB_APPS_API_TOKEN"] },
	{
		name: "appcircle",
		detect: ["AC_APPCIRCLE"],
		runId: ["AC_BUILD_NUMBER"],
		sha: ["AC_GIT_COMMIT"],
		refName: ["AC_GIT_BRANCH"],
	},
	{
		name: "bamboo",
		detect: ["bamboo_planKey"],
		runId: ["bamboo_buildNumber"],
		sha: ["bamboo_planRepository_revision"],
	},
	{
		name: "bitbucket",
		detect: ["BITBUCKET_COMMIT"],
		runId: ["BITBUCKET_BUILD_NUMBER"],
		jobId: ["BITBUCKET_STEP_UUID"],
		sha: ["BITBUCKET_COMMIT"],
		refName: ["BITBUCKET_BRANCH", "BITBUCKET_TAG"],
	},
	{
		name: "bitrise",
		detect: ["BITRISE_IO"],
		runId: ["BITRISE_BUILD_SLUG"],
		sha: ["BITRISE_GIT_COMMIT"],
		refName: ["BITRISE_GIT_BRANCH"],
	},
	{
		name: "buddy",
		detect: ["BUDDY_WORKSPACE_ID"],
		runId: ["BUDDY_RUN_ID", "BUDDY_EXECUTION_ID"],
		sha: ["BUDDY_RUN_COMMIT", "BUDDY_EXECUTION_REVISION"],
		refName: ["BUDDY_RUN_BRANCH", "BUDDY_EXECUTION_BRANCH"],
	},
	{
		name: "buildkite",
		detect: ["BUILDKITE"],
		runId: ["BUILDKITE_BUILD_ID"],
		attempt: ["BUILDKITE_RETRY_COUNT"],
		jobId: ["BUILDKITE_JOB_ID"],
		sha: ["BUILDKITE_COMMIT"],
		refName: ["BUILDKITE_BRANCH"],
	},
	{
		name: "circleci",
		detect: ["CIRCLECI"],
		runId: ["CIRCLE_WORKFLOW_ID"],
		jobId: ["CIRCLE_BUILD_NUM"],
		sha: ["CIRCLE_SHA1"],
		refName: ["CIRCLE_BRANCH", "CIRCLE_TAG"],
	},
	{
		name: "cirrus",
		detect: ["CIRRUS_CI"],
		runId: ["CIRRUS_BUILD_ID"],
		jobId: ["CIRRUS_TASK_ID"],
		sha: ["CIRRUS_CHANGE_IN_REPO"],
		refName: ["CIRRUS_BRANCH", "CIRRUS_TAG"],
		os: ["CIRRUS_OS"],
		arch: ["CIRRUS_ARCH"],
	},
	{
		name: "cloudflare-pages",
		detect: ["CF_PAGES"],
		sha: ["CF_PAGES_COMMIT_SHA"],
		refName: ["CF_PAGES_BRANCH"],
	},
	{
		name: "cloudflare-workers",
		detect: ["WORKERS_CI"],
		runId: ["WORKERS_CI_BUILD_UUID"],
		sha: ["WORKERS_CI_COMMIT_SHA"],
		refName: ["WORKERS_CI_BRANCH"],
	},
	{
		name: "codebuild",
		detect: ["CODEBUILD_BUILD_ARN"],
		runId: ["CODEBUILD_BUILD_ID"],
		sha: ["CODEBUILD_RESOLVED_SOURCE_VERSION"],
	},
	{ name: "codefresh", detect: ["CF_BUILD_ID"], runId: ["CF_BUILD_ID"], sha: ["CF_REVISION"], refName: ["CF_BRANCH"] },
	{
		name: "drone",
		detect: ["DRONE", "DRONE_BUILD_EVENT"],
		runId: ["DRONE_BUILD_NUMBER"],
		sha: ["DRONE_COMMIT_SHA"],
		refName: ["DRONE_BRANCH"],
		os: ["DRONE_STAGE_OS"],
		arch: ["DRONE_STAGE_ARCH"],
	},
	{ name: "dsari", detect: ["DSARI"] },
	{
		name: "gitlab",
		detect: ["GITLAB_CI", "CI_MERGE_REQUEST_ID"],
		runId: ["CI_PIPELINE_ID"],
		jobId: ["CI_JOB_ID"],
		sha: ["CI_COMMIT_SHA"],
		refName: ["CI_COMMIT_REF_NAME"],
	},
	{ name: "gocd", detect: ["GO_PIPELINE_LABEL"], runId: ["GO_PIPELINE_COUNTER"], jobId: ["GO_JOB_NAME"] },
	{ name: "layerci", detect: ["LAYERCI"] },
	{
		name: "jenkins",
		detect: ["JENKINS_URL"],
		runId: ["BUILD_ID"],
		jobId: ["JOB_NAME"],
		sha: ["GIT_COMMIT"],
		refName: ["BRANCH_NAME", "GIT_BRANCH"],
	},
	{
		name: "hudson",
		detect: ["HUDSON_URL"],
		runId: ["BUILD_ID"],
		jobId: ["JOB_NAME"],
		sha: ["GIT_COMMIT"],
		refName: ["GIT_BRANCH"],
	},
	{ name: "magnum", detect: ["MAGNUM"] },
	{ name: "netlify", detect: ["NETLIFY"], runId: ["BUILD_ID"], sha: ["COMMIT_REF"], refName: ["BRANCH"] },
	{ name: "nevercode", detect: ["NEVERCODE"] },
	{ name: "sail", detect: ["SAILCI"] },
	{
		name: "semaphore",
		detect: ["SEMAPHORE"],
		runId: ["SEMAPHORE_WORKFLOW_ID"],
		jobId: ["SEMAPHORE_JOB_ID"],
		sha: ["SEMAPHORE_GIT_SHA"],
		refName: ["SEMAPHORE_GIT_BRANCH"],
	},
	{ name: "screwdriver", detect: ["SCREWDRIVER"], runId: ["SD_BUILD_ID"], jobId: ["SD_JOB_ID"], sha: ["SD_BUILD_SHA"] },
	{ name: "shippable", detect: ["SHIPPABLE"] },
	{ name: "solano", detect: ["TDDIUM"] },
	{ name: "strider", detect: ["STRIDER"] },
	{ name: "teamcity", detect: ["TEAMCITY_VERSION"], runId: ["BUILD_NUMBER"], sha: ["BUILD_VCS_NUMBER"] },
	{
		name: "travis",
		detect: ["TRAVIS"],
		runId: ["TRAVIS_BUILD_ID"],
		jobId: ["TRAVIS_JOB_ID"],
		sha: ["TRAVIS_COMMIT"],
		refName: ["TRAVIS_BRANCH"],
		os: ["TRAVIS_OS_NAME"],
		arch: ["TRAVIS_CPU_ARCH"],
	},
	{
		name: "vercel",
		detect: ["NOW_BUILDER"],
		sha: ["VERCEL_GIT_COMMIT_SHA"],
		refName: ["VERCEL_GIT_COMMIT_REF"],
	},
	{ name: "appcenter", detect: ["APPCENTER_BUILD_ID"], runId: ["APPCENTER_BUILD_ID"], refName: ["APPCENTER_BRANCH"] },
	{ name: "cleavr", detect: ["CLEAVR"] },
	{ name: "edgeone-pages", detect: ["EO_PAGES_CI"] },
];

/**
 * Every provider, in detection order, followed by nothing: `generic` is not a row.
 *
 * @internal
 */
export const ciProviders: ReadonlyArray<CiProvider> = PROVIDERS;

/**
 * Every {@link CiName}, in detection order, with `generic` last: the literal set `RuntimeEnv.ci` decodes.
 *
 * @internal
 */
export const ciNames: ReadonlyArray<CiName> = [...PROVIDERS.map((provider) => provider.name), "generic"];

// "" is falsy, as in detectAgent and std-env: an empty variable is an unset one. "false" and "0" are falsy too, so
// CI=false is honoured; std-env reads any non-empty value as set.
const isFalsy = (value: string | undefined): boolean =>
	value === undefined || value === "" || value.toLowerCase() === "false" || value === "0";

const first = (env: Env, keys: ReadonlyArray<string> | undefined): Option.Option<string> => {
	for (const key of keys ?? []) {
		const value = env[key];
		if (value !== undefined && value !== "") return Option.some(value);
	}
	return Option.none();
};

/** The provider row whose detection variable is set, in detection order. */
const providerOf = (env: Env): CiProvider | undefined =>
	PROVIDERS.find((provider) => provider.detect.some((key) => !isFalsy(env[key])));

/**
 * The CI this process runs in: the first provider whose detection variable is truthy (GitHub Actions first, then
 * std-env's order, a provider signal winning even under `CI=false`), else `generic` when `CI` or
 * `CONTINUOUS_INTEGRATION` is truthy.
 *
 * @internal
 */
export const detectCi = (env: Env): Option.Option<CiName> => {
	const provider = providerOf(env);
	if (provider !== undefined) return Option.some(provider.name);
	if (!isFalsy(env.CI) || !isFalsy(env.CONTINUOUS_INTEGRATION)) return Option.some("generic");
	return Option.none();
};

/**
 * The run coordinates of a CI run, each read raw from its provider's documented variable.
 *
 * @internal
 */
export interface CiRunRecord {
	readonly runId: Option.Option<string>;
	readonly attempt: Option.Option<string>;
	readonly jobId: Option.Option<string>;
	readonly sha: Option.Option<string>;
	readonly refName: Option.Option<string>;
	readonly runner: Option.Option<{ readonly os: string; readonly arch: Option.Option<string> }>;
}

/**
 * The run coordinates for the detected CI: `Some` exactly when {@link detectCi} is, with every coordinate the provider
 * does not document (and every coordinate of `generic`) `None`.
 *
 * @internal
 */
export const detectCiRun = (env: Env): Option.Option<CiRunRecord> => {
	if (Option.isNone(detectCi(env))) return Option.none();
	const provider: CiProvider = providerOf(env) ?? { name: "generic", detect: [] };
	return Option.some({
		runId: first(env, provider.runId),
		attempt: first(env, provider.attempt),
		jobId: first(env, provider.jobId),
		sha: Option.filter(first(env, provider.sha), (sha) => !(provider.shaPlaceholders ?? []).includes(sha)),
		refName: first(env, provider.refName),
		runner: Option.map(first(env, provider.os), (os) => ({ os, arch: first(env, provider.arch) })),
	});
};

/**
 * Every environment variable name the CI detectors read.
 *
 * @internal
 */
export const ciKeys: ReadonlyArray<string> = [
	...new Set([
		...PROVIDERS.flatMap((provider) => [
			...provider.detect,
			...(provider.runId ?? []),
			...(provider.attempt ?? []),
			...(provider.jobId ?? []),
			...(provider.sha ?? []),
			...(provider.refName ?? []),
			...(provider.os ?? []),
			...(provider.arch ?? []),
		]),
		"CI",
		"CONTINUOUS_INTEGRATION",
	]),
];

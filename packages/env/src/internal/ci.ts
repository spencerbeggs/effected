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
	readonly name: Exclude<CiName, "generic">;
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
export const PROVIDERS = [
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
] as const satisfies ReadonlyArray<CiProvider>;

/** Every `CiName` with a row, or `never` when one has none: a name added to `CiName` without a provider fails to compile. */
type RowName = [Exclude<CiName, "generic" | (typeof PROVIDERS)[number]["name"]>] extends [never] ? CiName : never;

/**
 * Every {@link CiName}, in detection order, with `generic` last: the literal set `RuntimeEnv.ci` decodes.
 *
 * @internal
 */
export const ciNames: ReadonlyArray<RowName> = [...PROVIDERS.map((provider) => provider.name), "generic"];

// Departure from std-env, which reads any non-empty value as set (`CI=false` is CI there): `false`, `0`, `off` and `no`
// (any case) read as not set, for `CI` and for a provider's own marker alike. Users set `CI=false` to get interactive
// output back, and GitHub Actions has honoured it here since 0.5.0. The record is normalized, so empty is already absent.
const FALSY = new Set(["false", "0", "off", "no"]);
const isSet = (env: Env, key: string): boolean => {
	const value = env[key];
	return value !== undefined && !FALSY.has(value.toLowerCase());
};

const first = (env: Env, keys: ReadonlyArray<string> | undefined): Option.Option<string> => {
	for (const key of keys ?? []) {
		const value = env[key];
		if (value !== undefined) return Option.some(value);
	}
	return Option.none();
};

/** The provider row whose detection variable is set, in detection order. */
export const providerOf = (env: Env): CiProvider | undefined =>
	PROVIDERS.find((provider) => provider.detect.some((key) => isSet(env, key)));

const noRun = {
	runId: Option.none<string>(),
	attempt: Option.none<string>(),
	jobId: Option.none<string>(),
	sha: Option.none<string>(),
	refName: Option.none<string>(),
	runner: Option.none<{ readonly os: string; readonly arch: Option.Option<string> }>(),
};

/**
 * The CI this process runs in and its run coordinates, from one scan of the provider table: the first provider whose
 * detection variable is set (GitHub Actions first, then std-env's order, a provider signal winning even under
 * `CI=false`), else `generic` when `CI` or `CONTINUOUS_INTEGRATION` is set. A value is set unless it is `false`, `0`, `off` or `no` (any case): as in std-env
 * otherwise, but `CI=false` is not CI, a deliberate departure so a user can turn CI output off. `ciRun` is `Some` exactly when `ci` is, with every coordinate the provider
 * does not document (and every coordinate of `generic`) `None`. The record must be normalized.
 *
 * @internal
 */
export const detectCiState = (
	env: Env,
): { readonly ci: Option.Option<CiName>; readonly ciRun: Option.Option<typeof noRun> } => {
	const provider = providerOf(env);
	if (provider === undefined) {
		return isSet(env, "CI") || isSet(env, "CONTINUOUS_INTEGRATION")
			? { ci: Option.some("generic"), ciRun: Option.some(noRun) }
			: { ci: Option.none(), ciRun: Option.none() };
	}
	const placeholders = provider.shaPlaceholders ?? [];
	return {
		ci: Option.some(provider.name),
		ciRun: Option.some({
			runId: first(env, provider.runId),
			attempt: first(env, provider.attempt),
			jobId: first(env, provider.jobId),
			sha: Option.filter(first(env, provider.sha), (sha) => !placeholders.includes(sha)),
			refName: first(env, provider.refName),
			runner: Option.map(first(env, provider.os), (os) => ({ os, arch: first(env, provider.arch) })),
		}),
	};
};

/** The CI this process runs in: see {@link detectCiState}. @internal */
export const detectCi = (env: Env): Option.Option<CiName> => detectCiState(env).ci;

/** The run coordinates for the detected CI: see {@link detectCiState}. @internal */
export const detectCiRun = (env: Env): Option.Option<typeof noRun> => detectCiState(env).ciRun;

/**
 * The variable names that decide whether a CI is present, and which: every provider's detection variables plus `CI`
 * and `CONTINUOUS_INTEGRATION`. Read these first, then {@link ciCoordinateKeys} for the matched provider only.
 *
 * @internal
 */
export const ciDetectKeys: ReadonlyArray<string> = [
	...new Set([...PROVIDERS.flatMap((provider) => provider.detect), "CI", "CONTINUOUS_INTEGRATION"]),
];

/**
 * The variable names a matched provider's run coordinates are read from.
 *
 * @internal
 */
export const ciCoordinateKeys = (provider: CiProvider): ReadonlyArray<string> => [
	...new Set([
		...(provider.runId ?? []),
		...(provider.attempt ?? []),
		...(provider.jobId ?? []),
		...(provider.sha ?? []),
		...(provider.refName ?? []),
		...(provider.os ?? []),
		...(provider.arch ?? []),
	]),
];

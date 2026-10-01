/**
 * Typed GitHub REST and GraphQL for Effect: a route-keyed client, one error
 * taxonomy, GitHub App auth, and one resource service per GitHub noun.
 *
 * @remarks
 * `GitHubClient.request` types both the parameters and the returned `data` from
 * the route literal. Every REST failure is a `GitHubError` whose `kind` you
 * branch on. Resource services (`GitBranch`, `GitTag`, `CheckRun`,
 * `PullRequest`, `GitHubRelease` and others) turn multi-call sequences into one
 * call, and a configuration tier writes secrets, variables, rulesets,
 * deployment environments and security settings. `GitHubApp` mints and revokes
 * installation tokens.
 *
 * @example
 * ```ts
 * import { GitHubClient } from "@effected/github";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const client = yield* GitHubClient;
 *   const repo = yield* client.request("GET /repos/{owner}/{repo}", { owner: "effect-ts", repo: "effect" });
 *   return repo.default_branch;
 * });
 *
 * // GITHUB_TOKEN is read through the ambient ConfigProvider.
 * Effect.runPromise(program.pipe(Effect.provide(GitHubClient.layerFromConfig())));
 * ```
 *
 * @packageDocumentation
 */

// Six issue-reference names from `@effected/github-references` are re-exported
// here for existing consumers; the closing-list dialect is deliberately not.
export {
	type BareLineReference,
	CLOSING_KEYWORDS,
	type ClosingKeyword,
	type IssueReference,
	harvestIssueReferences,
	parseBareLineReference,
} from "@effected/github-references";
export { ArtifactMetadata, type ArtifactMetadataShape, StorageRecordInput } from "./ArtifactMetadata.js";
export { Attestation, AttestationListEntry, AttestationRecord, type AttestationShape } from "./Attestation.js";
export {
	Annotation,
	AnnotationLevel,
	CheckConclusion,
	CheckRun,
	CheckRunOutput,
	CheckRunRef,
	type CheckRunShape,
	type ConcludeCheckRun,
} from "./CheckRun.js";
export { CodeScanning, type CodeScanningSetup, type CodeScanningShape } from "./CodeScanning.js";
export {
	DeploymentEnvironment,
	type DeploymentEnvironmentInfo,
	type DeploymentEnvironmentShape,
} from "./DeploymentEnvironment.js";
export { type BranchOutcome, GitBranch, type GitBranchShape } from "./GitBranch.js";
export {
	CommitRef,
	FileChange,
	FileContent,
	FileDeletion,
	FileMode,
	GitCommit,
	type GitCommitShape,
} from "./GitCommit.js";
export {
	type AppCredentials,
	AppIdentity,
	BotIdentity,
	GitHubApp,
	GitHubAppError,
	type GitHubAppOptions,
	type GitHubAppShape,
	Installation,
	InstallationToken,
	type TokenRequest,
} from "./GitHubApp.js";
export {
	GitHubClient,
	type GitHubClientOptions,
	type GitHubClientShape,
	type GitHubFixtures,
	type RecordedCall,
} from "./GitHubClient.js";
export {
	CommitComparison,
	CommitFile,
	CommitSummary,
	FileStatus,
	GitHubCommit,
	type GitHubCommitShape,
} from "./GitHubCommit.js";
export { GitHubContent, type GitHubContentShape } from "./GitHubContent.js";
export { GitHubError, GitHubErrorKind, GitHubValidationCode, GitHubValidationEntry } from "./GitHubError.js";
export { CommentOnceResult, GitHubIssue, type GitHubIssueShape, IssueInfo, LinkedIssue } from "./GitHubIssue.js";
export { GitHubRelease, type GitHubReleaseShape, ReleaseAsset, ReleaseInfo } from "./GitHubRelease.js";
export {
	type AppliedSettings,
	GRAPHQL_ONLY_SETTINGS,
	GitHubRepository,
	type GitHubRepositoryShape,
	type OwnerType,
	type RepositoryPatch,
	type RepositoryPatchDraft,
	type RepositorySettings,
	SECURITY_ANALYSIS_STATUS_FIELDS,
	repositoryPatch,
	transformSecurityAndAnalysis,
} from "./GitHubRepository.js";
export {
	GitTag,
	type GitTagShape,
	type LatestSemverOptions,
	SemverTag,
	TagRef,
	type VersionFromTag,
	versionFromTag,
} from "./GitTag.js";
export { GitHubGraphQLError, GraphQLDocument, GraphQLErrorEntry } from "./GraphQL.js";
export {
	MergeMethod,
	PullRequest,
	PullRequestInfo,
	type PullRequestShape,
	type UpsertedPullRequest,
} from "./PullRequest.js";
export {
	CommentMarker,
	CommentRecord,
	PullRequestComment,
	type PullRequestCommentShape,
} from "./PullRequestComment.js";
export { InvalidRepoRefError, Repo, RepoRef } from "./Repo.js";
export { RepositorySecret, type RepositorySecretShape, type SecretInfo, type SecretScope } from "./RepositorySecret.js";
export { RepositorySecurity, type RepositorySecurityShape } from "./RepositorySecurity.js";
export { RepositoryVariable, type RepositoryVariableShape, type VariableInfo } from "./RepositoryVariable.js";
export { RateLimitSnapshot, RetryPolicy, type RetryableFailure } from "./Resilience.js";
export type {
	Data as RestData,
	Item as RestItem,
	PaginatingRoute as RestPaginatingRoute,
	Params as RestParams,
	RequestExtras as RestExtras,
	Response as RestResponse,
	Route as RestRoute,
} from "./Rest.js";
export { PageOptions } from "./Rest.js";
export { Ruleset, type RulesetInfo, type RulesetPayload, type RulesetShape } from "./Ruleset.js";
export {
	ExtraPermission,
	PermissionGap,
	PermissionLevel,
	PermissionResult,
	TokenPermissionError,
	TokenPermissions,
} from "./TokenPermissions.js";
export {
	type PollOptions,
	WorkflowDispatch,
	type WorkflowDispatchShape,
	type WorkflowInfo,
	WorkflowRunStatus,
} from "./WorkflowDispatch.js";

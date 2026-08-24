// The issue-reference grammar moved to @effected/github-references; these six
// re-exports keep existing consumers working. The new closing-list dialect is
// deliberately NOT re-exported here — new consumers take the grammar package.
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
export { GitHubError, GitHubErrorKind } from "./GitHubError.js";
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

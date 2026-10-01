/**
 * The GitHub Actions runtime for Effect: the services an action needs to talk
 * to the runner it executes inside.
 *
 * {@link Action.run} composes the default runtime ({@link ActionRuntime}), runs
 * your program, renders a failure as an `::error::` annotation and sets the exit
 * code. {@link ActionInput} reads workflow inputs as typed `Config` values, and
 * {@link ActionOutputs}, {@link ActionState}, {@link ActionLogger} and
 * {@link ActionEnvironment} cover outputs, cross-phase state, workflow-command
 * logging and the runner's variables. Heavier protocols are opt-in services:
 * {@link ActionCache}, {@link Artifact}, {@link BlobStore}, {@link ToolInstaller},
 * {@link PackageManagerInstaller}, {@link OidcTokenIssuer} and the GitHub App
 * token bridge {@link GitHubToken}. {@link Secret} is the one place a `Redacted`
 * value becomes plaintext, and always masks first. A reporting suite
 * ({@link GitHubMarkdown}, {@link ManagedDocument}, {@link CheckState} and
 * {@link CheckDocument}) renders what a run did onto a pull request comment, a
 * check run or the job summary.
 *
 * The cache, artifact and tool-cache protocols are implemented directly against
 * their HTTP APIs, with no `@actions/*` dependency.
 *
 * @packageDocumentation
 */

// `WorkflowCommand` is owned by the pure `@effected/github-commands`; this entrypoint re-exports it so it stays importable from here.
export { type AnnotationProperties, WorkflowCommand } from "@effected/github-commands";
export {
	Action,
	type ActionRunOptions,
	ActionRuntime,
	type ActionServices,
	describeCause,
} from "./Action.js";
export { ActionCache, ActionCacheError, type ActionCacheShape } from "./ActionCache.js";
export {
	ActionEnvironment,
	ActionEnvironmentError,
	type ActionEnvironmentShape,
	GitHubContext,
	RunnerContext,
} from "./ActionEnvironment.js";
export { ActionInput, type PairsOptions } from "./ActionInput.js";
export {
	ActionLogger,
	type ActionLoggerShape,
	type WithBufferOptions,
	type WithStepOptions,
} from "./ActionLogger.js";
export {
	type ActionOutputError,
	ActionOutputs,
	type ActionOutputsShape,
	DetachedOutputError,
	InvalidOutputNameError,
	OutputEncodeError,
	RecordedOutput,
	type RecordedOutputMember,
	type RecordingOutputs,
	RunnerFileUnavailableError,
	RunnerFileWriteError,
} from "./ActionOutputs.js";
export { ActionState, ActionStateError, type ActionStateShape } from "./ActionState.js";
export { ActionsIdentityToken } from "./ActionsIdentityToken.js";
export { ActionsProvenance } from "./ActionsProvenance.js";
export {
	Artifact,
	ArtifactError,
	type ArtifactItem,
	type ArtifactRef,
	type ArtifactShape,
	type DownloadOptions,
	type DownloadResult,
	type UploadOptions,
	type UploadResult,
} from "./Artifact.js";
export {
	BlobEnvelope,
	type BlobEnvelopeError,
	BlobMetadataDecodeError,
	BlobMetadataEncodeError,
	NotABlobEnvelopeError,
	TruncatedBlobEnvelopeError,
	UnsupportedBlobEnvelopeVersionError,
} from "./BlobEnvelope.js";
export { GitHubCacheBlobStore } from "./BlobStore.githubCache.js";
export { BlobStore, BlobStoreError, type BlobStoreShape, type S3Config, type StoredBlob } from "./BlobStore.js";
export { BlobTransferError, type DataBlobTransfer, type FileBlobTransfer } from "./BlobTransfer.js";
export { CacheKey, CacheKeyBadPatternError, type CacheKeyError, CacheKeyReadError } from "./CacheKey.js";
export {
	CheckDocument,
	CheckDocumentError,
	type CheckDocumentOptions,
	type CheckDocumentShape,
	type CheckDocumentSink,
	CheckDocumentStamp,
	type CheckFlushOutcome,
	CheckReport,
} from "./CheckDocument.js";
export {
	type CheckRunConclusion,
	type CheckRunProjection,
	CheckState,
	projectCheckState,
} from "./CheckState.js";
export { ChildEnv, type PathPrependEnv, type PathPrependOptions } from "./ChildEnv.js";
export {
	DetachedLogUnavailableError,
	DetachedNotReadyError,
	DetachedProcess,
	type DetachedProcessError,
	type DetachedProcessOps,
	DetachedSignalFailedError,
	DetachedSpawnFailedError,
	type DetachedSpawnOptions,
	InvalidPidError,
	ProcessId,
	type ReadinessOptions,
} from "./DetachedProcess.js";
export { DryRun, type DryRunShape } from "./DryRun.js";
export {
	type GitHubHeadingDepth,
	type GitHubListOptions,
	GitHubMarkdown,
	type GitHubRowSchema,
	type GitHubSchemaTable,
	type GitHubSchemaTableColumn,
	type GitHubSchemaTableColumns,
	type GitHubSchemaTableFormatRequiredKeys,
	type GitHubSchemaTableFormattedColumn,
	type GitHubSchemaTableOptions,
} from "./GitHubMarkdown.js";
export {
	type ClientLayerOptions,
	GitHubToken,
	GitHubTokenError,
	type ProvisionOptions,
	type ReadOptions,
} from "./GitHubToken.js";
export { ManagedDocument, ManagedDocumentError, type ManagedDocumentSource } from "./ManagedDocument.js";
export { OidcClaims, OidcTokenError, OidcTokenIssuer, type OidcTokenIssuerShape } from "./OidcTokenIssuer.js";
export {
	AmbientPackageManager,
	CachedPackageManager,
	InstalledPackageManager,
	type PackageManagerInstallOptions,
	PackageManagerInstaller,
	PackageManagerInstallerError,
	type PackageManagerInstallerShape,
} from "./PackageManagerInstaller.js";
export { Secret } from "./Secret.js";
export {
	type ExtractOptions,
	type ProvisionFileOptions,
	type ProvisionedFile,
	type ToolDownloadOptions,
	ToolInstaller,
	ToolInstallerError,
	type ToolInstallerShape,
} from "./ToolInstaller.js";

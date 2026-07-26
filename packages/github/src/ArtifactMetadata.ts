import { Context, Effect, Layer, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { GitHubError } from "./GitHubError.js";

/**
 * What to record about a published artifact.
 *
 * @remarks
 * These are the fields the endpoint actually accepts. The version this replaces
 * declared a `version` field the endpoint has no notion of — a fabricated key
 * that a `Record<string, unknown>` body accepted silently and the generated
 * types reject outright.
 *
 * @public
 */
export class StorageRecordInput extends Schema.Class<StorageRecordInput>("StorageRecordInput")({
	/** The artifact's package URL (purl). */
	name: Schema.NonEmptyString,
	/** Its content digest, as `algorithm:hex`. */
	digest: Schema.NonEmptyString,
	/** The registry's base URL. */
	registryUrl: Schema.NonEmptyString,
	/** The repository name **within the registry**. */
	repository: Schema.NonEmptyString,
	/** Where the artifact is stored, when there is a direct URL. */
	artifactUrl: Schema.optionalKey(Schema.String),
	/** The artifact's path within the registry, when there is one. */
	path: Schema.optionalKey(Schema.String),
}) {}

/**
 * Organization-level artifact metadata.
 *
 * @remarks
 * Org-scoped rather than repository-scoped, so it takes the organization as an
 * argument and does **not** read {@link Repo}.
 *
 * @public
 */
export interface ArtifactMetadataShape {
	/** Record where a published artifact lives; returns the ids GitHub stored. */
	readonly createStorageRecord: (
		org: string,
		input: StorageRecordInput,
	) => Effect.Effect<ReadonlyArray<number>, GitHubError>;
}

/**
 * Artifact metadata.
 *
 * @public
 */
export class ArtifactMetadata extends Context.Service<ArtifactMetadata, ArtifactMetadataShape>()(
	"@effected/github/ArtifactMetadata",
) {
	static readonly layer: Layer.Layer<ArtifactMetadata, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<ArtifactMetadataShape> = {}): ArtifactMetadataShape => ({
		createStorageRecord: overrides.createStorageRecord ?? (() => unstubbed("createStorageRecord")),
	});

	/** {@link ArtifactMetadata.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<ArtifactMetadataShape> = {}): Layer.Layer<ArtifactMetadata> =>
		Layer.succeed(ArtifactMetadata, ArtifactMetadata.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`ArtifactMetadata.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

const make = (client: GitHubClient["Service"]): ArtifactMetadataShape => ({
	createStorageRecord: Effect.fn("ArtifactMetadata.createStorageRecord")(function* (
		org: string,
		input: StorageRecordInput,
	) {
		yield* Effect.annotateCurrentSpan({ org, artifact: input.name });
		// The route is in GitHub's OpenAPI description now, so this is a typed call
		// — the defensive `octokit.request` cast and string-body tolerance the
		// previous version carried are both unnecessary.
		const stored = yield* client.request("POST /orgs/{org}/artifacts/metadata/storage-record", {
			org,
			name: input.name,
			digest: input.digest,
			registry_url: input.registryUrl,
			repository: input.repository,
			...(input.artifactUrl !== undefined ? { artifact_url: input.artifactUrl } : {}),
			...(input.path !== undefined ? { path: input.path } : {}),
		});
		return (stored.storage_records ?? []).flatMap((record) => (typeof record.id === "number" ? [record.id] : []));
	}),
});

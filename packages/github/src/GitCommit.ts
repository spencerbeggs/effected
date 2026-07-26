import { Context, Effect, Layer, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { GitHubError } from "./GitHubError.js";
import { Repo } from "./Repo.js";

/**
 * A blob's file mode, as the Git Database API spells it.
 *
 * @public
 */
export const FileMode = Schema.Literals(["100644", "100755", "120000"]);

/**
 * A file to write in a commit.
 *
 * @public
 */
export class FileContent extends Schema.TaggedClass<FileContent>()("FileContent", {
	/** Repository-relative path. */
	path: Schema.NonEmptyString,
	/** The file's new contents. */
	content: Schema.String,
	/** Defaults to a regular file. */
	mode: Schema.optionalKey(FileMode),
}) {}

/**
 * A file to remove in a commit.
 *
 * @public
 */
export class FileDeletion extends Schema.TaggedClass<FileDeletion>()("FileDeletion", {
	/** Repository-relative path. */
	path: Schema.NonEmptyString,
}) {}

/**
 * One change in a commit.
 *
 * @public
 */
export const FileChange = Schema.Union([FileContent, FileDeletion]);

/** One change in a commit. @public */
export type FileChange = FileContent | FileDeletion;

/**
 * A commit, projected to the three fields callers actually use.
 *
 * @remarks
 * `treeSha` is here because two surveyed call sites dropped to a raw octokit
 * cast for it alone, both with the comment *"the Git Data API's `base_tree`
 * wants a tree SHA, not a commit SHA"* — the same eight lines written twice, in
 * two files, for one string.
 *
 * @public
 */
export class CommitRef extends Schema.Class<CommitRef>("CommitRef")({
	/** The commit's own sha. */
	sha: Schema.String,
	/** The tree the commit points at — what `baseTree` wants. */
	treeSha: Schema.String,
	/** Parent commit shas, in order. */
	parents: Schema.Array(Schema.String),
}) {}

/**
 * Commits and trees in GitHub's Git Database API.
 *
 * @public
 */
export interface GitCommitShape {
	/** Read a commit's sha, tree and parents. */
	readonly get: (sha: string) => Effect.Effect<CommitRef, GitHubError, Repo>;
	/** Build a tree, optionally on top of an existing one. */
	readonly createTree: (options: {
		readonly changes: ReadonlyArray<FileChange>;
		readonly baseTree?: string | undefined;
	}) => Effect.Effect<string, GitHubError, Repo>;
	/** Create a commit object. */
	readonly createCommit: (options: {
		readonly message: string;
		readonly tree: string;
		readonly parents: ReadonlyArray<string>;
	}) => Effect.Effect<string, GitHubError, Repo>;
	/**
	 * Write `changes` onto `branch` as one commit, returning its sha.
	 *
	 * @remarks
	 * The four-call sequence — read the branch, build a tree on its commit's
	 * tree, create the commit, move the ref — as one operation. The ref update is
	 * **not** forced: a branch that moved underneath you is a conflict worth
	 * hearing about, not one to overwrite.
	 */
	readonly commitFiles: (options: {
		readonly branch: string;
		readonly message: string;
		readonly changes: ReadonlyArray<FileChange>;
	}) => Effect.Effect<string, GitHubError, Repo>;
}

/**
 * Commits, trees and blobs.
 *
 * @public
 */
export class GitCommit extends Context.Service<GitCommit, GitCommitShape>()("@effected/github/GitCommit") {
	static readonly layer: Layer.Layer<GitCommit, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<GitCommitShape> = {}): GitCommitShape => ({
		get: overrides.get ?? (() => unstubbed("get")),
		createTree: overrides.createTree ?? (() => unstubbed("createTree")),
		createCommit: overrides.createCommit ?? (() => unstubbed("createCommit")),
		commitFiles: overrides.commitFiles ?? (() => unstubbed("commitFiles")),
	});

	/** {@link GitCommit.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<GitCommitShape> = {}): Layer.Layer<GitCommit> =>
		Layer.succeed(GitCommit, GitCommit.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`GitCommit.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

/** The Git Database tree entry for one change. */
const treeEntry = (change: FileChange) =>
	change._tag === "FileContent"
		? { path: change.path, mode: change.mode ?? ("100644" as const), type: "blob" as const, content: change.content }
		: // A null sha is how the Git Database API spells "remove this path".
			{ path: change.path, mode: "100644" as const, type: "blob" as const, sha: null };

const make = (client: GitHubClient["Service"]): GitCommitShape => {
	const get = Effect.fn("GitCommit.get")(function* (sha: string) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, sha });
		const commit = yield* client.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", {
			owner,
			repo,
			commit_sha: sha,
		});
		return CommitRef.make({
			sha: commit.sha,
			treeSha: commit.tree.sha,
			parents: commit.parents.map((parent) => parent.sha),
		});
	});

	const createTree = Effect.fn("GitCommit.createTree")(function* (options: {
		readonly changes: ReadonlyArray<FileChange>;
		readonly baseTree?: string | undefined;
	}) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, changes: options.changes.length });
		const tree = yield* client.request("POST /repos/{owner}/{repo}/git/trees", {
			owner,
			repo,
			tree: options.changes.map(treeEntry),
			...(options.baseTree !== undefined ? { base_tree: options.baseTree } : {}),
		});
		return tree.sha;
	});

	const createCommit = Effect.fn("GitCommit.createCommit")(function* (options: {
		readonly message: string;
		readonly tree: string;
		readonly parents: ReadonlyArray<string>;
	}) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, tree: options.tree });
		const commit = yield* client.request("POST /repos/{owner}/{repo}/git/commits", {
			owner,
			repo,
			message: options.message,
			tree: options.tree,
			parents: [...options.parents],
		});
		return commit.sha;
	});

	return {
		get,
		createTree,
		createCommit,
		commitFiles: Effect.fn("GitCommit.commitFiles")(function* (options: {
			readonly branch: string;
			readonly message: string;
			readonly changes: ReadonlyArray<FileChange>;
		}) {
			const { owner, repo } = yield* Repo;
			const short = options.branch.replace(/^refs\/heads\//, "").replace(/^heads\//, "");
			yield* Effect.annotateCurrentSpan({ owner, repo, branch: short, changes: options.changes.length });
			const ref = yield* client.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
				owner,
				repo,
				ref: `heads/${short}`,
			});
			const head = yield* get(ref.object.sha);
			const tree = yield* createTree({ changes: options.changes, baseTree: head.treeSha });
			const commit = yield* createCommit({ message: options.message, tree, parents: [head.sha] });
			yield* client.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", {
				owner,
				repo,
				ref: `heads/${short}`,
				sha: commit,
				force: false,
			});
			return commit;
		}),
	};
};

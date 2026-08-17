import { Context, Effect, Layer, Option, Schema } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import type { GitHubError } from "./GitHubError.js";
import { numericId } from "./internal/ids.js";
import { Repo } from "./Repo.js";
import type { PageOptions } from "./Rest.js";

/**
 * The hidden marker that makes a comment findable again.
 *
 * @remarks
 * A pure class, not a hardcoded string. The surface this replaces baked
 * `<!-- savvy-web:${key} -->` into the library — one vendor's name, inside a
 * package meant to be general. Here the namespace is the caller's, the marker is
 * testable without a client, and the library has no opinion about whose comments
 * these are.
 *
 * @public
 */
export class CommentMarker extends Schema.Class<CommentMarker>("CommentMarker")({
	/** Whose comments these are, e.g. your action's name. */
	namespace: Schema.NonEmptyString,
	/** Which comment, within that namespace. */
	key: Schema.NonEmptyString,
}) {
	/** The HTML comment appended to a body so the comment can be found again. */
	get html(): string {
		return `<!-- ${this.namespace}:${this.key} -->`;
	}

	/** Does this body carry the marker? */
	matches(body: string): boolean {
		return body.includes(this.html);
	}
}

/**
 * A comment this package wrote or found.
 *
 * @public
 */
export class CommentRecord extends Schema.Class<CommentRecord>("CommentRecord")({
	id: Schema.Int,
	body: Schema.String,
	url: Schema.String,
}) {}

/**
 * Sticky comments on a pull request or issue.
 *
 * @public
 */
export interface PullRequestCommentShape {
	/** Post a new comment. */
	readonly create: (issueNumber: number, body: string) => Effect.Effect<CommentRecord, GitHubError, Repo>;
	/**
	 * Update the marked comment if there is one, or post it.
	 *
	 * @remarks
	 * The marker is appended to the body, so a comment written by `upsert` is
	 * always findable by the same marker afterwards.
	 */
	readonly upsert: (
		issueNumber: number,
		marker: CommentMarker,
		body: string,
	) => Effect.Effect<CommentRecord, GitHubError, Repo>;
	/**
	 * Find the marked comment.
	 *
	 * @remarks
	 * **Paginates.** The version this replaces requested a single page of 100 and
	 * stopped, so on a busy pull request the marker silently vanished and every
	 * update posted a new comment instead.
	 */
	readonly find: (
		issueNumber: number,
		marker: CommentMarker,
		options?: { readonly page?: PageOptions | undefined },
	) => Effect.Effect<Option.Option<CommentRecord>, GitHubError, Repo>;
	readonly delete: (commentId: number) => Effect.Effect<void, GitHubError, Repo>;
}

/**
 * Sticky comments.
 *
 * @public
 */
export class PullRequestComment extends Context.Service<PullRequestComment, PullRequestCommentShape>()(
	"@effected/github/PullRequestComment",
) {
	static readonly layer: Layer.Layer<PullRequestComment, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<PullRequestCommentShape> = {}): PullRequestCommentShape => ({
		create: overrides.create ?? (() => unstubbed("create")),
		upsert: overrides.upsert ?? (() => unstubbed("upsert")),
		find: overrides.find ?? (() => unstubbed("find")),
		delete: overrides.delete ?? (() => unstubbed("delete")),
	});

	/** {@link PullRequestComment.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<PullRequestCommentShape> = {}): Layer.Layer<PullRequestComment> =>
		Layer.succeed(PullRequestComment, PullRequestComment.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`PullRequestComment.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

const recordOf = (raw: { id: number | bigint; body?: string | null; html_url: string }): CommentRecord =>
	CommentRecord.make({ id: numericId(raw.id), body: raw.body ?? "", url: raw.html_url });

const make = (client: GitHubClient["Service"]): PullRequestCommentShape => {
	const create = Effect.fn("PullRequestComment.create")(function* (issueNumber: number, body: string) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, issueNumber });
		const created = yield* client.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
			owner,
			repo,
			issue_number: issueNumber,
			body,
		});
		return recordOf(created);
	});

	const find = Effect.fn("PullRequestComment.find")(function* (
		issueNumber: number,
		marker: CommentMarker,
		options?: { readonly page?: PageOptions | undefined },
	) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, issueNumber, marker: marker.key });
		const comments = yield* client.paginate(
			"GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
			{ owner, repo, issue_number: issueNumber },
			options?.page,
		);
		const found = comments.find((comment) => marker.matches(comment.body ?? ""));
		return found === undefined ? Option.none() : Option.some(recordOf(found));
	});

	return {
		create,
		find,

		upsert: Effect.fn("PullRequestComment.upsert")(function* (
			issueNumber: number,
			marker: CommentMarker,
			body: string,
		) {
			const { owner, repo } = yield* Repo;
			const marked = `${body}\n\n${marker.html}`;
			const existing = yield* find(issueNumber, marker);
			if (Option.isNone(existing)) {
				return yield* create(issueNumber, marked);
			}
			const updated = yield* client.request("PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}", {
				owner,
				repo,
				comment_id: existing.value.id,
				body: marked,
			});
			return recordOf(updated);
		}),

		delete: Effect.fn("PullRequestComment.delete")(function* (commentId: number) {
			const { owner, repo } = yield* Repo;
			yield* Effect.annotateCurrentSpan({ owner, repo, commentId });
			yield* client.request("DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}", {
				owner,
				repo,
				comment_id: commentId,
			});
		}),
	};
};

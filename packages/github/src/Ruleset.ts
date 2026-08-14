import { Context, Effect, Layer } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import { GitHubError } from "./GitHubError.js";
import { Repo } from "./Repo.js";
import type * as Rest from "./Rest.js";

/**
 * A ruleset, as listing returns it.
 *
 * @remarks
 * `source_type` is the field that matters and the one easiest to drop from a
 * projection: a repository's ruleset listing includes rulesets **inherited from
 * the organization**, and they are indistinguishable from the repository's own
 * without it.
 *
 * @public
 */
export interface RulesetInfo {
	readonly id: number;
	readonly name: string;
	/** `"Repository"` for the repository's own, `"Organization"` for an inherited one. */
	readonly source_type?: string | undefined;
}

/**
 * What a ruleset write sends.
 *
 * @remarks
 * `conditions`, `rules` and `bypass_actors` are open records: GitHub's rule
 * vocabulary is large, versioned and expanding, and pinning it here would date
 * the package rather than protect the caller.
 *
 * @public
 */
export interface RulesetPayload {
	readonly name: string;
	readonly target: string;
	readonly enforcement: string;
	readonly conditions?: unknown;
	readonly rules?: unknown;
	readonly bypass_actors?: unknown;
}

/**
 * Repository rulesets, and the lookups their bypass actors need.
 *
 * @public
 */
export interface RulesetShape {
	/**
	 * Create or update a ruleset, matched by name.
	 *
	 * @remarks
	 * A ruleset has **no natural key** on GitHub's side — only a numeric id
	 * assigned at creation — so this matches on `name`. Renaming a ruleset in a
	 * caller's configuration therefore creates a second one rather than renaming
	 * the first; removing the orphan is the caller's cleanup pass.
	 */
	readonly upsert: (payload: RulesetPayload) => Effect.Effect<void, GitHubError, Repo>;
	/** Every ruleset the repository sees, its own and the organization's. */
	readonly list: () => Effect.Effect<ReadonlyArray<RulesetInfo>, GitHubError, Repo>;
	/** Remove one ruleset by id. */
	readonly delete: (rulesetId: number) => Effect.Effect<void, GitHubError, Repo>;

	/**
	 * A team's numeric id, for a bypass actor.
	 *
	 * @remarks
	 * Org-scoped, sourced from `Repo.owner` — the organization that owns the
	 * repository. A team in a *different* organization is not reachable here and
	 * should not be: `Repo` would be lying about the scope.
	 */
	readonly teamId: (slug: string) => Effect.Effect<number, GitHubError, Repo>;
	/** An organization role's numeric id, for a bypass actor. */
	readonly roleId: (name: string) => Effect.Effect<number, GitHubError, Repo>;
}

/** The organization-roles response, which the generated route types do not describe. */
interface OrganizationRoles {
	readonly roles?: ReadonlyArray<{ readonly id: number; readonly name: string }>;
}

/**
 * Repository rulesets.
 *
 * @remarks
 * ## An inherited ruleset is never written to
 *
 * `GET /repos/{owner}/{repo}/rulesets` returns rulesets **inherited from the
 * organization** alongside the repository's own. Matching by name alone lets a
 * repository-scoped call issue a `PUT` against the organization's ruleset id —
 * rewriting policy for **every repository the organization owns**, from a caller
 * that never mentioned the organization.
 *
 * {@link RulesetShape.upsert} filters on `source_type` before matching, so an
 * inherited ruleset can never be the target of a write. This arrived as a fix
 * for a live defect in the consumer this module was ported from, where the
 * filter was absent.
 *
 * @public
 */
export class Ruleset extends Context.Service<Ruleset, RulesetShape>()("@effected/github/Ruleset") {
	/**
	 * @remarks
	 * `(client) => make(client)` rather than `make`: a static initializer runs
	 * while the module body is still evaluating, so naming a `const` declared
	 * further down throws at import time with a clean typecheck.
	 */
	static readonly layer: Layer.Layer<Ruleset, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<RulesetShape> = {}): RulesetShape => ({
		upsert: overrides.upsert ?? (() => unstubbed("upsert")),
		list: overrides.list ?? (() => unstubbed("list")),
		delete: overrides.delete ?? (() => unstubbed("delete")),
		teamId: overrides.teamId ?? (() => unstubbed("teamId")),
		roleId: overrides.roleId ?? (() => unstubbed("roleId")),
	});

	/** {@link Ruleset.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<RulesetShape> = {}): Layer.Layer<Ruleset> =>
		Layer.succeed(Ruleset, Ruleset.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`Ruleset.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

/** An inherited ruleset belongs to the organization and is not this repository's to write. */
const isOwnedByRepository = (ruleset: { readonly source_type?: string | undefined }): boolean =>
	ruleset.source_type !== "Organization";

const make = (client: GitHubClient["Service"]): RulesetShape => {
	const upsert = Effect.fn("Ruleset.upsert")(function* (payload: RulesetPayload) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, ruleset: payload.name });

		// Paginated, and this read is the existence check the create-vs-update
		// decision turns on. A truncated first page would make an existing
		// ruleset invisible past it and turn an update into a create.
		const existing = yield* client.paginate("GET /repos/{owner}/{repo}/rulesets", { owner, repo });

		// Repository-owned only. Without this filter a name match against an
		// inherited ruleset issues a PUT at the organization's id.
		const match = existing.find((ruleset) => ruleset.name === payload.name && isOwnedByRepository(ruleset));

		const body = {
			name: payload.name,
			target: payload.target,
			enforcement: payload.enforcement,
			...(payload.conditions !== undefined ? { conditions: payload.conditions } : {}),
			...(payload.rules !== undefined ? { rules: payload.rules } : {}),
			...(payload.bypass_actors !== undefined ? { bypass_actors: payload.bypass_actors } : {}),
		};

		if (match !== undefined) {
			// The body is an open record by design, so it cannot be narrowed to the
			// route's parameter union. The cast is on the BODY, never the route.
			yield* client.request("PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}", {
				owner,
				repo,
				ruleset_id: match.id,
				...body,
			} as Rest.Params<"PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}">);
			return;
		}

		yield* client.request("POST /repos/{owner}/{repo}/rulesets", {
			owner,
			repo,
			...body,
		} as Rest.Params<"POST /repos/{owner}/{repo}/rulesets">);
	});

	const list = Effect.fn("Ruleset.list")(function* () {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo });

		const rulesets = yield* client.paginate("GET /repos/{owner}/{repo}/rulesets", { owner, repo });
		return rulesets.map(
			(ruleset): RulesetInfo => ({ id: ruleset.id, name: ruleset.name, source_type: ruleset.source_type }),
		);
	});

	const delete_ = Effect.fn("Ruleset.delete")(function* (rulesetId: number) {
		const { owner, repo } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ owner, repo, ruleset_id: rulesetId });

		yield* client.request("DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}", {
			owner,
			repo,
			ruleset_id: rulesetId,
		});
	});

	const teamId = Effect.fn("Ruleset.teamId")(function* (slug: string) {
		const { owner } = yield* Repo;
		// Annotated as `org`, not `owner`: the coordinate is reused and the
		// telemetry should say which meaning is in play.
		yield* Effect.annotateCurrentSpan({ org: owner, team_slug: slug });

		const team = yield* client.request("GET /orgs/{org}/teams/{team_slug}", { org: owner, team_slug: slug });
		return team.id;
	});

	const roleId = Effect.fn("Ruleset.roleId")(function* (name: string) {
		const { owner } = yield* Repo;
		yield* Effect.annotateCurrentSpan({ org: owner, role: name });

		const data = yield* client.request("GET /orgs/{org}/organization-roles", { org: owner });
		const roles = (data as OrganizationRoles).roles ?? [];
		const role = roles.find((candidate) => candidate.name === name);

		if (role === undefined) {
			const available = roles.map((candidate) => candidate.name).join(", ");
			// Listing what WAS available is the difference between a user fixing a
			// typo and a user guessing. Role ids are per-organization even for
			// predefined roles, so the list cannot be hardcoded.
			return yield* GitHubError.notFound(
				"Ruleset.roleId",
				`organization role '${name}' in '${owner}' (available: ${available || "none"})`,
			);
		}

		return role.id;
	});

	return { upsert, list, delete: delete_, teamId, roleId };
};

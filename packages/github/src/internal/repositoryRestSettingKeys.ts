// GENERATED FILE — do not edit by hand.
// Regenerate with: pnpm --filter @effected/github exec tsx lib/scripts/generate-rest-setting-keys.ts
//
// The top-level request-body keys of `PATCH /repos/{owner}/{repo}`, read at
// build time from @octokit/openapi-types@29.0.1 (types.d.ts,
// operations["repos/update"].requestBody.content["application/json"]).
// __test__/repositoryRestSettingKeys.test.ts fails when this file drifts from it.

/**
 * Every key the REST repository PATCH accepts, as GitHub's OpenAPI description declares it.
 *
 * @internal
 */
export const REPOSITORY_REST_SETTING_KEYS: ReadonlySet<string> = new Set([
	"allow_auto_merge",
	"allow_forking",
	"allow_merge_commit",
	"allow_rebase_merge",
	"allow_squash_merge",
	"allow_update_branch",
	"archived",
	"default_branch",
	"delete_branch_on_merge",
	"description",
	"has_issues",
	"has_projects",
	"has_pull_requests",
	"has_wiki",
	"homepage",
	"is_template",
	"merge_commit_message",
	"merge_commit_title",
	"name",
	"private",
	"pull_request_creation_policy",
	"security_and_analysis",
	"squash_merge_commit_message",
	"squash_merge_commit_title",
	"use_squash_pr_title_as_default",
	"visibility",
	"web_commit_signoff_required",
]);

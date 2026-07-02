#!/usr/bin/env bash
# gh-pr-review.sh — GitHub PR review management for Claude Code reviewers
#
# Subcommands:
#   resolve-thread <comment_id> <pr_number> <commit_sha>
#       Reply to a review-comment thread and mark the thread resolved.
#       <comment_id> is the numeric review-comment ID (databaseId).
#
#   minimize-comment <comment_id>
#       Minimize a single issue-comment as OUTDATED.
#
#   minimize-old-summaries <pr_number> <current_sha>
#       Minimize old bot review-summary comments. Excludes the sticky
#       comment (CLAUDE_COMMENT_ID) and any comment that mentions the
#       current commit SHA.
#
#   check-status <commit_sha>
#       Print filtered validation check-run status for the commit. Wraps
#       `gh api ... | jq ...` in a single allowlisted command so the
#       action's bash policy doesn't reject the pipe.
#
#   approve-pr <pr_number> <commit_sha> [body]
#       Submit a formal APPROVE review on the PR. Use only when all
#       previously reported issues are resolved and no new issues exist.
#
# Required environment:
#   GH_TOKEN              GitHub token (App installation token or PAT)
#   GITHUB_REPOSITORY     "owner/repo" (auto under GitHub Actions)
#
# Optional environment:
#   APP_BOT_NAME          Bot login (required for minimize-old-summaries)
#   CLAUDE_COMMENT_ID     Sticky comment ID to exclude from minimization

set -euo pipefail

# -------- helpers --------

err() { echo "Error: $*" >&2; exit 1; }
log() { echo "$*" >&2; }

_owner() {
	local o="${GITHUB_REPOSITORY_OWNER:-}"
	if [[ -z "$o" && -n "${GITHUB_REPOSITORY:-}" ]]; then
		o="${GITHUB_REPOSITORY%%/*}"
	fi
	[[ -z "$o" ]] && err "Cannot determine repo owner; set GITHUB_REPOSITORY"
	echo "$o"
}

_repo() {
	local r=""
	[[ -n "${GITHUB_REPOSITORY:-}" ]] && r="${GITHUB_REPOSITORY##*/}"
	[[ -z "$r" ]] && err "Cannot determine repo name; set GITHUB_REPOSITORY"
	echo "$r"
}

# Run a GraphQL query and check the response for an `errors` array.
# Stdout: response JSON on success.
# Returns 1 (and logs) on transport failure or GraphQL errors.
_graphql() {
	local resp
	if ! resp=$(gh api graphql "$@" 2>&1); then
		log "gh api graphql failed: $resp"
		return 1
	fi
	if echo "$resp" | jq -e '.errors' >/dev/null 2>&1; then
		log "GraphQL errors: $(echo "$resp" | jq -c '.errors')"
		return 1
	fi
	echo "$resp"
}

# Resolve a review-comment databaseId to its containing review-thread node_id.
# Args: owner repo pr_number comment_id
_thread_id_for_comment() {
	local owner="$1" repo="$2" pr="$3" cid="$4"
	local resp tid
	resp=$(_graphql -F owner="$owner" -F repo="$repo" -F pr="$pr" -f query='
		query($owner: String!, $repo: String!, $pr: Int!) {
			repository(owner: $owner, name: $repo) {
				pullRequest(number: $pr) {
					reviewThreads(first: 100) {
						nodes {
							id
							isResolved
							comments(first: 50) { nodes { databaseId } }
						}
					}
				}
			}
		}
	') || return 1
	tid=$(echo "$resp" | jq -r --argjson cid "$cid" '
		.data.repository.pullRequest.reviewThreads.nodes[]
		| select(.comments.nodes[] | .databaseId == $cid)
		| .id
	' | head -n1)
	if [[ -z "$tid" || "$tid" == "null" ]]; then
		log "No review thread found containing comment $cid"
		return 1
	fi
	echo "$tid"
}

# -------- subcommands --------

cmd_resolve_thread() {
	local cid="${1:?comment_id required}"
	local pr="${2:?pr_number required}"
	local sha="${3:?commit_sha required}"
	local owner repo
	owner=$(_owner)
	repo=$(_repo)

	log "resolve-thread: $owner/$repo#$pr comment=$cid sha=${sha:0:7}"

	local reply_body="Issue addressed at commit ${sha:0:7}."
	if ! gh api "repos/$owner/$repo/pulls/$pr/comments/$cid/replies" \
		--method POST -f body="$reply_body" --silent 2>/dev/null; then
		log "Warning: reply to thread failed (may already be resolved)"
	fi

	local tid
	tid=$(_thread_id_for_comment "$owner" "$repo" "$pr" "$cid") || return 1

	_graphql -f threadId="$tid" -f query='
		mutation($threadId: ID!) {
			resolveReviewThread(input: {threadId: $threadId}) {
				thread { isResolved }
			}
		}
	' >/dev/null || return 1

	log "Thread resolved (thread_id=$tid)"
}

cmd_minimize_comment() {
	local cid="${1:?comment_id required}"
	local owner repo node_id
	owner=$(_owner)
	repo=$(_repo)

	node_id=$(gh api "repos/$owner/$repo/issues/comments/$cid" --jq '.node_id' 2>/dev/null) \
		|| err "Failed to look up comment $cid"

	_graphql -f id="$node_id" -f query='
		mutation($id: ID!) {
			minimizeComment(input: {subjectId: $id, classifier: OUTDATED}) {
				minimizedComment { isMinimized }
			}
		}
	' >/dev/null || return 1

	log "Minimized comment $cid"
}

cmd_minimize_old_summaries() {
	local pr="${1:?pr_number required}"
	local sha="${2:?current_sha required}"
	local bot="${APP_BOT_NAME:-}"
	local sticky="${CLAUDE_COMMENT_ID:-0}"
	local owner repo
	owner=$(_owner)
	repo=$(_repo)

	[[ -z "$bot" ]] && err "APP_BOT_NAME env required for minimize-old-summaries"

	log "minimize-old-summaries: $owner/$repo#$pr bot=$bot sticky=$sticky sha=${sha:0:7}"

	local comments
	comments=$(gh api "repos/$owner/$repo/issues/$pr/comments" --paginate) \
		|| err "Failed to list comments"

	local victims
	victims=$(echo "$comments" | jq -r \
		--arg bot "$bot" \
		--arg sha "$sha" \
		--arg sticky "$sticky" '
		.[] | select(
			.user.login == $bot
			and (.body | test("# Code Review|<!-- claude-(code-review|review-sticky:)"))
			and ((.id | tostring) != $sticky)
			and ((.body | contains($sha)) | not)
		) | "\(.id) \(.node_id)"
	')

	if [[ -z "$victims" ]]; then
		log "Nothing to minimize."
		return 0
	fi

	local minimized=0 failed=0 cid node_id
	while IFS=' ' read -r cid node_id; do
		[[ -z "$cid" ]] && continue
		if _graphql -f id="$node_id" -f query='
				mutation($id: ID!) {
					minimizeComment(input: {subjectId: $id, classifier: OUTDATED}) {
						minimizedComment { isMinimized }
					}
				}
			' >/dev/null; then
			minimized=$((minimized + 1))
			log "  Minimized $cid"
		else
			failed=$((failed + 1))
			log "  Failed $cid"
		fi
	done <<< "$victims"

	log "Done: $minimized minimized, $failed failed"
	[[ $failed -gt 0 ]] && return 1
	return 0
}

cmd_check_status() {
	local sha="${1:?commit_sha required}"
	local owner repo
	owner=$(_owner)
	repo=$(_repo)

	log "check-status: $owner/$repo sha=${sha:0:7}"

	# Internal pipe avoids the action's bash policy splitting `gh | jq`.
	gh api "repos/$owner/$repo/commits/$sha/check-runs" --paginate \
		| jq --argjson names '["PR Title Validation","Conventional Commits","Code Quality","Markdown","Tests"]' \
			'.check_runs[] | select([.name] | inside($names)) | {name, status, conclusion, details_url}'
}

cmd_approve_pr() {
	local pr="${1:?pr_number required}"
	local sha="${2:?commit_sha required}"
	local body="${3:-Issues addressed at ${sha:0:7}; approving.}"
	local owner repo
	owner=$(_owner)
	repo=$(_repo)

	log "approve-pr: $owner/$repo#$pr sha=${sha:0:7}"

	gh api "repos/$owner/$repo/pulls/$pr/reviews" \
		--method POST \
		-f event=APPROVE \
		-f body="$body" \
		-f commit_id="$sha" \
		--silent \
		|| err "Failed to submit approval review"

	log "Approval submitted."
}

# -------- dispatch --------

usage() {
	cat >&2 <<'EOF'
gh-pr-review.sh — GitHub PR review management

Usage:
  gh-pr-review.sh resolve-thread         <comment_id> <pr_number> <commit_sha>
  gh-pr-review.sh minimize-comment       <comment_id>
  gh-pr-review.sh minimize-old-summaries <pr_number>  <current_sha>
  gh-pr-review.sh check-status           <commit_sha>
  gh-pr-review.sh approve-pr             <pr_number>  <commit_sha> [body]

Environment:
  GH_TOKEN            required
  GITHUB_REPOSITORY   "owner/repo" (auto under Actions)
  APP_BOT_NAME        required for minimize-old-summaries
  CLAUDE_COMMENT_ID   sticky comment id to exclude from minimization
EOF
	exit 1
}

[[ -z "${GH_TOKEN:-}" ]] && err "GH_TOKEN is required"

cmd="${1:-}"
shift || true
case "$cmd" in
	resolve-thread)         cmd_resolve_thread         "$@" ;;
	minimize-comment)       cmd_minimize_comment       "$@" ;;
	minimize-old-summaries) cmd_minimize_old_summaries "$@" ;;
	check-status)           cmd_check_status           "$@" ;;
	approve-pr)             cmd_approve_pr             "$@" ;;
	"" | -h | --help | help) usage ;;
	*) err "Unknown subcommand: $cmd" ;;
esac

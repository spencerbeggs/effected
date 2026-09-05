#!/usr/bin/env bats
# construct-index-gate.bats — covers scripts/check-construct-index.sh, the
# pre-push gate that stops a stale generated construct index from being pushed.
#
# The gate's characteristic failure is SILENCE. Its first act is to decide
# whether the pushed range can affect the index at all, and if that matcher is
# too narrow the gate skips everything — which is indistinguishable from a gate
# that keeps passing. So the matcher is pinned directly (via the script's
# `--paths` mode, so these tests cannot drift into agreeing with a copy of the
# pattern), and a positive control proves the gate still runs and passes on a
# clean tree.
#
# The three staleness modes (annotations, committed content, copilot mirror)
# are NOT exercised here: doing so means mutating the real tree, and a suite
# that rewrites committed generated files to assert a failure is a worse hazard
# than the one it checks. They were verified by hand-run mutation on
# 2026-09-05 — each blocked with exit 1 and named its fix command.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT="$PLUGIN_ROOT/scripts/check-construct-index.sh"
REPO_ROOT="$(cd "$PLUGIN_ROOT/../.." && pwd)"

_paths() {
	printf '%s\n' "$@" | bash "$SCRIPT" --paths
}

@test "the gate script exists" {
	[ -f "$SCRIPT" ]
}

@test "matcher: a package's source and manifest are relevant" {
	run _paths "packages/semver/src/Version.ts" "packages/semver/package.json"
	[ "$status" -eq 0 ]
	[ "$(grep -c '^yes ' <<<"$output")" -eq 2 ]
}

@test "matcher: the generator and its annotations are relevant" {
	run _paths \
		"plugins/claude-code/scripts/generate-constructs.mts" \
		"plugins/claude-code/scripts/construct-annotations.json"
	[ "$status" -eq 0 ]
	[ "$(grep -c '^yes ' <<<"$output")" -eq 2 ]
}

@test "matcher: the generated index itself is relevant, in BOTH plugins" {
	# The copilot copy matters because the generator does not write it — a
	# hand-edit there is exactly the drift the mirror check exists to catch.
	run _paths \
		"plugins/claude-code/skills/effected-packages/references/constructs/semver.md" \
		"plugins/copilot/skills/effected-packages/references/constructs/semver.md"
	[ "$status" -eq 0 ]
	[ "$(grep -c '^yes ' <<<"$output")" -eq 2 ]
}

@test "matcher: unrelated paths are NOT relevant" {
	# The negative half. Without it the matcher could return yes for everything,
	# which passes every positive test above while making the skip useless.
	run _paths \
		"README.md" \
		"website/docs/en/schemastore/index.mdx" \
		".changeset/floppy-balloons-lick.md" \
		"packages/semver/__test__/version.test.ts" \
		"plugins/claude-code/skills/effect-v4-testing/SKILL.md" \
		".github/workflows/release.yml"
	[ "$status" -eq 0 ]
	[ "$(grep -c '^no ' <<<"$output")" -eq 6 ] || {
		echo "expected all six to be irrelevant:" >&2
		echo "$output" >&2
		return 1
	}
}

@test "matcher: a package's tests are NOT relevant" {
	# Deliberate: the index is generated from the public API surface, which a
	# test file cannot change. Pinned so nobody widens the matcher to all of
	# packages/** and makes every push pay for a build.
	run _paths "packages/semver/__test__/range.test.ts"
	[ "$status" -eq 0 ]
	[[ "$output" == no\ * ]]
}

@test "empty stdin is a silent skip, not a run" {
	# git invokes pre-push with no ref lines when there is nothing to push.
	run bash -c "printf '' | bash '$SCRIPT'"
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "a branch deletion is a silent skip" {
	# git sends an all-zero local sha for a delete; there is nothing to check.
	local zero="0000000000000000000000000000000000000000"
	run bash -c "printf 'refs/heads/gone %s refs/heads/gone %s\n' '$zero' '$(git -C "$REPO_ROOT" rev-parse HEAD)' | bash '$SCRIPT'"
	[ "$status" -eq 0 ]
	[ -z "$output" ]
}

@test "positive control: forced, the gate actually runs and passes on a clean tree" {
	# Without this, every test above is satisfied by a gate that never runs.
	run env CONSTRUCT_INDEX_FORCE=1 bash "$SCRIPT"
	[ "$status" -eq 0 ]
	echo "$output" | grep -qF "construct-index: current." || {
		echo "gate did not report a completed check:" >&2
		echo "$output" >&2
		return 1
	}
}

@test "the pre-push hook invokes the gate" {
	local hook="$REPO_ROOT/.husky/pre-push"
	[ -f "$hook" ]
	grep -qF "check-construct-index.sh" "$hook"
	# Invoked as `bash <script>`: lint-staged strips the exec bit from *.sh at
	# commit time, so the gate must never be executed directly.
	grep -qE 'bash "\$ROOT/plugins/claude-code/scripts/check-construct-index\.sh"' "$hook"
}

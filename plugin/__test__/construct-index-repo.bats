#!/usr/bin/env bats
# construct-index-repo.bats — the committed constructs/ tables are exactly what
# regeneration from this repository's doc models and annotations produces, and
# every value-kind export carries an intent annotation (effected#188).
#
# The doc models are gitignored build output of every package, so this file
# needs a full build. Under CI it runs only in the Construct Index job of
# .github/workflows/slow-tests.yml, which sets EFFECTED_CONSTRUCT_INDEX_JOB
# after building. The Silk workflow's shell-test step skips it: there a source
# change in any package missed the build cache for all of them, and the build
# took about 4.5 of the step's 4.6 minutes on the critical path.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd)"
GEN="$PLUGIN_ROOT/scripts/generate-constructs.mts"

setup_file() {
	if [ -n "${CI:-}" ] && [ -z "${EFFECTED_CONSTRUCT_INDEX_JOB:-}" ]; then
		skip "needs every package's doc model; CI runs it in the Construct Index job"
	fi
	# Generator exit 2 is the missing-doc-model signal and 3 the stale-doc-model
	# one (src/ newer than the model) — provision them; turbo's cache makes the
	# build cheap when nothing changed. Exit 0/1 (ok / annotation problems)
	# need no build.
	local status=0
	node "$GEN" check >/dev/null 2>&1 || status=$?
	if [ "$status" -eq 2 ] || [ "$status" -eq 3 ]; then
		echo "# doc models missing or stale — running pnpm build to provision them" >&3
		(cd "$REPO_ROOT" && pnpm build) >&2 || return 1
	fi
}

@test "repo: committed constructs/ is exactly what regeneration produces" {
	committed="$PLUGIN_ROOT/skills/effected-packages/references/constructs"
	regenerated="$BATS_TEST_TMPDIR/regenerated"
	run node "$GEN" generate --out "$regenerated"
	if [ "$status" -eq 2 ] || [ "$status" -eq 3 ]; then
		echo "doc models missing or stale — run \`pnpm build\` before this suite" >&2
		echo "$output" >&2
		return 1
	fi
	[ "$status" -eq 0 ]
	run diff -ru "$committed" "$regenerated"
	if [ "$status" -ne 0 ]; then
		echo "constructs/ has drifted from the doc models + annotations:" >&2
		echo "$output" >&2
		echo "" >&2
		echo "run: node plugin/scripts/generate-constructs.mts generate  — and commit the result" >&2
		return 1
	fi
}

@test "repo: annotations are complete — every value-kind construct has intent, none are stale" {
	run node "$GEN" check --require-intent
	[ "$status" -eq 0 ]
}

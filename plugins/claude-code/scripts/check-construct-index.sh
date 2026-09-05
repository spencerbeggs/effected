#!/usr/bin/env bash
# check-construct-index.sh — pre-push gate for the generated construct index.
#
# The index (plugins/{claude-code,copilot}/skills/effected-packages/references/
# constructs/*.md) is GENERATED from the api-extractor doc models joined with
# construct-annotations.json. It is committed, so it can go stale three
# independent ways, and this script checks all three:
#
#   1. ANNOTATIONS  — an entry naming a construct that no longer exists, or a
#      value-kind construct with no intent. `generate-constructs.mts check
#      --require-intent` owns this (exit 1).
#   2. CONTENT      — the committed tables no longer match what a regeneration
#      produces, because a package's public surface moved. Caught by
#      regenerating into a temp dir and diffing.
#   3. MIRROR       — the generator writes ONLY the claude-code copy; the
#      copilot copy is mirrored by hand and has silently lagged before (it sat
#      two constructs behind on tsconfig-json). Caught by diffing the two trees.
#
# Runs on pre-push rather than pre-commit deliberately: check 2 needs the doc
# models, which are gitignored build output, so a cold run costs a `pnpm build`.
# That is too slow per-commit and fine per-push — and the hook skips entirely
# when the pushed range touches nothing that can affect the index.
#
# Exit 0 pass or skip; 1 stale (with the fix command); 2 could not check.

set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
	echo "construct-index: not a git repo; skipping" >&2
	exit 0
}
cd "$ROOT" || exit 2

GEN="plugins/claude-code/scripts/generate-constructs.mts"
CC_DIR="plugins/claude-code/skills/effected-packages/references/constructs"
CO_DIR="plugins/copilot/skills/effected-packages/references/constructs"
ANNOTATIONS="plugins/claude-code/scripts/construct-annotations.json"

# Paths whose change can invalidate the index. A push touching none of them
# cannot make the tables stale, so the whole gate is skipped.
#
# This matcher is the gate's most dangerous line: too narrow and stale tables
# sail through, and the symptom is silence — a gate that never fires looks
# exactly like a gate that always passes. `--paths` exposes it directly so a
# test can pin it without re-declaring the pattern (which would then drift
# alongside it and agree with itself).
is_relevant() {
	grep -qE "^(packages/[^/]+/(src/|package\.json)|plugins/claude-code/scripts/|plugins/(claude-code|copilot)/skills/effected-packages/references/constructs/)" <<<"$1"
}

# --paths: read newline-separated paths on stdin, print "yes <path>" / "no <path>".
if [ "${1:-}" = "--paths" ]; then
	while IFS= read -r p; do
		[ -z "$p" ] && continue
		if is_relevant "$p"; then echo "yes $p"; else echo "no $p"; fi
	done
	exit 0
fi

# --- decide whether to run -------------------------------------------------
# git feeds pre-push "<local ref> <local sha> <remote ref> <remote sha>" lines.
# With no stdin (manual invocation) check the working tree against HEAD's
# upstream, falling back to "always run".
CHANGED=""
if [ -n "${CONSTRUCT_INDEX_FORCE:-}" ]; then
	CHANGED="FORCED"
elif [ ! -t 0 ]; then
	ZERO="0000000000000000000000000000000000000000"
	while read -r _local_ref local_sha _remote_ref remote_sha; do
		[ -z "${local_sha:-}" ] && continue
		# Branch deletion: nothing to check.
		[ "$local_sha" = "$ZERO" ] && continue
		if [ "${remote_sha:-$ZERO}" = "$ZERO" ]; then
			# New branch: diff against the default branch if we have it.
			base="$(git merge-base "$local_sha" origin/main 2>/dev/null || true)"
			[ -z "$base" ] && base="$(git merge-base "$local_sha" main 2>/dev/null || true)"
			range="${base:+$base..}$local_sha"
		else
			range="$remote_sha..$local_sha"
		fi
		CHANGED="$CHANGED$(git diff --name-only "$range" 2>/dev/null || git show --name-only --format= "$local_sha" 2>/dev/null)"$'\n'
	done
fi

if [ -z "$CHANGED" ]; then
	exit 0
fi

if [ "$CHANGED" != "FORCED" ]; then
	relevant=0
	while IFS= read -r file; do
		[ -z "$file" ] && continue
		if is_relevant "$file"; then
			relevant=1
			break
		fi
	done <<<"$CHANGED"
	[ "$relevant" -eq 1 ] || exit 0
fi

echo "construct-index: verifying the generated index is current..." >&2

# --- 1. annotations, and provision the doc models if absent ----------------
out="$(node "$GEN" check --require-intent 2>&1)"
status=$?

if [ "$status" -eq 2 ]; then
	echo "construct-index: doc models absent — building (turbo-cached)..." >&2
	if ! pnpm build >/dev/null 2>&1; then
		echo "construct-index: pnpm build failed; cannot verify the index." >&2
		echo "  Run 'pnpm build' and read its output." >&2
		exit 2
	fi
	out="$(node "$GEN" check --require-intent 2>&1)"
	status=$?
fi

if [ "$status" -ne 0 ]; then
	echo >&2
	echo "construct-index: annotation problems — push blocked." >&2
	echo "$out" >&2
	echo >&2
	echo "  Fix $ANNOTATIONS:" >&2
	echo "    - a 'stale annotation' entry names a construct that no longer exists; delete it" >&2
	echo "    - a 'missing intent' entry is a new export; add its one-line intent" >&2
	exit 1
fi

# --- 2. committed content matches a regeneration ---------------------------
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! node "$GEN" generate --out "$tmp" >/dev/null 2>&1; then
	echo "construct-index: regeneration failed; cannot verify the index." >&2
	exit 2
fi

if ! diff -rq "$CC_DIR" "$tmp" >/dev/null 2>&1; then
	echo >&2
	echo "construct-index: the committed index is STALE — push blocked." >&2
	diff -rq "$CC_DIR" "$tmp" 2>&1 | sed 's/^/  /' >&2
	echo >&2
	echo "  Regenerate and commit:" >&2
	echo "    node $GEN generate" >&2
	echo "    cp $CC_DIR/*.md $CO_DIR/" >&2
	exit 1
fi

# --- 3. the copilot mirror is in sync --------------------------------------
# The generator writes claude-code only; copilot is mirrored by hand.
if ! diff -rq "$CC_DIR" "$CO_DIR" >/dev/null 2>&1; then
	echo >&2
	echo "construct-index: the copilot mirror is OUT OF SYNC — push blocked." >&2
	diff -rq "$CC_DIR" "$CO_DIR" 2>&1 | sed 's/^/  /' >&2
	echo >&2
	echo "  The generator only writes the claude-code copy. Mirror it:" >&2
	echo "    cp $CC_DIR/*.md $CO_DIR/" >&2
	exit 1
fi

echo "construct-index: current." >&2
exit 0

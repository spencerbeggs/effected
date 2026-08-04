#!/usr/bin/env bats
# construct-coverage.bats — pins that every export a phase-1 package ships is
# named SOMEWHERE under plugin/skills/, not merely that a references/ file
# exists for the package.
#
# This exists because effected#188's failure mode is real and was reproduced
# twice more during the round-1 skills audit this file closes out: a
# hand-maintained package index silently drifts from the source it describes
# (effected-packages' own "seven rows lack references/" callout was already
# stale the day it was read; npm.md silently dropped two whole modules that
# exist in the same index.ts it mirrors). A generated pass over the actual
# export lists is what turns "did we forget a construct" from a judgment call
# into something this file either does or does not catch.
#
# Phase 1 scope: the six packages the round-1 audit spot-checked
# (github-actions, github, commands, npm, schemastore, jsonl) — proving this
# check's signal-to-noise before widening to all 27 packages in the kit.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_ROOT/.." && pwd)"
SKILLS_DIR="$PLUGIN_ROOT/skills"
ALLOW_FILE="$PLUGIN_ROOT/__test__/construct-coverage.allow"

PHASE1_PACKAGES="github-actions github commands npm schemastore jsonl"

# _exported_identifiers index_ts — every top-level exported identifier: named
# exports from `export { A, B }` / `export type { A, B }` blocks (possibly
# spanning multiple lines, `as`-renamed to the RIGHT-hand name — that is the
# name a consumer imports), plus `export const|class|interface|function|type
# NAME` declarations.
_exported_identifiers() {
	local file="$1"
	{
		awk '
			/^export (type )?\{/ { inblock = 1; buf = ""; }
			inblock          { buf = buf $0 "\n"; }
			inblock && /\}/  { inblock = 0; printf "%s", buf; }
		' "$file" \
			| sed -E 's/^export (type )?\{//; s/\}.*$//' \
			| tr ',' '\n' \
			| sed -E 's/^[[:space:]]*type[[:space:]]+//; s/^[[:space:]]+//; s/[[:space:]]+$//' \
			| sed -E 's/.* as ([A-Za-z_$][A-Za-z0-9_$]*)$/\1/' \
			| grep -E '^[A-Za-z_$][A-Za-z0-9_$]*$'

		grep -E '^export (const|class|interface|function|type|abstract class) [A-Za-z_$][A-Za-z0-9_$]*' "$file" \
			| sed -E 's/^export (const|class|interface|function|type|abstract class) ([A-Za-z_$][A-Za-z0-9_$]*).*/\2/'
	} | sort -u
}

# _is_allowed identifier — true if the identifier is listed (as a whole
# line, ignoring comments and blanks) in construct-coverage.allow.
_is_allowed() {
	grep -qxF -- "$1" <(grep -vE '^[[:space:]]*(#|$)' "$ALLOW_FILE")
}

# _is_mentioned identifier — true if the identifier appears as a whole word
# anywhere under plugin/skills/**/*.md. Deliberately generous: this is a
# coverage floor ("was it ever named"), not a quality check.
_is_mentioned() {
	grep -rqw -- "$1" "$SKILLS_DIR"
}

@test "every phase-1 package's exports are named somewhere in skills/, or allow-listed" {
	local failures=""
	for pkg in $PHASE1_PACKAGES; do
		local index="$REPO_ROOT/packages/$pkg/src/index.ts"
		[ -f "$index" ] || {
			echo "no src/index.ts for package $pkg — update PHASE1_PACKAGES or the package moved" >&2
			return 1
		}
		while IFS= read -r ident; do
			[ -n "$ident" ] || continue
			_is_allowed "$ident" && continue
			_is_mentioned "$ident" && continue
			failures="$failures\n  $pkg: $ident"
		done < <(_exported_identifiers "$index")
	done
	if [ -n "$failures" ]; then
		echo "exported identifiers with zero mentions under plugin/skills/ and no allow-list entry:" >&2
		echo -e "$failures" >&2
		echo "" >&2
		echo "either name the construct in the skill that owns its neighboring material, or add it to construct-coverage.allow with a one-line reason." >&2
		return 1
	fi
}

@test "construct-coverage.allow carries no stale entry that is actually mentioned now" {
	# An allow-list entry that has since been documented is not wrong to leave
	# — but leaving it un-pruned is exactly how a suppression list quietly
	# stops meaning anything. This does not fail the build; it reports so a
	# human prunes deliberately rather than the check silently degrading.
	local stale=""
	while IFS= read -r ident; do
		[ -n "$ident" ] || continue
		if _is_mentioned "$ident"; then
			stale="$stale\n  $ident"
		fi
	done < <(grep -vE '^[[:space:]]*(#|$)' "$ALLOW_FILE")
	if [ -n "$stale" ]; then
		echo "allow-listed identifiers that ARE now mentioned in skills/ — consider pruning:" >&2
		echo -e "$stale" >&2
	fi
	# Informational only: always passes. Bats has no native "warn" status.
	true
}

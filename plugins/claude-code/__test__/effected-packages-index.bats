#!/usr/bin/env bats
# effected-packages-index.bats — pins the mechanically-derivable claims in
# skills/effected-packages/SKILL.md against the actual workspace.
#
# Why this file exists (issue #496): the SKILL closes by warning that construct
# coverage "is checked, not maintained by hand here", explicitly because "a
# hand-maintained claim of completeness drifts the same way this file's own
# stale reference-file count once did." At the moment an audit read that
# sentence, the same file was wrong in three places at once — package count,
# a per-package member count, and the publish state. A self-aware warning
# naming the exact failure mode, sitting inside an instance of it.
#
# So: everything here is derived from the tree, never asserted by hand.
#
# WHAT THIS CANNOT CATCH, and why it is worth writing down rather than
# pretending otherwise:
#   - A row whose PROSE is wrong. "What it contains" and "Reach for it when"
#     are editorial; no check can tell a stale description from a fresh one.
#   - A wrong TIER. pure/boundary/integrated is a judgement about what a
#     dependency costs you, derivable only by reading the package's deps and
#     deciding — which is the judgement itself, not a check of it.
#   - A reference file that EXISTS but documents an API the package no longer
#     has. Existence is mechanical; accuracy is not. The construct index
#     (construct-index.bats) covers exported-symbol drift; prose drift stays a
#     human problem.
# Treat a green run here as "the countable claims are true", never as "the
# skill is accurate".

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_ROOT/../.." && pwd)"
SKILL="$PLUGIN_ROOT/skills/effected-packages/SKILL.md"
REFERENCES="$PLUGIN_ROOT/skills/effected-packages/references"

# _public_packages — every workspace package that actually publishes, by name.
# publishConfig.access === "public" is the repo's definition of publishable;
# the source manifests are all "private": true, so `private` says nothing.
_public_packages() {
	local manifest
	for manifest in "$REPO_ROOT"/packages/*/package.json; do
		node -e '
			const d = require(process.argv[1]);
			if (d.publishConfig && d.publishConfig.access === "public") console.log(d.name);
		' "$manifest"
	done | sort
}

# _router_rows — the package name from each row of the Index table, i.e. every
# `@effected/x` in a leading `| \`@effected/x\` |` cell.
_router_rows() {
	grep -oE '^\| `@effected/[a-z0-9-]+`' "$SKILL" |
		sed -E 's/^\| `//; s/`$//' | sort
}

@test "the stated package count matches the publishable packages on disk" {
	local actual stated
	actual="$(_public_packages | wc -l | tr -d ' ')"

	# The count is stated in the body as "N packages (M libraries plus ...)".
	stated="$(grep -oE 'kit: [0-9]+ packages' "$SKILL" | grep -oE '[0-9]+' | head -1)"

	[ -n "$stated" ] || {
		echo "could not find a 'kit: N packages' claim in $SKILL" >&2
		return 1
	}
	[ "$stated" = "$actual" ] || {
		echo "SKILL claims $stated packages; the workspace publishes $actual" >&2
		_public_packages >&2
		return 1
	}
}

@test "the frontmatter description states the same count as the body" {
	# Two hand-maintained copies of one number is exactly how the last drift
	# happened: the body was corrected and the description was not.
	local body desc
	body="$(grep -oE 'kit: [0-9]+ packages' "$SKILL" | grep -oE '[0-9]+' | head -1)"
	desc="$(sed -n '1,/^---$/!d;p' "$SKILL" | grep -oE "kit's [0-9]+ packages" | grep -oE '[0-9]+' | head -1)"
	if [ -z "$desc" ]; then
		desc="$(grep -m1 -oE "kit's [0-9]+ packages" "$SKILL" | grep -oE '[0-9]+')"
	fi

	[ -n "$desc" ] || {
		echo "could not find a \"kit's N packages\" claim in the frontmatter description" >&2
		return 1
	}
	[ "$desc" = "$body" ] || {
		echo "frontmatter says $desc packages, body says $body" >&2
		return 1
	}
}

@test "every publishable package has a router row" {
	local missing=0 pkg
	while read -r pkg; do
		[ -n "$pkg" ] || continue
		_router_rows | grep -qxF "$pkg" || {
			echo "no router row for publishable package: $pkg" >&2
			missing=1
		}
	done < <(_public_packages)
	[ "$missing" -eq 0 ]
}

@test "every router row names a package that exists and publishes" {
	local orphan=0 pkg
	while read -r pkg; do
		[ -n "$pkg" ] || continue
		_public_packages | grep -qxF "$pkg" || {
			echo "router row names a package that does not publish (or does not exist): $pkg" >&2
			orphan=1
		}
	done < <(_router_rows)
	[ "$orphan" -eq 0 ]
}

@test "every router row links a reference file that exists" {
	local missing=0 pkg short
	while read -r pkg; do
		[ -n "$pkg" ] || continue
		short="${pkg#@effected/}"
		[ -f "$REFERENCES/$short.md" ] || {
			echo "missing reference file for $pkg: references/$short.md" >&2
			missing=1
		}
	done < <(_router_rows)
	[ "$missing" -eq 0 ]
}

@test "every reference file is reachable from a router row" {
	# The other direction — the audit that produced #496 found drift both ways.
	local orphan=0 file short
	for file in "$REFERENCES"/*.md; do
		short="$(basename "$file" .md)"
		_router_rows | grep -qxF "@effected/$short" || {
			echo "orphan reference file with no router row: references/$short.md" >&2
			orphan=1
		}
	done
	[ "$orphan" -eq 0 ]
}

@test "the index does not claim an unpublished package" {
	# The stale claim was "28 of 29 published; cli pending its first release".
	# Any surviving "N of M published" or "pending its first release" phrasing
	# is a hand-maintained publish-state claim, and this repo has none to make.
	! grep -qiE "pending its first release|[0-9]+ of [0-9]+ published" "$SKILL" || {
		echo "SKILL still carries a hand-maintained publish-state claim:" >&2
		grep -niE "pending its first release|[0-9]+ of [0-9]+ published" "$SKILL" >&2
		return 1
	}
}

@test "positive control: the row extractor actually finds rows" {
	# Guard every assertion above against a silently-empty extractor, which
	# would make all of them vacuously pass.
	local rows packages
	rows="$(_router_rows | wc -l | tr -d ' ')"
	packages="$(_public_packages | wc -l | tr -d ' ')"
	[ "$rows" -ge 25 ] || {
		echo "router extractor found only $rows rows — the table format probably changed" >&2
		return 1
	}
	[ "$packages" -ge 25 ] || {
		echo "package scan found only $packages publishable packages" >&2
		return 1
	}
}

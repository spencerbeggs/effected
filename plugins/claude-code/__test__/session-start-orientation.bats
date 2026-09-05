#!/usr/bin/env bats
# session-start-orientation.bats — covers hooks/session-start/orientation.sh,
# the plugin's only hook script.
#
# The script has exactly three behaviors worth pinning: (1) the happy path —
# jq present, envelope drained, additionalContext emitted with the full
# briefing including every skill name; (2) the jq-missing fallback — fails
# open with emit_noop rather than blocking; (3) the stdin drain — the script
# never inspects its envelope, so an oversized or malformed stdin payload
# must not make it hang or error.
#
# Every invocation sources the real hook-output.sh lib via CLAUDE_PLUGIN_ROOT,
# the same resolution path a live Claude Code session uses, under set -euo
# pipefail — the same mode the script itself runs in.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT="$PLUGIN_ROOT/hooks/session-start/orientation.sh"
FIXTURES="$PLUGIN_ROOT/hooks/fixtures"

# _run_hook envelope_file [path_override] [project_dir] — invokes the hook with
# a clean environment (env -i) plus only what a real dispatch provides: stdin,
# cwd, CLAUDE_PLUGIN_ROOT and CLAUDE_PROJECT_DIR. PATH defaults to the real one
# (jq present); pass an override to simulate jq being absent. project_dir
# defaults to the plugin's own repo, which vendors Effect at the current pin.
_run_hook() {
	local envelope="$1"
	local path_override="${2:-$PATH}"
	local project_dir="${3:-}"
	if [ -n "$project_dir" ]; then
		env -i \
			PATH="$path_override" \
			CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
			CLAUDE_PROJECT_DIR="$project_dir" \
			bash "$SCRIPT" <"$envelope"
	else
		env -i \
			PATH="$path_override" \
			CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
			bash "$SCRIPT" <"$envelope"
	fi
}

# The pin the hook advertises. Kept in sync with EFFECT_PIN in the hook itself;
# a mismatch here is the point — it fails the "advertised pin" test below and
# forces the bump to be deliberate.
EXPECTED_PIN="4.0.0-rc.112"

# _ctx_of output — extract additionalContext from a hook response.
_ctx_of() {
	echo "$1" | jq -r '.hookSpecificOutput.additionalContext'
}

@test "happy path: emits a valid SessionStart hookSpecificOutput envelope" {
	run _run_hook "$FIXTURES/sessionstart.startup.json"
	[ "$status" -eq 0 ]

	echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"'
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext | length > 0'
}

@test "happy path: additionalContext names every skill on disk" {
	run _run_hook "$FIXTURES/sessionstart.startup.json"
	[ "$status" -eq 0 ]

	local ctx
	ctx="$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')"
	local found=0
	for skill_dir in "$PLUGIN_ROOT"/skills/*/; do
		local skill
		skill="$(basename "$skill_dir")"
		echo "$ctx" | grep -qF -- "- $skill" || {
			echo "missing skill bullet: $skill" >&2
			return 1
		}
		found=$((found + 1))
	done
	# Guard against a silently-empty glob reading as a pass. Derived from the
	# tree rather than hand-maintained: a `-ge <N>` floor pins the same claim
	# but has to be lowered by hand on every skill deletion, which is a magic
	# number that drifts (it was still 30 after the construct-map removal, and
	# failed for the right reason but the wrong one).
	local on_disk
	on_disk="$(find "$PLUGIN_ROOT/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
	[ "$found" -eq "$on_disk" ] && [ "$on_disk" -gt 0 ] || {
		echo "walked $found skills but $on_disk exist on disk" >&2
		return 1
	}
}

@test "happy path: additionalContext names every agent on disk" {
	run _run_hook "$FIXTURES/sessionstart.startup.json"
	[ "$status" -eq 0 ]

	local ctx
	ctx="$(_ctx_of "$output")"
	local found=0
	for agent_file in "$PLUGIN_ROOT"/agents/*.md; do
		local agent
		agent="$(basename "$agent_file" .md)"
		echo "$ctx" | grep -qF -- "- $agent" || {
			echo "missing agent bullet: $agent" >&2
			return 1
		}
		found=$((found + 1))
	done
	# Derived from the tree, not a hand-maintained floor -- see the skill test.
	local on_disk
	on_disk="$(find "$PLUGIN_ROOT/agents" -mindepth 1 -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
	[ "$found" -eq "$on_disk" ] && [ "$on_disk" -gt 0 ] || {
		echo "walked $found agents but $on_disk exist on disk" >&2
		return 1
	}
}

@test "the v3 migration framing is retired: no migrator agent, no v3 guidance" {
	run _run_hook "$FIXTURES/sessionstart.startup.json"
	[ "$status" -eq 0 ]

	local ctx
	ctx="$(_ctx_of "$output")"

	# The migrator agent and the construct-map skill are gone from the roster.
	! echo "$ctx" | grep -qF -- "- effect-migrator" || {
		echo "effect-migrator is still advertised" >&2
		return 1
	}
	! echo "$ctx" | grep -qF -- "- effect-v4-construct-map" || {
		echo "effect-v4-construct-map is still advertised" >&2
		return 1
	}
	# No migration framing survives anywhere in the briefing.
	! echo "$ctx" | grep -qiE "v3.{0,3}(to|→|->).{0,3}v4|migration checklist|porting a v3" || {
		echo "v3 migration framing still present in the briefing" >&2
		return 1
	}
}

@test "do-not-guess: the briefing tells the agent to delegate rather than recall" {
	run _run_hook "$FIXTURES/sessionstart.startup.json"
	[ "$status" -eq 0 ]

	local ctx
	ctx="$(_ctx_of "$output")"
	echo "$ctx" | grep -qF "<do_not_guess>"
	echo "$ctx" | grep -qF "effect-developer"
	echo "$ctx" | grep -qiF "out of date"
}

@test "vendored source: a matching pin is reported as authoritative" {
	run _run_hook "$FIXTURES/sessionstart.startup.json"
	[ "$status" -eq 0 ]

	local ctx
	ctx="$(_ctx_of "$output")"
	echo "$ctx" | grep -qF "pinned to"
	echo "$ctx" | grep -qF "effect@$EXPECTED_PIN"
	echo "$ctx" | grep -qF "matches the kit's current pin"
}

@test "vendored source: no .gitmodules asks the agent to vendor Effect" {
	local proj
	proj="$(mktemp -d)"

	run _run_hook "$FIXTURES/sessionstart.startup.json" "$PATH" "$proj"
	rm -rf "$proj"

	[ "$status" -eq 0 ]
	local ctx
	ctx="$(_ctx_of "$output")"
	echo "$ctx" | grep -qF "NO .gitmodules"
	echo "$ctx" | grep -qF "effect@$EXPECTED_PIN"
	echo "$ctx" | grep -qF "/silk:repos"
}

@test "vendored source: a .gitmodules without an effect entry asks for one" {
	local proj
	proj="$(mktemp -d)"
	printf '[submodule "vendor/other"]\n\tpath = vendor/other\n' >"$proj/.gitmodules"

	run _run_hook "$FIXTURES/sessionstart.startup.json" "$PATH" "$proj"
	rm -rf "$proj"

	[ "$status" -eq 0 ]
	local ctx
	ctx="$(_ctx_of "$output")"
	echo "$ctx" | grep -qF "NO .repos/effect entry"
	echo "$ctx" | grep -qF "effect@$EXPECTED_PIN"
}

@test "vendored source: a stale pin demands a re-pin and names both refs" {
	local proj
	proj="$(mktemp -d)"
	local vendor_dir="$proj/.repos"
	printf '[submodule ".repos/effect"]\n\tpath = .repos/effect\n' >"$proj/.gitmodules"
	mkdir -p "$vendor_dir"
	printf '{"repos":{"effect":{"ref":"effect@4.0.0-rc.109"}}}\n' >"$vendor_dir/config.json"

	run _run_hook "$FIXTURES/sessionstart.startup.json" "$PATH" "$proj"
	rm -rf "$proj"

	[ "$status" -eq 0 ]
	local ctx
	ctx="$(_ctx_of "$output")"
	# Names the stale ref, the wanted ref, and makes the re-pin mandatory.
	echo "$ctx" | grep -qF "effect@4.0.0-rc.109"
	echo "$ctx" | grep -qF "effect@$EXPECTED_PIN"
	echo "$ctx" | grep -qF "MUST"
}

@test "vendored source: an effect entry with no config.json still demands a re-pin" {
	local proj
	proj="$(mktemp -d)"
	printf '[submodule ".repos/effect"]\n\tpath = .repos/effect\n' >"$proj/.gitmodules"

	run _run_hook "$FIXTURES/sessionstart.startup.json" "$PATH" "$proj"
	rm -rf "$proj"

	[ "$status" -eq 0 ]
	local ctx
	ctx="$(_ctx_of "$output")"
	echo "$ctx" | grep -qF "unknown"
	echo "$ctx" | grep -qF "MUST"
}

@test "every branch emits exactly one JSON object" {
	# A hook that prints anything alongside its payload is rejected wholesale by
	# Claude Code ("looks like a JSON object but is not valid JSON"), so pin that
	# each branch writes a single object and nothing else.
	local proj_none proj_stale
	proj_none="$(mktemp -d)"
	proj_stale="$(mktemp -d)"
	printf '[submodule ".repos/effect"]\n\tpath = .repos/effect\n' >"$proj_stale/.gitmodules"

	local dir
	for dir in "" "$proj_none" "$proj_stale"; do
		run _run_hook "$FIXTURES/sessionstart.startup.json" "$PATH" "$dir"
		[ "$status" -eq 0 ]
		# jq -e over the whole stream: a second object makes this fail.
		echo "$output" | jq -es 'length == 1' >/dev/null || {
			echo "expected exactly one JSON object for project dir '$dir'" >&2
			echo "$output" >&2
			return 1
		}
	done
	rm -rf "$proj_none" "$proj_stale"
}

@test "jq-missing fallback: fails open with emit_noop, does not block" {
	local fakebin
	fakebin="$(mktemp -d)"
	ln -s "$(command -v cat)" "$fakebin/cat"
	ln -s "$(command -v bash)" "$fakebin/bash"

	run _run_hook "$FIXTURES/sessionstart.resume.json" "$fakebin"
	rm -rf "$fakebin"

	[ "$status" -eq 0 ]
	[ "$output" = "{}" ]
}

@test "stdin drain: an oversized envelope does not hang or error" {
	local big
	big="$(mktemp)"
	head -c 2000000 /dev/zero | tr '\0' 'x' >"$big"

	run _run_hook "$big"
	rm -f "$big"

	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"'
}

@test "stdin drain: an empty envelope does not hang or error" {
	local empty
	empty="$(mktemp)"

	run _run_hook "$empty"
	rm -f "$empty"

	[ "$status" -eq 0 ]
	echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"'
}

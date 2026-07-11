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

# _run_hook envelope_file [path_override] — invokes the hook with a clean
# environment (env -i) plus only what a real dispatch provides: stdin, cwd,
# and CLAUDE_PLUGIN_ROOT. PATH defaults to the real one (jq present); pass an
# override to simulate jq being absent.
_run_hook() {
	local envelope="$1"
	local path_override="${2:-$PATH}"
	env -i \
		PATH="$path_override" \
		CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
		bash "$SCRIPT" <"$envelope"
}

@test "happy path: emits a valid SessionStart hookSpecificOutput envelope" {
	run _run_hook "$FIXTURES/sessionstart.startup.json"
	[ "$status" -eq 0 ]

	echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"'
	echo "$output" | jq -e '.hookSpecificOutput.additionalContext | length > 0'
}

@test "happy path: additionalContext names all eleven skills" {
	run _run_hook "$FIXTURES/sessionstart.startup.json"
	[ "$status" -eq 0 ]

	local ctx
	ctx="$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')"
	for skill in \
		effect-v4-planning \
		effect-v4-source-lookup \
		effect-v4-schema \
		effect-v4-services-layers \
		effect-v4-idioms \
		effect-v4-cli \
		effect-v4-observability \
		effect-v4-testing \
		effect-v4-construct-map \
		effect-api-extractor-bases \
		hardening-a-parser-port; do
		echo "$ctx" | grep -qF -- "- $skill" || {
			echo "missing skill bullet: $skill" >&2
			return 1
		}
	done
}

@test "happy path: additionalContext names all three agents" {
	run _run_hook "$FIXTURES/sessionstart.startup.json"
	[ "$status" -eq 0 ]

	local ctx
	ctx="$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')"
	for agent in effect-developer effect-reviewer effect-migrator; do
		echo "$ctx" | grep -qF -- "- $agent" || {
			echo "missing agent bullet: $agent" >&2
			return 1
		}
	done
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

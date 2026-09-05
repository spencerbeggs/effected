#!/usr/bin/env bats
# copilot-session-start.bats — covers plugins/copilot/hooks/session-start/orientation.sh.
#
# Lives under claude-code/__test__/ because `pnpm test:bats` runs
# `bats --recursive plugins` and this is the only bats tree; the subject is the
# copilot hook, resolved by relative path below.
#
# Copilot's hook contract differs from Claude Code's in two ways that this file
# exists to pin, because they are easy to "align" by mistake:
#
#   1. The output object is FLAT — `{ additionalContext }` — not Claude Code's
#      `{ hookSpecificOutput: { hookEventName, additionalContext } }`.
#   2. There is NO project-root environment variable. Copilot exposes
#      COPILOT_HOME (the user hooks directory) and, on the cloud agent,
#      GITHUB_COPILOT_*/COPILOT_AGENT_PROMPT — none of them a project path. The
#      repo root is therefore derived from the envelope's `cwd` field, walked up
#      to the nearest `.gitmodules`/`.git`. So this hook must READ stdin, where
#      the Claude Code one may drain it.
#
# The no-stderr assertions are not incidental: the briefing is emitted through
# an INTERPOLATING heredoc (it has to expand ${VENDOR_NOTE}), so every backtick
# and `$` in the briefing body must be escaped. An unescaped backtick executes
# as a command substitution — it still yields valid JSON, but with the backticked
# span silently replaced by that command's output. That regression is invisible
# in a JSON-validity check and only shows up as stderr noise, which is why these
# tests assert stderr is empty.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../copilot" && pwd)"
SCRIPT="$PLUGIN_ROOT/hooks/session-start/orientation.sh"

EXPECTED_PIN="4.0.0-rc.112"

# _run_copilot cwd [path_override] — feed a sessionStart envelope naming `cwd`.
_run_copilot() {
	local cwd="$1"
	local path_override="${2:-$PATH}"
	printf '{"sessionId":"t","timestamp":1,"cwd":"%s","source":"startup"}' "$cwd" |
		env -i PATH="$path_override" COPILOT_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT"
}

_ctx_of() {
	echo "$1" | jq -r '.additionalContext'
}

@test "the hook script exists and is the copilot copy" {
	[ -f "$SCRIPT" ]
}

@test "output is a single FLAT object with additionalContext, not Claude Code's shape" {
	run _run_copilot "$PLUGIN_ROOT"
	[ "$status" -eq 0 ]

	# Exactly one object on the stream.
	echo "$output" | jq -es 'length == 1' >/dev/null
	# Flat: additionalContext at the top level, and NO hookSpecificOutput.
	echo "$output" | jq -e 'has("additionalContext")' >/dev/null
	echo "$output" | jq -e 'has("hookSpecificOutput") | not' >/dev/null
	echo "$output" | jq -e '.additionalContext | length > 0' >/dev/null
}

@test "the briefing's backticks survive the interpolating heredoc" {
	local out err
	err="$(mktemp)"
	out="$(_run_copilot "$PLUGIN_ROOT" 2>"$err")"

	# An unescaped backtick would run as a command substitution and complain here.
	[ ! -s "$err" ] || {
		echo "hook wrote to stderr (unescaped backtick or \$ in the heredoc):" >&2
		cat "$err" >&2
		rm -f "$err"
		return 1
	}
	rm -f "$err"

	local ctx
	ctx="$(_ctx_of "$out")"
	# Literal backticked spans must still be present as text.
	echo "$ctx" | grep -qF -- '`effect`'
	echo "$ctx" | grep -qF -- '`gh issue create'
}

@test "vendored source: a matching pin is reported as authoritative" {
	# The repo this test runs in vendors Effect at the current pin.
	run _run_copilot "$PLUGIN_ROOT"
	[ "$status" -eq 0 ]

	local ctx
	ctx="$(_ctx_of "$output")"
	echo "$ctx" | grep -qF "effect@$EXPECTED_PIN"
	echo "$ctx" | grep -qF "matches the kit's current pin"
}

@test "vendored source: cwd is walked UP to the repo root" {
	# Copilot hands cwd, not the project root, so a nested cwd must still resolve
	# the repo's own .gitmodules rather than reporting "vendors nothing".
	local deep="$PLUGIN_ROOT/hooks/session-start"
	run _run_copilot "$deep"
	[ "$status" -eq 0 ]

	local ctx
	ctx="$(_ctx_of "$output")"
	echo "$ctx" | grep -qF "matches the kit's current pin" || {
		echo "did not walk up from $deep to the repo root" >&2
		return 1
	}
}

@test "vendored source: no .gitmodules asks the agent to vendor Effect" {
	local proj
	proj="$(mktemp -d)"

	run _run_copilot "$proj"
	rm -rf "$proj"

	[ "$status" -eq 0 ]
	local ctx
	ctx="$(_ctx_of "$output")"
	echo "$ctx" | grep -qF "NO .gitmodules"
	echo "$ctx" | grep -qF "effect@$EXPECTED_PIN"
}

@test "vendored source: a .gitmodules without an effect entry asks for one" {
	local proj
	proj="$(mktemp -d)"
	printf '[submodule "vendor/other"]\n\tpath = vendor/other\n' >"$proj/.gitmodules"

	run _run_copilot "$proj"
	rm -rf "$proj"

	[ "$status" -eq 0 ]
	local ctx
	ctx="$(_ctx_of "$output")"
	echo "$ctx" | grep -qF "NO .repos/effect entry"
}

@test "vendored source: a stale pin demands a re-pin and names both refs" {
	local proj vendor
	proj="$(mktemp -d)"
	vendor="$proj/.repos"
	printf '[submodule ".repos/effect"]\n\tpath = .repos/effect\n' >"$proj/.gitmodules"
	mkdir -p "$vendor"
	printf '{"repos":{"effect":{"ref":"effect@4.0.0-rc.109"}}}\n' >"$vendor/config.json"

	run _run_copilot "$proj"
	rm -rf "$proj"

	[ "$status" -eq 0 ]
	local ctx
	ctx="$(_ctx_of "$output")"
	echo "$ctx" | grep -qF "effect@4.0.0-rc.109"
	echo "$ctx" | grep -qF "effect@$EXPECTED_PIN"
	echo "$ctx" | grep -qF "MUST"
}

@test "the v3 migration framing is retired in the copilot briefing too" {
	run _run_copilot "$PLUGIN_ROOT"
	[ "$status" -eq 0 ]

	local ctx
	ctx="$(_ctx_of "$output")"
	! echo "$ctx" | grep -qF -- "- effect-migrator"
	! echo "$ctx" | grep -qF -- "- effect-v4-construct-map"
}

@test "jq-missing fallback: emits {} rather than blocking the session" {
	local fakebin
	fakebin="$(mktemp -d)"
	ln -s "$(command -v cat)" "$fakebin/cat"
	ln -s "$(command -v bash)" "$fakebin/bash"

	run _run_copilot "$PLUGIN_ROOT" "$fakebin"
	rm -rf "$fakebin"

	[ "$status" -eq 0 ]
	[ "$output" = "{}" ]
}

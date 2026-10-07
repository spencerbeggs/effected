#!/usr/bin/env bats
# session-start-orientation.bats — covers hooks/session-start/orientation.sh,
# the plugin's only hook, on BOTH hosts.
#
# One source script serves Claude Code and Copilot through the pluginfinity
# hook library, so every test runs the BUILT copy under builds/<host>/ with
# run_hook, the way each host runs it. Run `pnpm build --filter
# @effected/ai-plugin` first; `pluginfinity build --check` proves the builds
# match the source.
#
# What the suite pins:
#   - each host's response shape (nested hookSpecificOutput on Claude Code, a
#     flat additionalContext on Copilot), exactly one JSON object per run;
#   - the briefing itself, byte-identical on both hosts, naming every skill and
#     agent on disk, with the do-not-guess block and no v3 migration framing;
#   - the vendored-source posture for every branch, against the SESSION's
#     project (CLAUDE_PROJECT_DIR on Claude Code, the envelope's cwd walked up
#     to its git root on Copilot);
#   - the no-op cases: no jq is a silent no-op (with a positive control that the
#     same PATH plus jq briefs), and empty or oversized stdin still briefs.
#
# The pin is never restated here: it is read from the hook's one EFFECT_PIN
# line, and one test checks it against this repo's vendored ref and lockfile,
# which is what forces a deliberate bump on every advance.

load "$BATS_TEST_DIRNAME/../node_modules/pluginfinity/bats/pluginfinity.bash"

HOOK="hooks/session-start/orientation.sh"
REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
HOSTS="claude copilot"

# The pin, read from the hook's single EFFECT_PIN assignment.
_pin() {
	sed -n 's/^EFFECT_PIN="\([^"]*\)"$/\1/p' "$PLUGIN_DIR/$HOOK"
}

# _brief <host> <project-dir> [source] [VAR=value...] — run the built hook on
# <host> for a session whose project is <project-dir>: the envelope's cwd is the
# project and, on Claude Code, so is CLAUDE_PROJECT_DIR. Sets $output, $status,
# $stderr and $ctx (the briefing text, read from the host's own shape).
_brief() {
	local host=$1 proj=$2 source=${3:-startup} fixture
	shift $(($# > 2 ? 3 : 2))
	fixture=$(hook_fixture SessionStart "$(jq -nc --arg c "$proj" --arg s "$source" '{cwd: $c, source: $s}')")
	HOOK_PROJECT_DIR="$proj" run_hook "$host" "$HOOK" "$fixture" "$@"
	ctx=$(_ctx_of "$host")
}

# _ctx_of <host> — the briefing text in $output, read from <host>'s shape only,
# so a response in the other host's shape reads as empty.
_ctx_of() {
	case "$1" in
	claude) jq -r '.hookSpecificOutput.additionalContext // empty' <<<"$output" 2>/dev/null ;;
	copilot) jq -r 'if has("hookSpecificOutput") then empty else .additionalContext // empty end' <<<"$output" 2>/dev/null ;;
	esac
}

# _project <kind> — a fresh project dir in one vendored-source posture.
_project() {
	local proj
	proj=$(mktemp -d "$BATS_TEST_TMPDIR/proj.XXXXXX")
	case "$1" in
	bare) ;;
	other-submodule) printf '[submodule "vendor/other"]\n\tpath = vendor/other\n' >"$proj/.gitmodules" ;;
	no-config) printf '[submodule ".repos/effect"]\n\tpath = .repos/effect\n' >"$proj/.gitmodules" ;;
	stale | current)
		printf '[submodule ".repos/effect"]\n\tpath = .repos/effect\n' >"$proj/.gitmodules"
		mkdir -p "$proj/.repos"
		local ref="effect@4.0.0-pre.1"
		[ "$1" = current ] && ref="effect@$(_pin)"
		jq -n --arg r "$ref" '{repos: {effect: {ref: $r}}}' >"$proj/.repos/config.json"
		;;
	esac
	printf '%s\n' "$proj"
}

# --- the pin ----------------------------------------------------------------

@test "the pin lives in exactly one place: one EFFECT_PIN line in hooks/" {
	[ "$(grep -rl 'EFFECT_PIN=' "$PLUGIN_DIR/hooks" | wc -l | tr -d ' ')" -eq 1 ]
	[ "$(grep -c '^EFFECT_PIN=' "$PLUGIN_DIR/$HOOK")" -eq 1 ]
	[[ "$(_pin)" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || {
		echo "EFFECT_PIN '$(_pin)' is not a version" >&2
		return 1
	}
}

@test "the pin names this repo's vendored ref and a lockfile-resolved effect" {
	local pin
	pin=$(_pin)
	[ "$(jq -r '.repos.effect.ref' "$REPO_ROOT/.repos/config.json")" = "effect@$pin" ] || {
		echo "EFFECT_PIN $pin does not match .repos/config.json's effect ref" >&2
		return 1
	}
	grep -qE "^  effect@${pin//./\\.}:" "$REPO_ROOT/pnpm-lock.yaml" || {
		echo "the lockfile resolves no effect@$pin" >&2
		return 1
	}
}

# --- response shape ---------------------------------------------------------

@test "claude: one nested hookSpecificOutput object for SessionStart" {
	_brief claude "$REPO_ROOT"
	assert_hook_exit 0
	[ "$(jq -s 'length' <<<"$output")" -eq 1 ]
	assert_hook_json '.hookSpecificOutput.hookEventName' SessionStart
	jq -e 'has("additionalContext") | not' <<<"$output" >/dev/null
	[ -n "$ctx" ]
}

@test "copilot: one FLAT additionalContext object, not Claude Code's shape" {
	_brief copilot "$REPO_ROOT"
	assert_hook_exit 0
	[ "$(jq -s 'length' <<<"$output")" -eq 1 ]
	jq -e 'has("hookSpecificOutput") | not' <<<"$output" >/dev/null
	jq -e '.additionalContext | type == "string" and length > 0' <<<"$output" >/dev/null
	[ -n "$ctx" ]
}

@test "the briefing is byte-identical on both hosts" {
	local claude_ctx
	_brief claude "$REPO_ROOT"
	claude_ctx=$ctx
	_brief copilot "$REPO_ROOT"
	[ -n "$claude_ctx" ] && [ "$ctx" = "$claude_ctx" ] || {
		diff <(printf '%s\n' "$claude_ctx") <(printf '%s\n' "$ctx") >&2 || true
		return 1
	}
}

@test "nothing reaches stderr, and backticked spans survive the heredoc" {
	# The briefing is an interpolating heredoc; an unescaped backtick would run
	# as a command substitution, still yield valid JSON, and show only here.
	local host
	for host in $HOSTS; do
		_brief "$host" "$REPO_ROOT"
		[ -z "$stderr" ] || {
			echo "$host wrote to stderr: $stderr" >&2
			return 1
		}
		grep -qF -- '`effect`' <<<"$ctx"
		grep -qF -- '`gh issue create' <<<"$ctx"
	done
}

@test "the generated hooks file registers the one script, unmatched, timeout 5, on both hosts" {
	local claude_hooks="$PLUGIN_DIR/builds/claude/hooks/hooks.json"
	local copilot_hooks="$PLUGIN_DIR/builds/copilot/com.github.copilot/hooks/hooks.json"
	jq -e '[.hooks.SessionStart[]] | length == 1 and (.[0] | has("matcher") | not)
		and (.[0].hooks | length == 1) and .[0].hooks[0].timeout == 5
		and (.[0].hooks[0].args[-1] | endswith("/hooks/session-start/orientation.sh"))' "$claude_hooks" >/dev/null
	jq -e '[.hooks.SessionStart[]] | length == 1 and (.[0] | has("matcher") | not)
		and .[0].timeoutSec == 5
		and (.[0].bash | contains("/hooks/session-start/orientation.sh\""))' "$copilot_hooks" >/dev/null
	! grep -rq 'orientation\.copilot' "$PLUGIN_DIR/builds" || {
		echo "a build still names a per-host copilot script" >&2
		return 1
	}
}

# --- the briefing's content -------------------------------------------------

@test "the briefing names every skill on disk, on both hosts" {
	local host skill_dir skill found on_disk
	on_disk="$(find "$PLUGIN_DIR/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
	for host in $HOSTS; do
		_brief "$host" "$REPO_ROOT"
		found=0
		for skill_dir in "$PLUGIN_DIR"/skills/*/; do
			skill="$(basename "$skill_dir")"
			grep -qF -- "- $skill" <<<"$ctx" || {
				echo "$host: missing skill bullet: $skill" >&2
				return 1
			}
			found=$((found + 1))
		done
		# Derived from the tree, never a hand-kept floor, and never vacuous.
		[ "$found" -eq "$on_disk" ] && [ "$on_disk" -gt 0 ]
	done
}

@test "the briefing names every agent on disk, on both hosts" {
	local host agent_file agent found on_disk
	on_disk="$(find "$PLUGIN_DIR/agents" -mindepth 1 -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
	for host in $HOSTS; do
		_brief "$host" "$REPO_ROOT"
		found=0
		for agent_file in "$PLUGIN_DIR"/agents/*.md; do
			agent="$(basename "$agent_file" .md)"
			grep -qF -- "- $agent" <<<"$ctx" || {
				echo "$host: missing agent bullet: $agent" >&2
				return 1
			}
			found=$((found + 1))
		done
		[ "$found" -eq "$on_disk" ] && [ "$on_disk" -gt 0 ]
	done
}

@test "the v3 migration framing is retired: no migrator agent, no v3 guidance" {
	local host
	for host in $HOSTS; do
		_brief "$host" "$REPO_ROOT"
		[ -n "$ctx" ]
		! grep -qF -- "- effect-migrator" <<<"$ctx"
		! grep -qF -- "- effect-v4-construct-map" <<<"$ctx"
		! grep -qiE "v3.{0,3}(to|→|->).{0,3}v4|migration checklist|porting a v3" <<<"$ctx"
	done
}

@test "do-not-guess: the briefing tells the agent to delegate rather than recall" {
	local host
	for host in $HOSTS; do
		_brief "$host" "$REPO_ROOT"
		grep -qF "<do_not_guess>" <<<"$ctx"
		grep -qF "effect-developer" <<<"$ctx"
		grep -qiF "out of date" <<<"$ctx"
	done
}

@test "resume and compact starts brief too (no matcher), on both hosts" {
	local host source
	for host in $HOSTS; do
		for source in resume compact; do
			_brief "$host" "$REPO_ROOT" "$source"
			assert_hook_exit 0
			grep -qF "<effect_plugin>" <<<"$ctx" || {
				echo "$host/$source: no briefing" >&2
				return 1
			}
		done
	done
}

# --- vendored-source posture ------------------------------------------------

@test "vendored source: this repo's matching pin is reported as authoritative" {
	local host
	for host in $HOSTS; do
		_brief "$host" "$REPO_ROOT"
		grep -qF "pinned to" <<<"$ctx"
		grep -qF "effect@$(_pin)" <<<"$ctx"
		grep -qF "matches the kit's current pin" <<<"$ctx"
	done
}

@test "vendored source: a synthetic project at the current pin matches, a stale one does not" {
	local host proj
	for host in $HOSTS; do
		proj=$(_project current)
		_brief "$host" "$proj"
		grep -qF "matches the kit's current pin" <<<"$ctx" || {
			echo "$host: current-pin project not reported as matching" >&2
			return 1
		}
		# Negative control: the same project one ref away must not match.
		proj=$(_project stale)
		_brief "$host" "$proj"
		! grep -qF "matches the kit's current pin" <<<"$ctx"
	done
}

@test "vendored source: no .gitmodules asks the agent to vendor Effect" {
	local host
	for host in $HOSTS; do
		_brief "$host" "$(_project bare)"
		grep -qF "NO .gitmodules" <<<"$ctx"
		grep -qF "effect@$(_pin)" <<<"$ctx"
		grep -qF "/silk:repos" <<<"$ctx"
	done
}

@test "vendored source: a .gitmodules without an effect entry asks for one" {
	local host
	for host in $HOSTS; do
		_brief "$host" "$(_project other-submodule)"
		grep -qF "NO .repos/effect entry" <<<"$ctx"
		grep -qF "effect@$(_pin)" <<<"$ctx"
	done
}

@test "vendored source: a stale pin demands a re-pin and names both refs" {
	local host
	for host in $HOSTS; do
		_brief "$host" "$(_project stale)"
		grep -qF "effect@4.0.0-pre.1" <<<"$ctx"
		grep -qF "effect@$(_pin)" <<<"$ctx"
		grep -qF "MUST" <<<"$ctx"
	done
}

@test "vendored source: an effect entry with no config.json still demands a re-pin" {
	local host
	for host in $HOSTS; do
		_brief "$host" "$(_project no-config)"
		grep -qF '"unknown"' <<<"$ctx"
		grep -qF "MUST" <<<"$ctx"
	done
}

# --- which project: the session's, not the tool call's ----------------------

@test "a nested cwd is walked up to the repo root, on both hosts" {
	# Copilot hands cwd, not the project root; on Claude Code with no
	# CLAUDE_PROJECT_DIR the library walks the cwd too.
	local nested="$REPO_ROOT/plugin/hooks/session-start"
	_brief copilot "$nested"
	grep -qF "matches the kit's current pin" <<<"$ctx"
	_brief claude "$nested" startup CLAUDE_PROJECT_DIR=
	grep -qF "matches the kit's current pin" <<<"$ctx"
}

@test "claude: CLAUDE_PROJECT_DIR, the session's project, wins over the envelope's cwd" {
	local bare fixture
	bare=$(_project bare)
	# Session project = this repo, cwd = a bare dir: reports the repo's pin.
	fixture=$(hook_fixture SessionStart "$(jq -nc --arg c "$bare" '{cwd: $c}')")
	HOOK_PROJECT_DIR="$REPO_ROOT" run_hook claude "$HOOK" "$fixture"
	ctx=$(_ctx_of claude)
	grep -qF "matches the kit's current pin" <<<"$ctx"
	# Negative control: swap them and the bare session project is reported.
	fixture=$(hook_fixture SessionStart "$(jq -nc --arg c "$REPO_ROOT" '{cwd: $c}')")
	HOOK_PROJECT_DIR="$bare" run_hook claude "$HOOK" "$fixture"
	ctx=$(_ctx_of claude)
	grep -qF "NO .gitmodules" <<<"$ctx"
}

# --- one object per branch, and the no-op cases -----------------------------

@test "every branch emits exactly one JSON object, on both hosts" {
	# A second object alongside the payload makes the host reject the whole
	# response, so pin a single object for each posture branch.
	local host kind
	for host in $HOSTS; do
		for kind in bare other-submodule no-config stale current; do
			_brief "$host" "$(_project "$kind")"
			assert_hook_exit 0
			[ "$(jq -s 'length' <<<"$output")" -eq 1 ] || {
				echo "$host/$kind: expected exactly one JSON object: $output" >&2
				return 1
			}
			[ -n "$ctx" ]
		done
	done
}

@test "no jq: a silent no-op that does not block, and the same PATH plus jq briefs" {
	local fakebin tool host
	fakebin="$BATS_TEST_TMPDIR/fakebin"
	mkdir -p "$fakebin"
	# Everything the library and the script need except jq.
	for tool in bash cat dirname basename mktemp rm date mkdir grep sed tr; do
		ln -s "$(command -v "$tool")" "$fakebin/$tool"
	done
	for host in $HOSTS; do
		_brief "$host" "$REPO_ROOT" startup PATH="$fakebin"
		assert_hook_noop
		[ -z "$output" ]
	done
	# Positive control: the no-op above is jq's absence, not a missing tool.
	ln -s "$(command -v jq)" "$fakebin/jq"
	for host in $HOSTS; do
		_brief "$host" "$REPO_ROOT" startup PATH="$fakebin"
		assert_hook_exit 0
		grep -qF "matches the kit's current pin" <<<"$ctx" || {
			echo "$host: no briefing with jq on the narrowed PATH: $output / $stderr" >&2
			return 1
		}
	done
}

@test "stdin: an empty or a 2 MB envelope still briefs, on both hosts" {
	# Empty stdin carries no event or cwd: the entry's PLUGINFINITY_EVENT names
	# the event. (run_hook reads its fixture with jq, so a non-JSON one cannot
	# go through it; the library reads anything that is not an object as {}.)
	local empty big host
	empty="$BATS_TEST_TMPDIR/empty.json"
	big="$BATS_TEST_TMPDIR/big.json"
	: >"$empty"
	head -c 2000000 /dev/zero | tr '\0' 'x' |
		jq -Rs --arg c "$REPO_ROOT" '{session_id: "big", hook_event_name: "SessionStart", cwd: $c, source: "startup", padding: .}' >"$big"
	for host in $HOSTS; do
		for fixture in "$empty" "$big"; do
			HOOK_PROJECT_DIR="$REPO_ROOT" run_hook "$host" "$HOOK" "$fixture"
			assert_hook_exit 0
			ctx=$(_ctx_of "$host")
			grep -qF "<effect_plugin>" <<<"$ctx" || {
				echo "$host: no briefing for $(basename "$fixture"): $output" >&2
				return 1
			}
		done
	done
}

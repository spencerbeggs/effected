#!/usr/bin/env bats
# subagent-start-maps.bats — covers hooks/subagent-start/maps.sh on BOTH hosts.
#
# A subagent gets no SessionStart briefing, so this hook hands the plugin's
# three code-writing agents the absolute paths of the lookup maps. The suite
# runs the BUILT copy under builds/<host>/ with run_hook. Run
# `pnpm build --filter @effected/ai-plugins` first.
#
# What it pins:
#   - each code-writing agent, plain or plugin-scoped, gets one context object
#     whose paths resolve in the build that ran it;
#   - every other agent (tsdoc-fixer, a built-in, another plugin's agent whose
#     name merely contains ours) gets a no-op;
#   - the generated hooks file registers the one script, unmatched, timeout 5.

load "$BATS_TEST_DIRNAME/../node_modules/pluginfinity/bats/pluginfinity.bash"

HOOK="hooks/subagent-start/maps.sh"
HOSTS="claude copilot"

# _start <host> <agent_type> — run the built hook; sets $output and $ctx.
_start() {
	local fixture
	fixture=$(hook_fixture SubagentStart "$(jq -nc --arg a "$2" '{agent_id: "a1", agent_type: $a}')")
	run_hook "$1" "$HOOK" "$fixture"
	case "$1" in
	claude) ctx=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<<"$output" 2>/dev/null) ;;
	copilot) ctx=$(jq -r 'if has("hookSpecificOutput") then empty else .additionalContext // empty end' <<<"$output" 2>/dev/null) ;;
	esac
}

@test "each code-writing agent gets the maps at paths that resolve, on both hosts" {
	local host agent root
	for host in $HOSTS; do
		root="$PLUGIN_DIR/builds/$host"
		for agent in effect-developer effected:effect-developer effect-reviewer effected:effect-reviewer \
			action-engineer effected:action-engineer; do
			_start "$host" "$agent"
			assert_hook_exit 0
			[ "$(jq -s 'length' <<<"$output")" -eq 1 ]
			grep -qF "<effected_maps>" <<<"$ctx" || {
				echo "$host/$agent: no maps: $output" >&2
				return 1
			}
			grep -qF -- "grep -ri \"walk\" \"$root/skills/effected-packages/references/constructs\"" <<<"$ctx"
			grep -qF -- "$root/skills/effect-v4-module-index/SKILL.md" <<<"$ctx"
		done
		[ -f "$root/skills/effected-packages/references/constructs/glob.md" ]
		[ -f "$root/skills/effect-v4-module-index/SKILL.md" ]
	done
}

@test "every other agent gets a no-op, on both hosts" {
	local host agent
	for host in $HOSTS; do
		for agent in effected:tsdoc-fixer tsdoc-fixer Explore general-purpose other:effect-developer-helper ""; do
			_start "$host" "$agent"
			assert_hook_noop
			[ -z "$ctx" ] || {
				echo "$host/'$agent': unexpected context" >&2
				return 1
			}
		done
	done
}

@test "the generated hooks file registers the one script, unmatched, timeout 5, on both hosts" {
	jq -e '[.hooks.SubagentStart[]] | length == 1 and (.[0] | has("matcher") | not)
		and .[0].hooks[0].timeout == 5
		and (.[0].hooks[0].args[-1] | endswith("/hooks/subagent-start/maps.sh"))' \
		"$PLUGIN_DIR/builds/claude/hooks/hooks.json" >/dev/null
	# Copilot spells this event camelCase (SessionStart keeps its PascalCase key).
	jq -e '[.hooks.subagentStart[]] | length == 1 and (.[0] | has("matcher") | not)
		and .[0].timeoutSec == 5
		and (.[0].bash | contains("/hooks/subagent-start/maps.sh\""))' \
		"$PLUGIN_DIR/builds/copilot/com.github.copilot/hooks/hooks.json" >/dev/null
}

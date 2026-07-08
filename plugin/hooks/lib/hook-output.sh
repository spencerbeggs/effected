# shellcheck shell=bash
# hook-output.sh — shared helpers for emitting Claude Code hook responses.
#
# Source from a hook script:
#   . "${CLAUDE_PLUGIN_ROOT}/hooks/lib/hook-output.sh"
#
# Each emitter prints the documented JSON response shape to stdout. Hooks
# always exit 0 after emitting; the JSON is the decision signal.

# emit_noop — print an empty no-op response. Use when the hook decided not to
# act and the event should proceed unchanged. Needs no jq.
emit_noop() {
	printf '{}\n'
}

# emit_context — additionalContext for SessionStart / UserPromptSubmit /
# PostToolUse. The event_name argument must match the firing event. Requires jq.
emit_context() {
	local event_name="${1:?emit_context: event_name required}"
	local ctx="${2:-}"
	jq -n --arg evt "$event_name" --arg ctx "$ctx" '{
		hookSpecificOutput: {
			hookEventName: $evt,
			additionalContext: $ctx
		}
	}'
}

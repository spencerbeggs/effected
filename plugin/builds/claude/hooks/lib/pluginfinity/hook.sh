# shellcheck shell=bash
# pluginfinity hook library. `pluginfinity build` writes this file into every
# target that has hooks; do not edit a copy under builds/, the next build
# overwrites it.
#
# Source it first in a hook script, relative to the script:
#   . "$(dirname "$0")/lib/pluginfinity/hook.sh"      # hooks/<name>.sh
#   . "$(dirname "$0")/../lib/pluginfinity/hook.sh"   # hooks/<event>/<name>.sh
#
# Bash 3.2 compatible. Writes nothing when sourced. Needs jq.
#
# Do not install your own `trap ... EXIT`: it replaces the library's
# fail-open / fail-closed trap, and a failing hook would then exit non-zero.

_pf_fail_closed=0
[ "${PLUGINFINITY_FAIL_CLOSED:-0}" = 1 ] && _pf_fail_closed=1
_pf_event=""
_pf_marker=""
_pf_kind_prefix=""

# --- logging --------------------------------------------------------------

_pf_lib_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 0
# The one logging standard lives at <root>/lib/pluginfinity. A build without it
# must still fail open, so fall back to no-ops.
_pf_log_dir="$_pf_lib_dir/../../../lib/pluginfinity"
# shellcheck source=/dev/null
. "$_pf_log_dir/log.sh" 2>/dev/null || {
	pf_log() { :; }
	pf_debug() { :; }
	pf_debug_on() { return 1; }
}

# Append a line to the plugin's error log.
hook_log() { pf_log hook "$*"; }

# Append a line to the plugin's debug log when PLUGINFINITY_DEBUG=1.
hook_debug() { pf_debug hook "$*"; }

# Until the library is fully loaded a failure must still fail open: on Copilot
# a non-zero exit from a preToolUse hook denies the tool.
_pf_early_exit() {
	local code=$?
	[ "$code" -eq 0 ] || hook_log "exited $code while loading the hook library"
	_pf_cleanup
	exit 0
}
_pf_cleanup() {
	if [ -n "$_pf_marker" ]; then rm -f "$_pf_marker" 2>/dev/null || true; fi
	return 0
}
trap _pf_early_exit EXIT

# shellcheck source=/dev/null
. "$_pf_lib_dir/host.sh" 2>/dev/null || {
	hook_log "host.sh not loadable; hook skipped"
	exit 0
}

# The tool map the build wrote for this host. A build without it keeps names
# as they are.
_PF_TOOLS=""
_PF_TOOLS_PLUGIN=""
_PF_TOOLS_MCP=""
_PF_TOOLS_SERVERS=""
_PF_TOOLS_UNLISTED=keep
_PF_HAS_SKILLS=""
_PF_HAS_AGENTS=""
_PF_HAS_MONITORS=""
_PF_HAS_SERVERS=""
# A failed `.` aborts a shell on bash 3.2, so test the file first.
if [ -r "$_pf_lib_dir/tools.sh" ]; then
	# shellcheck source=/dev/null
	. "$_pf_lib_dir/tools.sh" 2>/dev/null || true
fi

# --- input ----------------------------------------------------------------

# Read the event once. A terminal on stdin (a hand run) reads as {}.
if [ -t 0 ]; then
	_pf_input='{}'
else
	_pf_input=$(cat) || _pf_input=''
fi

if ! command -v jq >/dev/null 2>&1; then
	hook_log "jq not found; hook skipped"
	exit 0
fi

# Whether stdin held a JSON object. Anything else reads as {} from here on, so
# hook_input never sees garbage; hook_require_input turns it into a no-op.
_pf_input_ok=0
if jq -e 'type == "object"' >/dev/null 2>&1 <<<"$_pf_input"; then
	_pf_input_ok=1
else
	_pf_input='{}'
fi

# Return when stdin was a JSON object; otherwise log it, answer with a no-op
# and end the script.
hook_require_input() {
	[ "$_pf_input_ok" = 1 ] && return 0
	hook_log "malformed or empty JSON on stdin; skipping"
	hook_noop
	exit 0
}

# One marker file records that a response went out, and holds its kind for the
# debug log. It is a file, not a variable, so a response sent from a subshell
# or a pipeline still counts.
_pf_marker=$(mktemp "${TMPDIR:-/tmp}/pluginfinity-emitted.XXXXXX" 2>/dev/null) ||
	_pf_marker="${TMPDIR:-/tmp}/pluginfinity-emitted.$$"
: >"$_pf_marker" 2>/dev/null || true

# A Claude field name, read from either payload form: as written, then the
# camelCase spelling (tool_input from a toolArgs object or JSON string,
# tool_name from toolName, anything else camelCased at the top level). A
# tool_input key also falls back to Copilot's own spelling of it, since Copilot
# keeps its key names (path, file_text, old_str, new_str) under Claude event
# and tool names.
_PF_INPUT_FILTER='
def camel: gsub("_(?<c>[a-z])"; .c | ascii_upcase);
def args: if type == "string" then (fromjson? // .) else . end;
def alias: {file_path: "path", content: "file_text", old_string: "old_str", new_string: "new_str"};
. as $in
| ($path | if . == "" then [] else split(".") end) as $p
| (try ($in | getpath($p)) catch null) as $v
| (if $v != null then $v
   elif $p[0] == "tool_input" and ($p | length) == 2 and (alias[$p[1]] != null)
        and (try ($in | getpath([$p[0], alias[$p[1]]])) catch null) != null
     then ($in | getpath([$p[0], alias[$p[1]]]))
   elif $p[0] == "tool_input" then (try (($in.toolArgs | args) | getpath($p[1:])) catch null)
   elif $p[0] == "tool_name" then $in.toolName
   else (try ($in | getpath([$p[0] | camel] + $p[1:])) catch null) end)
| if . == null then empty elif type == "string" then . else tojson end'

# Print an input field by its Claude name (dotted for nested keys), or the
# whole input as JSON with no argument. Prints nothing for a missing field.
hook_input() { printf '%s' "$_pf_input" | jq -r --arg path "${1:-}" "$_PF_INPUT_FILTER" 2>/dev/null; }

# --- failure policy -------------------------------------------------------

_pf_has_emitted() { [ -s "$_pf_marker" ]; }

_pf_closed_response() { # code
	local reason="${PLUGINFINITY_PLUGIN:-a plugin} hook failed (exit $1)" body
	_pf_kind_prefix="fail-closed "
	if hook_supports deny; then
		_pf_permission deny "$reason"
	elif hook_supports block; then
		body=$(jq -nc --arg r "$reason" '{decision: "block", reason: $r}') || return 1
		_pf_emit "$body" block
	fi
}

_pf_on_exit() {
	local code=$? outcome=none
	if [ "$code" -ne 0 ]; then
		hook_log "exited $code during ${_pf_event:-an unknown event}"
		if [ "$_pf_fail_closed" = 1 ] && ! _pf_has_emitted; then
			# A Stop hook that crashes while stop_hook_active is true must not block again, or it loops.
			case "$_pf_event" in
			Stop | SubagentStop)
				[ "$(hook_input stop_hook_active)" = true ] || _pf_closed_response "$code" || true
				;;
			*) _pf_closed_response "$code" || true ;;
			esac
		fi
	fi
	if pf_debug_on; then
		if _pf_has_emitted; then outcome=$(cat "$_pf_marker" 2>/dev/null) || outcome=response; fi
		if [ "$code" -ne 0 ]; then outcome="$outcome (exit $code)"; fi
		hook_debug "outcome: $outcome"
	fi
	_pf_cleanup
	exit 0
}

# Make a failure deny (PreToolUse) or block (where blocking is honoured)
# instead of letting the action through.
hook_fail_closed() { _pf_fail_closed=1; }

# --- context --------------------------------------------------------------

# The event's Claude name: PLUGINFINITY_EVENT (set on every Copilot entry by
# the build), else the input's hook_event_name.
# Prints nothing and returns 1 when neither is available.
hook_event() {
	local ev=${PLUGINFINITY_EVENT:-}
	[ -n "$ev" ] || ev=$(hook_input hook_event_name)
	[ -n "$ev" ] || return 1
	printf '%s\n' "$ev"
}
_pf_event=$(hook_event 2>/dev/null) || _pf_event=""

# claude or copilot.
hook_host() { printf '%s\n' "$PLUGINFINITY_HOST"; }

# The build root this script runs from.
hook_plugin_root() { (cd "$_pf_lib_dir/../../.." && pwd); }

# The closest directory at or above $1 holding .git (a directory, or a file in
# a worktree). Prints nothing and returns 1 when there is none.
_pf_git_root() {
	local probe=$1
	while [ -n "$probe" ] && [ "$probe" != / ] && [ "$probe" != . ]; do
		if [ -e "$probe/.git" ]; then
			printf '%s\n' "$probe"
			return 0
		fi
		probe=$(dirname "$probe")
	done
	return 1
}

# Where this call runs: the input's cwd walked up to the nearest .git, else the
# cwd itself; with no cwd, CLAUDE_PROJECT_DIR (Claude), else $PWD walked up to
# .git (Claude), else $PWD as is. On Copilot $PWD is always the plugin root, so
# it is never walked: that would find the repo holding the plugin.
hook_project_dir() {
	local dir root
	dir=$(hook_input cwd)
	# A relative cwd means nothing outside the host's own process; ignore it.
	if [ -n "$dir" ] && [ "${dir#/}" != "$dir" ]; then
		if root=$(_pf_git_root "$dir"); then
			printf '%s\n' "$root"
		else
			printf '%s\n' "$dir"
		fi
		return 0
	fi
	if [ "$PLUGINFINITY_HOST" = claude ]; then
		if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
			printf '%s\n' "$CLAUDE_PROJECT_DIR"
			return 0
		fi
		if root=$(_pf_git_root "$PWD"); then
			printf '%s\n' "$root"
			return 0
		fi
	fi
	printf '%s\n' "$PWD"
}

# The session's project: CLAUDE_PROJECT_DIR on Claude when set, else what
# hook_project_dir finds. In a git worktree the two differ.
hook_session_dir() {
	if [ "$PLUGINFINITY_HOST" = claude ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
		printf '%s\n' "$CLAUDE_PROJECT_DIR"
		return 0
	fi
	hook_project_dir
}

# cd into hook_project_dir, ignoring CDPATH and treating a leading dash as a path.
# Writes nothing to stdout; on failure it logs through hook_log and returns non-zero.
hook_cd_project() {
	local dir
	dir=$(hook_project_dir)
	CDPATH= cd -- "$dir" >/dev/null 2>&1 || {
		hook_log "hook_cd_project: cannot cd to $dir"
		return 1
	}
}

# Print the host's run-time spelling of a Claude run-time tool name and return
# 0, or print nothing and return 1 when the host has none. An own MCP tool is
# written mcp__plugin_<plugin>_<server>__<tool>, as Claude Code names it.
hook_tool_name() {
	local name=${1:-} line plugin rest head seg server tool template
	[ -n "$name" ] || return 1
	while IFS= read -r line; do
		if [ "${line%%=*}" = "$name" ] && [ "${line#*=}" != "$line" ]; then
			printf '%s\n' "${line#*=}"
			return 0
		fi
	done <<<"$_PF_TOOLS"
	plugin=${_PF_TOOLS_PLUGIN:-${PLUGINFINITY_PLUGIN:-}}
	case "$name" in
	"mcp__plugin_${plugin}_"*)
		rest=${name#"mcp__plugin_${plugin}_"}
		# Try each "__" as the server/tool boundary, as the build does.
		head=""
		while [ "${rest#*__}" != "$rest" ]; do
			seg=${rest%%__*}
			rest=${rest#*__}
			server="${head:+${head}__}$seg"
			tool=$rest
			head=$server
			[ -n "$server" ] && [ -n "$tool" ] && [ -n "$_PF_TOOLS_MCP" ] || continue
			case " $_PF_TOOLS_SERVERS " in
			*" $server "*)
				template=$_PF_TOOLS_MCP
				template=${template//\{plugin\}/$plugin}
				template=${template//\{server\}/$server}
				template=${template//\{tool\}/$tool}
				printf '%s\n' "$template"
				return 0
				;;
			esac
		done
		;;
	esac
	[ "$_PF_TOOLS_UNLISTED" = keep ] || return 1
	printf '%s\n' "$name"
}

# Whether this build ships a component: hook_has <monitor|skill|agent|server> <name>.
# Returns 0 when it does, 1 when it does not (or tools.sh is missing), 2 for an
# unknown kind. The lists are built per target, so a skill a target excludes and
# a monitor on a host without monitors are absent.
hook_has() {
	local kind=${1:-} name=${2:-} list
	case "$kind" in
	skill) list=$_PF_HAS_SKILLS ;;
	agent) list=$_PF_HAS_AGENTS ;;
	monitor) list=$_PF_HAS_MONITORS ;;
	server) list=$_PF_HAS_SERVERS ;;
	*)
		hook_log "hook_has: unknown kind '$kind'"
		return 2
		;;
	esac
	[ -n "$name" ] || return 1
	case " $list " in
	*" $name "*) return 0 ;;
	esac
	return 1
}

# Print the run-time tool-name prefix of an own MCP server (Claude
# mcp__plugin_<plugin>_<server>__, Copilot <server>-) and return 0, or print
# nothing and return 1 for a server this plugin does not declare.
hook_tool_prefix() {
	local server=${1:-} template plugin
	[ -n "$server" ] && [ -n "$_PF_TOOLS_MCP" ] || return 1
	case " $_PF_TOOLS_SERVERS " in
	*" $server "*) ;;
	*) return 1 ;;
	esac
	plugin=${_PF_TOOLS_PLUGIN:-${PLUGINFINITY_PLUGIN:-}}
	template=$_PF_TOOLS_MCP
	template=${template//\{plugin\}/$plugin}
	template=${template//\{server\}/$server}
	printf '%s\n' "${template%%\{tool\}*}"
}

# Whether the host honours capability $1 on event $2 (default: this event).
# Mirrors okf/references/{claude-code,copilot-cli}-plugin-format.md.
# server-project asks about the host, not an event: whether an MCP server can
# learn the project (Claude gives it CLAUDE_PROJECT_DIR and roots; Copilot
# gives none, measured 2026-10-07), the question server_project_dir answers.
hook_supports() {
	local cap="${1:-}" event="${2:-$_pf_event}"
	case "$PLUGINFINITY_HOST:$cap" in
	*:noop | *:raw) return 0 ;;
	claude:system_message)
		case "$event" in Notification | SessionEnd | PreCompact | ConfigChange) return 1 ;; esac
		return 0
		;;
	*:deny | *:allow | *:ask) [ "$event" = PreToolUse ] && return 0 ;;
	claude:context)
		case "$event" in
		SessionStart | SubagentStart | PostModelSwitch | UserPromptSubmit | UserPromptExpansion | PreToolUse | \
			PostToolUse | PostToolUseFailure | PostToolBatch | Stop | SubagentStop) return 0 ;;
		esac
		;;
	copilot:context)
		case "$event" in SessionStart | SubagentStart | PostToolUse | Notification) return 0 ;; esac
		;;
	claude:block)
		case "$event" in
		UserPromptSubmit | UserPromptExpansion | PostToolUse | PostToolBatch | Stop | \
			SubagentStop | ConfigChange | PreCompact | TaskCreated | PreModelSwitch) return 0 ;;
		esac
		;;
	copilot:block)
		case "$event" in Stop | SubagentStop) return 0 ;; esac
		;;
	claude:server-project) return 0 ;;
	claude:env-shell)
		case "$event" in SessionStart | Setup | CwdChanged | FileChanged) return 0 ;; esac
		;;
	esac
	return 1
}

# --- session env ---------------------------------------------------------

# Whether env.sh is loaded: the build ships it only when the config declares env.
_pf_env_loaded=0

# Set a declared session variable (the run-time rung of the env chain): record
# it in the session values file, export it in this hook and, on Claude, append
# it to CLAUDE_ENV_FILE so the model's shell sees it. Only the events that can
# produce a value (SessionStart, Setup, CwdChanged, FileChanged) may call it,
# and only for a name the config declares. It always returns 0: a refusal (any
# other event, an undeclared name, a value with a newline, a build with no env)
# is a log line, or a debug line for an event that cannot produce, and changes
# nothing, so it never aborts a `set -e` hook or denies a fail-closed one.
hook_env_set() {
	local name=${1:-}
	if [ "$_pf_env_loaded" != 1 ]; then
		hook_log "hook_env_set: no session env is declared in this build"
		return 0
	fi
	case "$_pf_event" in
	SessionStart | Setup | CwdChanged | FileChanged) ;;
	*)
		hook_debug "hook_env_set $name ignored: ${_pf_event:-an unknown event} does not produce session values"
		return 0
		;;
	esac
	_pf_env_set "$name" "${2-}" || true
	return 0
}

# Load env.sh and apply the session values. A failure here never aborts the hook, even under set -e.
_pf_env_start() {
	local sid proj cwd errexit=0 nounset=0
	[ -r "$_pf_log_dir/env.sh" ] || return 0
	case $- in *e*) errexit=1 ;; esac
	case $- in *u*) nounset=1 ;; esac
	set +eu
	_pf_env_lib_dir="$_pf_log_dir"
	_pf_env_manual=1
	_pf_env_component=hook
	# shellcheck source=/dev/null
	if . "$_pf_log_dir/env.sh" 2>/dev/null; then
		_pf_env_loaded=1
		sid=$(hook_input session_id)
		cwd=$(hook_input cwd)
		if [ "$PLUGINFINITY_HOST" = copilot ] && [ "${cwd#/}" = "$cwd" ]; then
			# The runner's rule: Copilot runs hooks from the plugin root, which is no
			# project, so with no absolute cwd read no .env (the session file or the defaults).
			proj=-
		else
			proj=$(_pf_env_project_of "$(hook_project_dir)")
		fi
		env_load "$sid" "$proj"
	else
		hook_log "env.sh not loadable; session env skipped"
	fi
	[ "$errexit" = 1 ] && set -e
	[ "$nounset" = 1 ] && set -u
	return 0
}

# --- output ---------------------------------------------------------------

_pf_emit() { # json [kind]
	if [ -z "${1:-}" ]; then
		hook_log "refused to send an empty response"
		return 1
	fi
	if _pf_has_emitted; then
		hook_debug "ignored a second response: $1"
		return 0
	fi
	printf '%s' "${_pf_kind_prefix}${2:-response}" >"$_pf_marker" 2>/dev/null || true
	printf '%s\n' "$1"
}

_pf_unsupported() { # function-name
	hook_debug "$1 does nothing on $PLUGINFINITY_HOST for ${_pf_event:-an unknown event}"
	hook_noop
}

_pf_permission() { # decision reason [updated-input-json]
	local key=updatedInput body u=null
	[ "$PLUGINFINITY_HOST" = copilot ] && key=modifiedArgs
	if [ -n "${3:-}" ]; then
		u=$(printf '%s' "$3" | jq -c . 2>/dev/null) || {
			hook_log "hook_allow: not JSON: $3"
			return 1
		}
	fi
	body=$(jq -nc --arg d "$1" --arg r "${2:-}" --argjson u "$u" --arg k "$key" \
		'{permissionDecision: $d}
		 + (if $r == "" then {} else {permissionDecisionReason: $r} end)
		 + (if $u == null then {} else {($k): $u} end)' 2>/dev/null) || return 1
	if [ "$PLUGINFINITY_HOST" != copilot ]; then
		body=$(jq -nc --argjson b "$body" '{hookSpecificOutput: ({hookEventName: "PreToolUse"} + $b)}') || return 1
	fi
	_pf_emit "$body" "$1"
}

# Respond with nothing to change.
hook_noop() { _pf_emit '{}' noop; }

# Add text to the model's context.
hook_context() {
	hook_supports context || {
		_pf_unsupported hook_context
		return 0
	}
	local body
	if [ "$PLUGINFINITY_HOST" = copilot ]; then
		body=$(jq -nc --arg c "${1:-}" '{additionalContext: $c}') || return 1
	else
		body=$(jq -nc --arg e "$_pf_event" --arg c "${1:-}" \
			'{hookSpecificOutput: {hookEventName: $e, additionalContext: $c}}') || return 1
	fi
	_pf_emit "$body" context
}

# PreToolUse: refuse the tool call.
hook_deny() {
	hook_supports deny || {
		_pf_unsupported hook_deny
		return 0
	}
	_pf_permission deny "${1:-Blocked by ${PLUGINFINITY_PLUGIN:-a plugin}}"
}

# PreToolUse: allow the tool call, with an optional reason and an optional
# replacement input (JSON).
hook_allow() {
	hook_supports allow || {
		_pf_unsupported hook_allow
		return 0
	}
	_pf_permission allow "${1:-}" "${2:-}"
}

# PreToolUse: ask the user.
hook_ask() {
	hook_supports ask || {
		_pf_unsupported hook_ask
		return 0
	}
	_pf_permission ask "${1:-}"
}

# Block the event's action with a reason (Stop: keep working on it).
hook_block() {
	hook_supports block || {
		_pf_unsupported hook_block
		return 0
	}
	local body
	body=$(jq -nc --arg r "${1:-Blocked by ${PLUGINFINITY_PLUGIN:-a plugin}}" '{decision: "block", reason: $r}') || return 1
	_pf_emit "$body" block
}

# Show the user a message.
hook_system_message() {
	hook_supports system_message || {
		_pf_unsupported hook_system_message
		return 0
	}
	local body
	body=$(jq -nc --arg m "${1:-}" '{systemMessage: $m}') || return 1
	_pf_emit "$body" system_message
}

# Print the input the way Claude would send it. On Copilot: hook_event_name
# from hook_event, snake_case top-level keys (toolName/toolArgs become
# tool_name/tool_input, parsed when a string), and Copilot's tool_input key
# names mapped to Claude's where the Claude key is absent. On Claude: the
# input unchanged, with hook_event_name filled in when missing.
hook_envelope() {
	if [ "${1:-}" != claude ]; then
		hook_log "hook_envelope: unknown target: ${1:-none}"
		return 1
	fi
	local event
	event=$(hook_event 2>/dev/null) || event=""
	printf '%s' "$_pf_input" | jq -c --arg event "$event" --arg host "$PLUGINFINITY_HOST" '
def snake: gsub("(?<c>[A-Z])"; "_" + (.c | ascii_downcase));
def args: if type == "string" then (fromjson? // .) else . end;
def alias: {path: "file_path", file_text: "content", old_str: "old_string", new_str: "new_string"};
def fix: if type == "object" then
    . as $o | reduce (keys_unsorted[]) as $k ($o;
      if alias[$k] != null and (has(alias[$k]) | not) then . + {(alias[$k]): $o[$k]} else . end)
  else . end;
(if $host == "copilot" then
   with_entries(.key |= (if . == "toolName" then "tool_name" elif . == "toolArgs" then "tool_input" else snake end))
   | if has("tool_input") then .tool_input |= (args | fix) else . end
 else . end)
| if (has("hook_event_name") | not) and $event != "" then . + {hook_event_name: $event} else . end' 2>/dev/null || {
		hook_log "hook_envelope: input is not a JSON object"
		return 1
	}
}

# Map one Claude-shaped hook response onto this host's emitters. First match
# wins: permission decision, block, additional context, system message, then
# noop. Fields that lose or have no mapping are written to the debug log.
hook_relay() {
	local plan kind reason input text path
	plan=$(printf '%s' "${1:-}" | jq -c '
if type != "object" then error("not an object") else . end
| (.hookSpecificOutput | if type == "object" then . else {} end) as $h
| ($h.permissionDecision) as $d
| (if ($d == "allow" or $d == "deny" or $d == "ask") then
     {kind: $d, reason: ($h.permissionDecisionReason // ""), input: (if $d == "allow" and ($h.updatedInput != null) then ($h.updatedInput | tojson) else "" end), text: "",
      used: ["hookSpecificOutput.permissionDecision", "hookSpecificOutput.permissionDecisionReason", "hookSpecificOutput.updatedInput"]}
   elif .decision == "block" then
     {kind: "block", reason: (.reason // ""), input: "", text: "", used: ["decision", "reason"]}
   elif ($h.additionalContext != null) then
     {kind: "context", reason: "", input: "", text: ($h.additionalContext | if type == "string" then . else tojson end), used: ["hookSpecificOutput.additionalContext"]}
   elif .systemMessage != null then
     {kind: "system_message", reason: "", input: "", text: (.systemMessage | if type == "string" then . else tojson end), used: ["systemMessage"]}
   else {kind: "noop", reason: "", input: "", text: "", used: []} end) as $p
| ([paths | select((length == 1 and (.[0] != "hookSpecificOutput" or ($h | length) == 0)) or (length == 2 and .[0] == "hookSpecificOutput" and (($h | length) > 0)))
    | join(".")] | map(select(. != "hookSpecificOutput.hookEventName"))) as $all
| $p + {dropped: ($all - $p.used)}' 2>/dev/null) || {
		hook_log "hook_relay: not a JSON object"
		return 1
	}
	kind=$(jq -r .kind <<<"$plan")
	reason=$(jq -r .reason <<<"$plan")
	input=$(jq -r .input <<<"$plan")
	text=$(jq -r .text <<<"$plan")
	while IFS= read -r path; do
		[ -n "$path" ] && hook_debug "hook_relay dropped $path"
	done <<<"$(jq -r '.dropped[]' <<<"$plan")"
	case "$kind" in
	allow) hook_allow "$reason" "$input" ;;
	deny) hook_deny "$reason" ;;
	ask) hook_ask "$reason" ;;
	block) hook_block "$reason" ;;
	context) hook_context "$text" ;;
	system_message) hook_system_message "$text" ;;
	*) hook_noop ;;
	esac
}

# Emit a host-specific JSON response verbatim, only on that host.
hook_raw() {
	if [ "${1:-}" != "$PLUGINFINITY_HOST" ]; then
		hook_debug "hook_raw for ${1:-no host} skipped on $PLUGINFINITY_HOST"
		return 0
	fi
	local body
	body=$(printf '%s' "${2:-}" | jq -c . 2>/dev/null) || {
		hook_log "hook_raw: not JSON: ${2:-}"
		return 1
	}
	_pf_emit "$body" raw
}

trap _pf_on_exit EXIT

if pf_debug_on; then hook_debug "input: ${_pf_input:0:4000}"; fi

# --- matcher ---------------------------------------------------------------

# A host that ignores an event's matcher (Copilot on SessionStart, SessionEnd
# and SubagentStop) has the build pass it as PLUGINFINITY_MATCHER. Apply
# Claude's rules here: empty or `*` matches all; only [A-Za-z0-9_| ,-] is an
# exact `|` list; anything else is an unanchored extended regex. No match ends
# the script quietly, so nothing is emitted and the exit is 0.
_pf_matcher_applies() { # matcher value
	local m=$1 v=$2 item
	local -a items
	{ [ -z "$m" ] || [ "$m" = '*' ]; } && return 0
	if [[ ! "$m" =~ [^A-Za-z0-9_\|\ ,-] ]]; then
		IFS='|' read -r -a items <<<"$m"
		for item in "${items[@]}"; do
			[ "$item" = "$v" ] && return 0
		done
		return 1
	fi
	printf '%s' "$v" | grep -Eq -- "$m" 2>/dev/null
}

if [ -n "${PLUGINFINITY_MATCHER+x}" ]; then
	_pf_match_field=""
	case "$_pf_event" in
	SessionStart) _pf_match_field=source ;;
	SessionEnd) _pf_match_field=reason ;;
	SubagentStop) _pf_match_field=agent_type ;;
	esac
	if [ -n "$_pf_match_field" ]; then
		_pf_match_value=$(hook_input "$_pf_match_field")
		if ! _pf_matcher_applies "$PLUGINFINITY_MATCHER" "$_pf_match_value"; then
			hook_debug "matcher $PLUGINFINITY_MATCHER did not match $_pf_match_value"
			exit 0
		fi
	fi
fi

# --- session env ------------------------------------------------------------

# After the matcher, so a skipped hook does not pay for it. A build with no
# env.sh has no session env and this does nothing.
_pf_env_start

# shellcheck shell=sh
# pluginfinity monitor library. `pluginfinity build` writes this file into every
# target that has monitors, at lib/pluginfinity/monitor.sh; do not edit a copy
# under builds/, the next build overwrites it.
#
# POSIX sh. Writes to stdout only through monitor_notify: one line on stdout is
# one notification. Set _pf_lib_dir to this file's directory, source it, then
# call the functions. From a script at monitors/x.sh:
#   _pf_lib_dir="$(dirname "$0")/../lib/pluginfinity"; . "$_pf_lib_dir/monitor.sh"
#
# A monitor never exits non-zero because of an error inside one poll: the
# library logs it and the loop keeps going.
#
# monitor_notify cannot tell monitor_every that stdout closed when it runs inside
# $(...) or a pipeline subshell; call it directly from the polled function.
#
# PLUGINFINITY_MONITOR_MAX_TICKS=<n> is a contract every monitor honours: stop
# after n checks, however triggered (a poll, a startup sweep, or one handled
# event). n is a positive integer; monitor_every logs any other value once and
# ignores it (unbounded). monitor_every does it for you; a monitor that does not use it,
# such as a node `command` monitor, must honour it itself, because the bats
# helper's run_monitor sets it to bound a test. Do not set it in a plugin.

# POSIX sh cannot find a sourced file's own path, so the sourcer sets _pf_lib_dir
# (or _pf_log_dir, the log.sh convention) to this file's directory first. log.sh
# and host.sh live beside this file. Without a readable log.sh the logging
# functions are no-ops and the monitor still runs.
_pf_mon_dir="${_pf_lib_dir:-${_pf_log_dir:-.}}"
_pf_log_dir="$_pf_mon_dir"
if [ -r "$_pf_mon_dir/log.sh" ]; then
	# shellcheck source=/dev/null
	. "$_pf_mon_dir/log.sh"
else
	pf_log() { return 0; }
	pf_debug() { return 0; }
	pf_debug_on() { return 1; }
fi

# A closed stdout must surface as a failed write, not as SIGPIPE killing the monitor.
trap '' PIPE
_pf_mon_closed=0

monitor_name() { printf '%s\n' "${PLUGINFINITY_MONITOR:-$(basename "$0" .sh)}"; }
monitor_host() { printf '%s\n' "${PLUGINFINITY_HOST:-unknown}"; }
monitor_plugin_root() { (cd "$_pf_mon_dir/../.." 2>/dev/null && pwd -P) || printf '%s\n' "$_pf_mon_dir/../.."; }

monitor_project_dir() {
	if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
		printf '%s\n' "$CLAUDE_PROJECT_DIR"
		return 0
	fi
	_pf_g=$(git rev-parse --show-toplevel 2>/dev/null) || _pf_g=
	printf '%s\n' "${_pf_g:-$PWD}"
}

monitor_log() { pf_log monitor "$@"; }
monitor_debug() { pf_debug monitor "$@"; }

# monitor_notify <text...>: one line on stdout, flushed. Newlines become spaces.
# Returns 1 when stdout is closed (and monitor_every then stops).
monitor_notify() {
	_pf_t=$(printf '%s' "$*" | tr '\r\n' '  ')
	if [ -z "$_pf_t" ]; then
		monitor_debug "monitor_notify: empty text ignored"
		return 0
	fi
	if ! printf '%s\n' "$_pf_t" 2>/dev/null; then
		_pf_mon_closed=1
		return 1
	fi
	return 0
}

# monitor_state_dir: $XDG_STATE_HOME/pluginfinity/<plugin>/monitor/<name>/, created.
monitor_state_dir() {
	_pf_s="${XDG_STATE_HOME:-${HOME:-/nonexistent}/.local/state}/pluginfinity/${PLUGINFINITY_PLUGIN:-unknown}/monitor/$(monitor_name)/"
	mkdir -p "$_pf_s" 2>/dev/null || :
	printf '%s\n' "$_pf_s"
}

# monitor_once <key> <text...>: monitor_notify only the first time <key> is seen this session.
monitor_once() {
	_pf_k=${1:-}
	if [ $# -gt 0 ]; then shift; fi
	_pf_sd=$(monitor_state_dir)
	_pf_sess="${CLAUDE_CODE_SESSION_ID:-${CLAUDE_SESSION_ID:-$PPID}}"
	# Keys are made filename-safe; the session scopes the marker.
	_pf_m="$_pf_sd$(printf '%s' "$_pf_sess.$_pf_k" | tr -c 'A-Za-z0-9._-' '_')"
	if [ -e "$_pf_m" ]; then
		return 0
	fi
	monitor_notify "$@" || return 1
	: >"$_pf_m" 2>/dev/null || :
}

# monitor_every <seconds> <function>: call <function> now and every <seconds>, forever.
# A failing call is logged and the loop continues; a closed stdout ends it with exit 0.
monitor_every() {
	_pf_iv=${1:-}
	case "$_pf_iv" in
	'' | *[!0-9]*)
		monitor_log "monitor_every: interval '$_pf_iv' is not a number of seconds; using 60"
		_pf_iv=60
		;;
	esac
	_pf_fn=${2:-:}
	# PLUGINFINITY_MONITOR_MAX_TICKS is a positive integer; anything else is
	# logged once and treated as unset, so a test mistake never loops on an error.
	_pf_max=${PLUGINFINITY_MONITOR_MAX_TICKS:-}
	case "$_pf_max" in
	'') ;;
	*[!0-9]*)
		monitor_log "monitor_every: PLUGINFINITY_MONITOR_MAX_TICKS '$_pf_max' is not a positive integer; ignoring it"
		_pf_max=
		;;
	*)
		if [ "$_pf_max" -le 0 ] 2>/dev/null; then
			monitor_log "monitor_every: PLUGINFINITY_MONITOR_MAX_TICKS '$_pf_max' is not a positive integer; ignoring it"
			_pf_max=
		fi
		;;
	esac
	_pf_n=0
	while :; do
		if "$_pf_fn"; then _pf_rc=0; else _pf_rc=$?; fi
		if [ "$_pf_mon_closed" = 1 ]; then
			monitor_debug "stdout closed; stopping"
			exit 0
		fi
		if [ "$_pf_rc" -ne 0 ]; then
			monitor_log "$_pf_fn failed (exit $_pf_rc)"
		fi
		_pf_n=$((_pf_n + 1))
		if [ -n "$_pf_max" ] && [ "$_pf_n" -ge "$_pf_max" ]; then
			return 0
		fi
		sleep "$_pf_iv"
	done
}

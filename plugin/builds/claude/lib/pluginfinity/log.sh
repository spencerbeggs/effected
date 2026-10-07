# shellcheck shell=sh
# pluginfinity logging. `pluginfinity build` writes this file into every
# target at lib/pluginfinity/log.sh; do not edit a copy under builds/, the next
# build overwrites it.
#
# POSIX sh. Writes nothing to stdout. Set _pf_log_dir to this file's directory,
# source it, then call pf_log / pf_debug. From a skill script:
#   _pf_log_dir="$(dirname "$0")/../../../lib/pluginfinity"; . "$_pf_log_dir/log.sh"
#
# Lines go to ${XDG_STATE_HOME:-$HOME/.local/state}/pluginfinity/<plugin>/error.log
# and, when PLUGINFINITY_DEBUG=1, debug.log, as
#   <ISO-8601 UTC> [<host>] <component>/<script>: <message>

# POSIX sh cannot find a sourced file's own path, so the sourcer sets
# _pf_log_dir first. host.sh there names the host and plugin.
if [ -z "${PLUGINFINITY_PLUGIN:-}" ] && [ -n "${_pf_log_dir:-}" ] && [ -f "$_pf_log_dir/host.sh" ]; then
	# shellcheck source=/dev/null
	. "$_pf_log_dir/host.sh" 2>/dev/null || :
fi

_pf_log_write() { # file component message
	_pf_d="${XDG_STATE_HOME:-${HOME:-/nonexistent}/.local/state}/pluginfinity/${PLUGINFINITY_PLUGIN:-unknown}"
	mkdir -p "$_pf_d" 2>/dev/null || return 0
	printf '%s [%s] %s/%s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${PLUGINFINITY_HOST:-unknown}" \
		"$2" "$(basename "$0")" "$3" >>"$_pf_d/$1" 2>/dev/null || return 0
}

# True when PLUGINFINITY_DEBUG=1.
pf_debug_on() { [ "${PLUGINFINITY_DEBUG:-0}" = 1 ]; }

# pf_log <component> <message...>: append to error.log. Never fails.
pf_log() {
	_pf_c=${1:-}
	if [ $# -gt 0 ]; then shift; fi
	_pf_log_write error.log "$_pf_c" "$*"
	return 0
}

# pf_debug <component> <message...>: append to debug.log when PLUGINFINITY_DEBUG=1.
pf_debug() {
	pf_debug_on || return 0
	_pf_c=${1:-}
	if [ $# -gt 0 ]; then shift; fi
	_pf_log_write debug.log "$_pf_c" "$*"
	return 0
}

script_log() { pf_log script "$@"; }
script_debug() { pf_debug script "$@"; }

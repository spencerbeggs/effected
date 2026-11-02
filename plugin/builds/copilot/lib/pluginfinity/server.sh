# shellcheck shell=sh
# pluginfinity server library. `pluginfinity build` writes this file into every
# target that has a local MCP or LSP server; do not edit a copy under builds/,
# the next build overwrites it.
#
# Source it first in a launcher, and keep `set -u` (or write
# ${PLUGINFINITY_LIB:?run by the host}) so a launcher run outside the host fails loudly:
#   . "$PLUGINFINITY_LIB/server.sh"
#
# POSIX sh. Writes nothing to stdout, which carries the server's protocol.

_pf_server_lib_dir=$(cd "$(dirname "$PLUGINFINITY_LIB/server.sh")" && pwd -P)

# log.sh sits beside this file.
_pf_log_dir=$_pf_server_lib_dir
# shellcheck source=/dev/null
. "$_pf_log_dir/log.sh"

# claude or copilot.
server_host() { printf '%s\n' "${PLUGINFINITY_HOST:-unknown}"; }

# The build root the launcher runs from.
server_plugin_root() { (cd "$_pf_server_lib_dir/../.." && pwd -P); }

# Append a line to the plugin's error log.
server_log() { pf_log server "$*"; }
# Append a line to the plugin's debug log when PLUGINFINITY_DEBUG=1.
server_debug() { pf_debug server "$*"; }

# The project the session works in. Prints it and returns 0, or prints nothing
# and returns 1 when there is none to report:
#   - Claude with CLAUDE_PROJECT_DIR set: that directory.
#   - Otherwise, when the working directory is the plugin root or inside it:
#     nothing, status 1. Copilot starts an MCP server with its cwd at the plugin
#     root and gives it no project directory, so that cwd says nothing about the
#     project. A Copilot MCP server cannot learn the project: its client offers
#     no roots and no variable names it (measured 2026-10-07).
#   - Otherwise: the closest directory above $PWD holding .git, else $PWD
#     (Copilot starts LSP servers at the git root).
server_project_dir() {
	if [ "${PLUGINFINITY_HOST:-}" = claude ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
		printf '%s\n' "$CLAUDE_PROJECT_DIR"
		return 0
	fi
	_pf_root=$(server_plugin_root)
	_pf_cwd=$(pwd -P)
	case "$_pf_cwd" in
	"$_pf_root" | "$_pf_root"/*) return 1 ;;
	esac
	_pf_probe=$PWD
	while [ -n "$_pf_probe" ] && [ "$_pf_probe" != / ]; do
		if [ -e "$_pf_probe/.git" ]; then
			printf '%s\n' "$_pf_probe"
			return 0
		fi
		_pf_probe=$(dirname "$_pf_probe")
	done
	printf '%s\n' "$PWD"
}

# npm, pnpm, yarn or bun. With jq on PATH: package.json's devEngines.packageManager
# (an object, or an array whose first entry is used) name, then packageManager.
# Without jq only the top-level packageManager field is read (devEngines is
# ignored). Then lockfiles, else npm. A name other than the four is npm.
_pf_detect_pm() { # project
	_pf_pm=""
	if [ -f "$1/package.json" ]; then
		if command -v jq >/dev/null 2>&1; then
			_pf_pm=$(jq -r '((try (.devEngines.packageManager | if type == "array" then .[0] else . end | .name) catch null) | strings) // (.packageManager | strings) // empty' \
				"$1/package.json" 2>/dev/null | cut -d@ -f1)
		else
			_pf_pm=$(grep -o '"packageManager"[[:space:]]*:[[:space:]]*"[^"]*"' "$1/package.json" 2>/dev/null |
				sed -E 's/.*:[[:space:]]*"([^@"]*).*/\1/')
		fi
	fi
	case "$_pf_pm" in
	npm | pnpm | yarn | bun)
		printf '%s\n' "$_pf_pm"
		return 0
		;;
	*) ;;
	esac
	if [ -f "$1/pnpm-lock.yaml" ]; then
		printf 'pnpm\n'
	elif [ -f "$1/bun.lock" ] || [ -f "$1/bun.lockb" ]; then
		printf 'bun\n'
	elif [ -f "$1/yarn.lock" ]; then
		printf 'yarn\n'
	else
		printf 'npm\n'
	fi
}

_pf_install_line() { # pm package
	case "$1" in
	pnpm) printf '  pnpm add -D %s\n' "$2" ;;
	yarn) printf '  yarn add -D %s\n' "$2" ;;
	bun) printf '  bun add -d %s\n' "$2" ;;
	*) printf '  npm install --save-dev %s\n' "$2" ;;
	esac
}

# Exec the project's node_modules/.bin/<bin>, else run <package> with the
# project's package manager (pnpm dlx, yarn dlx, bunx, or npx --yes; see
# _pf_detect_pm). npm 11 refuses to run in a project whose devEngines names
# another manager, so npx is only the runner for npm projects, for a manager
# that is not on PATH (said on stderr), and when there is no project directory
# (see server_project_dir), which skips the lookup and the install hint. An
# optional `--install <package>` straight after the two positionals names a
# different package in the install hint only; the runner still runs <package>.
# Later args pass through untouched.
server_exec_bin() { # bin package [--install install-package] [args...]
	_pf_bin=$1
	_pf_pkg=$2
	_pf_install=$2
	shift 2
	if [ "${1:-}" = --install ] && [ $# -ge 2 ]; then
		_pf_install=$2
		shift 2
	fi
	_pf_runner=npx
	if _pf_project=$(server_project_dir); then
		if [ -x "$_pf_project/node_modules/.bin/$_pf_bin" ]; then
			exec "$_pf_project/node_modules/.bin/$_pf_bin" "$@"
		fi
		_pf_pm=$(_pf_detect_pm "$_pf_project")
		{
			printf '%s: %s is not installed in %s.\n' "${PLUGINFINITY_PLUGIN:-plugin}" "$_pf_bin" "$_pf_project"
			printf 'Install it with:\n'
			_pf_install_line "$_pf_pm" "$_pf_install"
		} >&2
		case "$_pf_pm" in
		pnpm | yarn) _pf_runner=$_pf_pm ;;
		bun) _pf_runner=bunx ;;
		esac
		if [ "$_pf_runner" != npx ] && ! command -v "$_pf_runner" >/dev/null 2>&1; then
			printf '%s was not found on PATH.\n' "$_pf_runner" >&2
			_pf_runner=npx
		fi
	else
		printf '%s: no project directory is known, so %s cannot be looked up in node_modules.\n' \
			"${PLUGINFINITY_PLUGIN:-plugin}" "$_pf_bin" >&2
	fi
	case "$_pf_runner" in
	pnpm | yarn)
		printf 'Falling back to "%s dlx %s".\n' "$_pf_runner" "$_pf_pkg" >&2
		server_debug "server_exec_bin: running $_pf_pkg with $_pf_runner dlx"
		exec "$_pf_runner" dlx "$_pf_pkg" "$@"
		;;
	bunx)
		printf 'Falling back to "bunx %s".\n' "$_pf_pkg" >&2
		server_debug "server_exec_bin: running $_pf_pkg with bunx"
		exec bunx "$_pf_pkg" "$@"
		;;
	esac
	printf 'Falling back to "npx --yes %s".\n' "$_pf_pkg" >&2
	server_debug "server_exec_bin: running $_pf_pkg with npx --yes"
	exec npx --yes "$_pf_pkg" "$@"
}

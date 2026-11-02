#!/bin/sh
# start-mcp.sh — the effected-mcp launcher, on the pluginfinity server library.
# stdout is the protocol wire: nothing here prints to it before the exec.
#
# Execs the project's node_modules/.bin/effected-mcp when it is installed;
# otherwise server_exec_bin prints the @effected/plugin install line for the
# project's package manager on stderr and falls back to a one-off run of
# @effected/mcp.

set -eu
. "$PLUGINFINITY_LIB/server.sh"

server_exec_bin effected-mcp @effected/mcp --install @effected/plugin "$@"

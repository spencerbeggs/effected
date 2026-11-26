#!/usr/bin/env bash
# SubagentStart hook: give this plugin's three code-writing agents the
# absolute paths of the lookup maps. A subagent gets no SessionStart briefing,
# and an agent body cannot name a skill's directory on every host, so without
# this the "grep the construct index" step names a directory the agent has to
# hunt for. Every other subagent, including tsdoc-fixer, gets nothing.
#
# No matcher on the entry: Copilot ignores a SubagentStart matcher and what it
# sends as agent_type is not measured, so the script filters on the name's
# suffix (a bare "effect-developer" or a plugin-scoped "effected:effect-developer").

set -euo pipefail
# shellcheck source=/dev/null
. "$(dirname "$0")/../lib/pluginfinity/hook.sh"

AGENT_TYPE="$(hook_input agent_type)"
case "$AGENT_TYPE" in
effect-developer | *:effect-developer | effect-reviewer | *:effect-reviewer | action-engineer | *:action-engineer) ;;
*)
	hook_noop
	exit 0
	;;
esac

PLUGIN_ROOT="$(hook_plugin_root)"
CONSTRUCTS="$PLUGIN_ROOT/skills/effected-packages/references/constructs"
PACKAGE_REFS="$PLUGIN_ROOT/skills/effected-packages/references"
MODULE_INDEX="$PLUGIN_ROOT/skills/effect-v4-module-index/SKILL.md"

hook_context "$(
	cat <<CONTEXT
<effected_maps>
The lookup maps, at absolute paths in this install:
- The kit's construct index, one file per @effected package:
  ${CONSTRUCTS}
  Grep it by intent: grep -ri "walk" "${CONSTRUCTS}"
- Each package's reference: ${PACKAGE_REFS}/<package>.md
- Core's module map, "Routing by task" first: ${MODULE_INDEX}

Before you write a helper over files, paths, globs, YAML, JSON, TOML,
package.json, semver, subprocesses, HTTP, retries, caches, temp directories,
CLI parsing or MCP, grep the index, read the core map, and name the construct
you will use or the words you grepped and why no hit fits.
</effected_maps>
CONTEXT
)"

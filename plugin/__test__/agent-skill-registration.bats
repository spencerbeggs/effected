#!/usr/bin/env bats
# agent-skill-registration.bats — pins WHERE each skill is registered in an
# agent's YAML frontmatter, not merely that the name appears somewhere in it.
#
# This exists because a presence check cannot catch a key in the wrong array.
# The sibling roster test asserts the SessionStart briefing mentions every
# skill; a skill listed under `tools:` instead of `skills:` would satisfy that
# test while never being preloaded by the agent. `grep -q effect-v4-cli` is
# true in both worlds. The assertion has to discriminate the KEY, so these
# tests extract the `skills:` block specifically and search only inside it.

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
AGENTS="$PLUGIN_ROOT/agents"

# _skills_block agent_file — prints the list items under the top-level
# `skills:` key, stopping at the next top-level key. Anything under `tools:`
# (or any other key) is excluded by construction.
_skills_block() {
	awk '
		/^skills:[[:space:]]*$/ { inblock = 1; next }
		/^[A-Za-z_-]+:/         { inblock = 0 }
		inblock && /^[[:space:]]*-[[:space:]]+/ {
			sub(/^[[:space:]]*-[[:space:]]+/, "")
			print
		}
	' "$1"
}

# _tools_block agent_file — same, for the `tools:` key.
_tools_block() {
	awk '
		/^tools:[[:space:]]*$/ { inblock = 1; next }
		/^[A-Za-z_-]+:/        { inblock = 0 }
		inblock && /^[[:space:]]*-[[:space:]]+/ {
			sub(/^[[:space:]]*-[[:space:]]+/, "")
			print
		}
	' "$1"
}

@test "every agent declares a non-empty skills block" {
	for agent in effect-developer effect-migrator effect-reviewer; do
		run _skills_block "$AGENTS/$agent.md"
		[ "$status" -eq 0 ]
		[ -n "$output" ] || {
			echo "agent $agent has an empty or missing skills: block" >&2
			return 1
		}
	done
}

@test "effect-v4-cli is registered under skills, in all three agents" {
	for agent in effect-developer effect-migrator effect-reviewer; do
		_skills_block "$AGENTS/$agent.md" | grep -qx -- "effect-v4-cli" || {
			echo "agent $agent does not list effect-v4-cli under skills:" >&2
			return 1
		}
	done
}

@test "no skill name leaks into an agent's tools block" {
	# A skill in tools: is the exact bug this file exists to catch — it would
	# still satisfy any test that merely greps the file for the skill name.
	for agent in effect-developer effect-migrator effect-reviewer; do
		for skill in "$PLUGIN_ROOT"/skills/*/; do
			name="$(basename "$skill")"
			if _tools_block "$AGENTS/$agent.md" | grep -qx -- "$name"; then
				echo "agent $agent lists the SKILL '$name' under tools:" >&2
				return 1
			fi
		done
	done
}

@test "every skill an agent names actually exists on disk" {
	for agent in effect-developer effect-migrator effect-reviewer; do
		while IFS= read -r name; do
			[ -f "$PLUGIN_ROOT/skills/$name/SKILL.md" ] || {
				echo "agent $agent names skill '$name', which has no SKILL.md" >&2
				return 1
			}
		done < <(_skills_block "$AGENTS/$agent.md")
	done
}

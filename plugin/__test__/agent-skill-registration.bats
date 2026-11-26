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
	for agent in effect-developer effect-reviewer action-engineer tsdoc-fixer; do
		run _skills_block "$AGENTS/$agent.md"
		[ "$status" -eq 0 ]
		[ -n "$output" ] || {
			echo "agent $agent has an empty or missing skills: block" >&2
			return 1
		}
	done
}

@test "effect-v4-cli is registered under skills, in both Effect agents" {
	for agent in effect-developer effect-reviewer; do
		_skills_block "$AGENTS/$agent.md" | grep -qx -- "effect-v4-cli" || {
			echo "agent $agent does not list effect-v4-cli under skills:" >&2
			return 1
		}
	done
}

@test "design-patterns is registered under skills, in both Effect agents" {
	for agent in effect-developer effect-reviewer; do
		_skills_block "$AGENTS/$agent.md" | grep -qx -- "design-patterns" || {
			echo "agent $agent does not list design-patterns under skills:" >&2
			return 1
		}
	done
}

@test "effect-v4-mcp is registered under skills, in both Effect agents" {
	# An agent dispatched to build or review an MCP server must arrive with the
	# MCP skill preloaded; a mention anywhere else in the file does not preload it.
	for agent in effect-developer effect-reviewer; do
		_skills_block "$AGENTS/$agent.md" | grep -qx -- "effect-v4-mcp" || {
			echo "agent $agent does not list effect-v4-mcp under skills:" >&2
			return 1
		}
	done
}

@test "effect-v4-testing is registered under skills, in both Effect agents" {
	# The developer is told to prefer writing the test first, and a consumer may
	# adopt with that agent alone; the testing skill's false-green catalogue has
	# to arrive preloaded, not one Skill call away.
	for agent in effect-developer effect-reviewer; do
		_skills_block "$AGENTS/$agent.md" | grep -qx -- "effect-v4-testing" || {
			echo "agent $agent does not list effect-v4-testing under skills:" >&2
			return 1
		}
	done
}

@test "designing-an-action is registered under skills, in action-engineer" {
	# Pins the fix for the round-2 audit finding: action-engineer had no path,
	# preloaded or on-demand, to the one skill that sequences a whole action
	# build. A future edit that silently drops it from frontmatter must fail
	# here instead of round-tripping that audit.
	_skills_block "$AGENTS/action-engineer.md" | grep -qx -- "designing-an-action" || {
		echo "agent action-engineer does not list designing-an-action under skills:" >&2
		return 1
	}
}

@test "all fifteen Actions skills are registered under skills, in action-engineer" {
	# Pins the forward decision in the skills-rewrite spec: the whole Actions
	# suite is preloaded, not a core plus an on-demand tail. A future edit that
	# drops one of the four skills the split used to defer on demand
	# (actions-cache-and-artifacts, supply-chain-attestation,
	# running-commands-and-tools, release-and-publish), or drops the net-new
	# structuring-an-action, must fail here. bootstrapping-an-action joined so
	# the agent can be dispatched by it with the interview's plan in hand.
	local expected="building-a-github-action designing-an-action structuring-an-action bootstrapping-an-action actions-runtime actions-inputs-outputs actions-reporting actions-state-and-secrets actions-cache-and-artifacts github-api github-app-tokens running-commands-and-tools release-and-publish supply-chain-attestation testing-actions"
	for skill in $expected; do
		_skills_block "$AGENTS/action-engineer.md" | grep -qx -- "$skill" || {
			echo "agent action-engineer does not list $skill under skills:" >&2
			return 1
		}
	done
}

@test "the build and TSDoc skills are registered under skills, in tsdoc-fixer" {
	# The fixer's contract is "follow the skills exactly": the release-tag policy,
	# the _base and {@link} rules, and the issues.json read order must all arrive
	# preloaded, not one Skill call away.
	for skill in authoring-tsdoc effect-api-extractor-bases building-a-package; do
		_skills_block "$AGENTS/tsdoc-fixer.md" | grep -qx -- "$skill" || {
			echo "agent tsdoc-fixer does not list $skill under skills:" >&2
			return 1
		}
	done
}

@test "no skill name leaks into an agent's tools block" {
	# A skill in tools: is the exact bug this file exists to catch — it would
	# still satisfy any test that merely greps the file for the skill name.
	for agent in effect-developer effect-reviewer action-engineer tsdoc-fixer; do
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
	for agent in effect-developer effect-reviewer action-engineer tsdoc-fixer; do
		while IFS= read -r name; do
			[ -f "$PLUGIN_ROOT/skills/$name/SKILL.md" ] || {
				echo "agent $agent names skill '$name', which has no SKILL.md" >&2
				return 1
			}
		done < <(_skills_block "$AGENTS/$agent.md")
	done
}

@test "the agent roster is exactly the four specialists" {
	# The v3 migration framing is retired: effect-migrator was deleted along
	# with the construct-map skill. A re-added migrator agent, or a silently
	# dropped specialist, must fail here rather than reaching the marketplace.
	local found
	found="$(cd "$AGENTS" && ls -1 *.md | sed 's/\.md$//' | sort | tr '\n' ' ')"
	[ "$found" = "action-engineer effect-developer effect-reviewer tsdoc-fixer " ] || {
		echo "agent roster is '$found', expected the four specialists" >&2
		return 1
	}
}

@test "the three code-writing agents preload both maps and the source ladder" {
	# The maps are what stop a hand-rolled helper: core's module index, the
	# kit's package index with its construct index, and the evidence ladder.
	# Every other preload is territory; these three are the lookup itself.
	local agent skill
	for agent in effect-developer effect-reviewer action-engineer; do
		for skill in effect-v4-module-index effected-packages effect-v4-source-lookup; do
			_skills_block "$AGENTS/$agent.md" | grep -qx -- "$skill" || {
				echo "agent $agent does not list $skill under skills:" >&2
				return 1
			}
		done
	done
}

@test "the three code-writing agents carry the lookup gate in their body" {
	# A preload is not an instruction: the body must say to grep the construct
	# index and name the construct, so the gate holds on Copilot too, where
	# nothing is preloaded.
	local agent
	for agent in effect-developer effect-reviewer action-engineer; do
		grep -qF "references/constructs/" "$AGENTS/$agent.md" || {
			echo "agent $agent never names the construct index" >&2
			return 1
		}
		grep -qF "Routing by task" "$AGENTS/$agent.md" || {
			echo "agent $agent never names core's routing table" >&2
			return 1
		}
	done
}

@test "every Copilot agent build tells the agent to read its skills first" {
	# Copilot preloads nothing; the source's copilot host block is the only
	# thing that makes the agent read the maps before it acts.
	local agent built
	for agent in effect-developer effect-reviewer action-engineer tsdoc-fixer; do
		built="$PLUGIN_ROOT/builds/copilot/com.github.copilot/agents/$agent.agent.md"
		grep -qF "This host does not preload skills" "$built" || {
			echo "copilot $agent has no read-first instruction" >&2
			return 1
		}
		! grep -qF "This host does not preload skills" "$PLUGIN_ROOT/builds/claude/agents/$agent.md" || {
			echo "claude $agent carries the copilot-only read-first block" >&2
			return 1
		}
	done
}

@test "the three code-writing agents run a simplifier pass and report it" {
	# Simplifier passes catch defects green tests miss; the step, its stop
	# condition and its line in the report must all survive an edit.
	local agent
	for agent in effect-developer effect-reviewer action-engineer; do
		grep -qF "simplifier pass" "$AGENTS/$agent.md" || {
			echo "agent $agent has no simplifier pass" >&2
			return 1
		}
		grep -qF "after two rounds" "$AGENTS/$agent.md"
		# Prose wraps, so match on the file with its lines joined.
		tr '\n' ' ' <"$AGENTS/$agent.md" | tr -s ' ' | grep -qF "Never skip the pass because the tests are green" || {
			echo "agent $agent does not forbid skipping the pass on green" >&2
			return 1
		}
		grep -qF '"no change"' "$AGENTS/$agent.md" || {
			echo "agent $agent does not report the pass's outcome" >&2
			return 1
		}
	done
	tr '\n' ' ' <"$AGENTS/effect-reviewer.md" | tr -s ' ' | grep -qF "a simplification that changes behaviour is a defect finding"
}

@test "Claude builds name the simplify skill; Copilot builds carry the inline checklist" {
	local agent claude copilot
	for agent in effect-developer effect-reviewer action-engineer; do
		claude="$PLUGIN_ROOT/builds/claude/agents/$agent.md"
		copilot="$PLUGIN_ROOT/builds/copilot/com.github.copilot/agents/$agent.agent.md"
		grep -qF 'built-in `simplify` skill' "$claude" || {
			echo "claude $agent does not name the simplify skill" >&2
			return 1
		}
		! grep -qF 'built-in `simplify` skill' "$copilot" || {
			echo "copilot $agent names a skill the host does not have" >&2
			return 1
		}
		for item in "**Reuse**" "**Duplication and dead code**" "**Needless abstraction**" \
			"**A simpler v4 spelling**" "**Efficiency**"; do
			grep -qF -- "$item" "$copilot" || {
				echo "copilot $agent lacks checklist item $item" >&2
				return 1
			}
			! grep -qF -- "$item" "$claude" || {
				echo "claude $agent carries the copilot checklist item $item" >&2
				return 1
			}
		done
	done
}

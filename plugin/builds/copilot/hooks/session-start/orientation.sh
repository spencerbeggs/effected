#!/usr/bin/env bash
# SessionStart hook (no matcher: fires on every start, resume and compact, on
# both hosts): brief the main agent on the lookup ritual this plugin exists
# for. Before it writes a helper, it greps the kit's construct index and reads
# core's module map, at the absolute paths this build ships, and names the
# construct it chose. Then: its Effect knowledge is out of date, the
# specialists to delegate to, and every skill and agent by name.
#
# Also reports the vendored-source posture: whether the session's project
# vendors Effect v4 source at .repos/effect and whether that pin matches the
# kit's current pin.
#
# One script serves Claude Code and Copilot. The pluginfinity hook library
# reads the envelope, resolves the session's project and writes each host's
# response shape (nested hookSpecificOutput on Claude Code, a flat
# additionalContext on Copilot). Without jq the library makes the hook a
# silent no-op. Nothing here may write to stdout except the final hook_context.
#
# Subagents get no SessionStart briefing: hooks/subagent-start/maps.sh gives
# the plugin's own agents the same paths.

set -euo pipefail
# shellcheck source=/dev/null
. "$(dirname "$0")/../lib/pluginfinity/hook.sh"

# The kit's current Effect pin. ONE-LINE MAINTENANCE: bump this whenever the
# lockfile's resolved effect moves (the effect catalog is a range, so the
# exact version is the lockfile's, not the catalog's). It is
# deliberately a constant rather than read from the host repo's catalog — the
# point is to tell a LAGGING repo what it should move to, so comparing against
# that repo's own (possibly stale) catalog would defeat the check.
EFFECT_PIN="4.1.6"

# --- vendored-source posture -------------------------------------------------
# The session's project: CLAUDE_PROJECT_DIR on Claude Code, else the envelope's
# cwd walked up to its git root (Copilot gives no project-root variable).
PROJECT_DIR="$(hook_session_dir)"
VENDOR_NOTE=""

if [ ! -f "$PROJECT_DIR/.gitmodules" ]; then
	VENDOR_NOTE="This repo has NO .gitmodules, so Effect's source is not vendored.
Read node_modules/effect/src for what exists and its signature: it is the
installed release, complete. Vendoring adds Effect's own notes and docs at
.repos/effect: offer the user to add it with silk's repos skill (/silk:repos,
or \`savvy repos add\`), pinned to effect@${EFFECT_PIN}, rather than a
hand-rolled \`git submodule add\`."
elif ! grep -q '\.repos/effect' "$PROJECT_DIR/.gitmodules" 2>/dev/null; then
	VENDOR_NOTE="This repo has a .gitmodules but NO .repos/effect entry, so Effect's
source is not vendored. Read node_modules/effect/src for what exists and its
signature. To vendor it, use silk's repos skill (/silk:repos, or
\`savvy repos add\`), pinned to effect@${EFFECT_PIN}, rather than a hand-rolled
\`git submodule add\`."
else
	VENDORED_REF=""
	if [ -f "$PROJECT_DIR/.repos/config.json" ]; then
		VENDORED_REF=$(jq -r '.repos.effect.ref // ""' "$PROJECT_DIR/.repos/config.json" 2>/dev/null || echo "")
	fi
	if [ "$VENDORED_REF" = "effect@${EFFECT_PIN}" ]; then
		VENDOR_NOTE="Effect v4 source is vendored at .repos/effect and pinned to
effect@${EFFECT_PIN}, which matches the kit's current pin. Read it freely; it is
the authority on what v4 exports. It is READ-ONLY — never write under .repos/."
	else
		VENDOR_NOTE="Effect v4 source is vendored at .repos/effect, but its pin is
\"${VENDORED_REF:-unknown}\" and the kit's current pin is effect@${EFFECT_PIN}.
A stale vendored pin is worse than none: you will read a source tree that does
not match the installed effect and reach confident wrong conclusions. You MUST
re-pin before trusting anything you read there — use silk's repos skill
(/silk:repos, or \`savvy repos pin effect effect@${EFFECT_PIN}\`), and fold the
staged gitlink into the same commit as the version bump. If the installed
effect and the vendored source ever disagree, node_modules wins."
	fi
fi

# --- the maps ----------------------------------------------------------------
# Absolute paths into this build, so the ritual below is a command the agent
# can run as written rather than a skill name it has to resolve.
PLUGIN_ROOT="$(hook_plugin_root)"
CONSTRUCTS="$PLUGIN_ROOT/skills/effected-packages/references/constructs"
PACKAGE_REFS="$PLUGIN_ROOT/skills/effected-packages/references"
MODULE_INDEX="$PLUGIN_ROOT/skills/effect-v4-module-index/SKILL.md"

CONTEXT=$(
	cat <<CONTEXT
<effect_plugin>
The "effected" plugin is loaded: skills and four specialist agents for Effect v4
and the @effected kit.

<lookup_before_writing>
Before you write a helper, a service or a module, look it up. The @effected kit
and Effect core already ship most of what a task needs, and the costly misses in
this kit were hand-rolled helpers whose replacement was already installed.

1. Name the capability as a verb and an object: "parse YAML", "walk a
   directory", "match a glob", "read package.json", "compare versions", "run a
   command", "retry a request", "temp directory", "in-memory filesystem for a
   test", "CLI flags", "MCP tool".
2. Grep the kit's construct index for those words, one file per package:
   grep -ri "walk" "${CONSTRUCTS}"
   Then read the package reference the hit names:
   ${PACKAGE_REFS}/<package>.md
3. Read the "Routing by task" table and the module rows of core's map:
   ${MODULE_INDEX}
4. Confirm the export and its signature in source (effect-v4-source-lookup)
   before you call it.
5. Say which construct you will use, or which words you grepped and why no hit
   fits, before you write the code.

Stop and run steps 2 and 3 when you are about to write code over files, paths,
globs, YAML, JSON, JSONC, TOML, Markdown, package.json, tsconfig, lockfiles,
semver, subprocesses, HTTP, retries, caches, temp directories, environment
config, CLI parsing, prompts or MCP, and have not run them in this task. Skip
them only for code that composes constructs you already confirmed this task.
</lookup_before_writing>

<do_not_guess>
What you know about Effect from training is out of date. This project is Effect
v4, a redesign whose API differs from the one most training data shows. There is
no Either module, no Context.Tag, and no @effect/cli or @effect/sql package; CLI,
SQL, HTTP, AI and the platform contracts are modules of core. A name that feels
familiar is the signal to look it up, not to write it.

- Delegate Effect work when dispatch is available: effect-developer writes it,
  effect-reviewer reviews and tests it, action-engineer owns GitHub Actions and
  GitHub API code. Each arrives with the skills and this lookup ritual, and
  runs a simplifier pass over its diff before it reports.
- Without dispatch, load the skills yourself: effect-v4-planning before a
  design, then the skill for the construct you are writing.
- The vendored source settles what exists and its signature. Only a probe run
  from inside a package settles behaviour.
</do_not_guess>

<vendored_source>
${VENDOR_NOTE}
</vendored_source>

<skills>
Load with the Skill tool; most also load on their own trigger.
The maps, read before writing:
- effect-v4-module-index — what Effect core ships, by task and by module
- effected-packages — what each @effected package ships, with the construct index
- effect-v4-source-lookup — confirming an API exists, its signature, its behaviour
Effect v4:
- effect-v4-planning — the design summary to write before implementation code
- effect-v4-house-style — module layout, naming, error taxonomy, layer and test habits
- effect-v4-schema — Schema classes, structs, optionality, checks, codecs, brands
- effect-v4-services-layers — Context.Service, Layer composition, memoization
- effect-v4-idioms — generators, typed errors, Result, Scope, fibers, Config
- effect-v4-cli — effect/cli and @effected/cli-kit: output, exit codes, prompts, Ink
- effect-v4-mcp — MCP servers on effect/ai and @effected/mcp-kit
- effect-v4-observability — logging, spans, metrics, OpenTelemetry at the edge
- effect-v4-testing — @effect/vitest, test layers, property tests, false greens
- design-patterns — proven architectures, such as one carrier package for several bins
- hardening-a-parser-port — depth guards and typed failures for untrusted text
- building-a-format-package — the shared shape of the jsonc/yaml/toml/markdown packages
Building and publishing a kit package:
- building-a-package — effected package build, effected.toml, dist/prod/issues.json
- authoring-tsdoc — release tags and every ae-*/tsdoc-* fix
- effect-api-extractor-bases — class-factory bases and {@link} selectors
- building-schemastore-schemas — JSON Schema from Effect Schemas, the drift gate
- upgrade — /effected:upgrade, user-invoked: move a repository onto a new kit release
GitHub Actions and the GitHub API (start at the router):
- building-a-github-action — the router: which package and skill owns a capability
- designing-an-action — the build order for a new, rebuilt or ported action
- structuring-an-action — where each piece of an action's code belongs
- bootstrapping-an-action — user-invoked only: the template interview
- actions-runtime — Action.run and the runtime layer
- actions-inputs-outputs — ActionInput, ActionOutputs, output contracts
- actions-reporting — logs, summaries, check runs, pull-request comments
- actions-state-and-secrets — ActionState, Secret, DryRun, detached processes
- actions-cache-and-artifacts — caches, artifacts, blob stores, tool installs
- github-api — typed REST and GraphQL calls, pagination, GitHubError
- github-app-tokens — App and plain tokens and their lifecycle
- running-commands-and-tools — subprocesses, tool discovery, redaction
- release-and-publish — npm registry reads, publishing, release tags
- supply-chain-attestation — SBOM, in-toto, SLSA, Sigstore, attestations
- testing-actions — makeTest/layerTest doubles and the scripted octokit harness
</skills>

<agents>
- effect-developer — writes new Effect v4 code: schemas, services, layers, CLIs, MCP servers
- effect-reviewer — reviews Effect v4 code and writes or strengthens its tests
- action-engineer — builds, extends or debugs a GitHub Action, a release pipeline or GitHub API code
- tsdoc-fixer — drives a package's ae-*/tsdoc-* build diagnostics to zero in source
</agents>

The effected MCP server is bundled; its tools work once the project installs
@effected/plugin.

<dogfood_feedback>
The plugin and the @effected packages are being dogfooded. Note, as you go, any
skill, agent or briefing that gave wrong or confusing guidance, or that
recommended an API the installed \`effect\` does not have; and any @effected
package with a gap, an awkward API, or a capability you had to write yourself.
Ask dispatched agents to report both. At the end of the session, list what you
noticed and ask the user whether to open an issue. Open one
(\`gh issue create --repo spencerbeggs/effected\`) only when the user says yes.
</dogfood_feedback>
</effect_plugin>
CONTEXT
)

hook_context "$CONTEXT"

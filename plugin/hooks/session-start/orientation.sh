#!/usr/bin/env bash
set -euo pipefail

# SessionStart hook (no matcher — fires on all starts including resume/compact):
# brief the main agent that the "effected" plugin ships Effect v4 skills and
# three specialist subagents, and that it should delegate Effect work to them.
#
# Contract: reads the SessionStart envelope on stdin (drained, unused), writes
# an additionalContext briefing to stdout as hookSpecificOutput JSON.

# shellcheck source=../lib/hook-output.sh
. "${CLAUDE_PLUGIN_ROOT}/hooks/lib/hook-output.sh"

# Fail open without jq (emit_context builds JSON with jq).
if ! command -v jq &>/dev/null; then
	emit_noop
	exit 0
fi

# Drain the envelope on stdin; we do not need any field from it.
cat >/dev/null 2>&1 || true

CONTEXT=$(
	cat <<'CONTEXT'
<effect_plugin>
The "effected" plugin is loaded: Effect v4 development skills plus three
specialist subagents, distilled from the @effected package migrations and the
official Effect-TS v4 guides. Everything here is v4-first — when writing Effect,
verify any API against the installed `effect` beta, never v3 memory (a runtime
probe beats an hour of type-error archaeology).

<skills>
Available via the Skill tool (several also auto-load on trigger):
- effect-v4-planning — the design-first gate: run before writing any
  implementation code. Walks four design pillars (data types, errors,
  services/layers, observability, testing) and requires a compact design
  summary before Schema.Struct/Context.Service gets touched.
- effect-v4-module-index — the routing map for Effect core: every core module
  (plus the unstable namespaces) in one what-it-is / when-to-reach-for-it
  table. Consult FIRST when deciding which module a task needs.
- effected-packages — the routing map for the @effected kit: what each of the
  18 packages contains, when to reach for it, and a per-package reference
  (services, usage, testing machinery). Consult before building lockfile/
  config/glob/semver/XDG/workspace/git capability the kit already ships.
- effect-v4-source-lookup — the evidence ladder for confirming a v4 API before
  relying on it: migration notes settle renames, vendored source settles
  existence and signature, only a probe settles semantics.
- effect-v4-house-style — the cross-cutting house style: module layout and the
  cycle firewall, naming, typed-error taxonomy, TSDoc habits, layer
  conventions, test organization, observability posture.
- effect-v4-schema — the one Schema skill (the flagship): house "do this, not this"
  rules + worked patterns (Class-vs-Struct, optionality, checks/refine/makeFilter,
  codecs, the FromString static, make-vs-new, brand/Opaque, custom Equal/Hash) on
  top of Effect's canonical guide split into loadable references/.
- effect-v4-services-layers — Context.Service class form, Layer composition, and
  the memoization discipline (build-once-by-reference; the layer-function trap).
- effect-v4-idioms — core Effect: typed errors, Result (Either is gone),
  generators, scope/resources, forking, structural equality.
- effect-v4-cli — @effect/cli is DEAD on the v4 line; the CLI framework is
  effect/unstable/cli in core. Command.Environment, tier impact, exit codes.
- effect-v4-observability — spans/logging/metrics; OTel composed at the edge,
  libraries telemetry-agnostic, named spans on public fallible boundaries only.
- effect-v4-testing — @effect/vitest, it.effect, test layers, property tests,
  and the false greens (a "0 tests passed" run that exits 0, TestClock at the
  epoch, an accumulating TestConsole).
- effect-v4-construct-map — the comprehensive v3→v4 migration reference, plus
  the ordered migration checklist (references/migration-checklist.md): deps,
  silent behavior changes, blocking removals, then the mechanical renames.
- effect-api-extractor-bases — inline class factories + the narrow _base
  suppression for a zero-warning API (no @public X_base const).
- hardening-a-parser-port — depth guards, code-point/proto/C0 checks, and the
  malformed-input-fails-as-a-typed-error-never-a-defect invariant.
</skills>

<agents>
Prefer delegating a whole Effect task to one of these specialists via the Agent
tool over hand-rolling it inline — each arrives with the relevant skills
preloaded and carries the discipline end to end:
- effect-developer — writing NEW Effect v4 code (schemas, services, layers,
  typed errors, CLIs). Delegate feature implementation here.
- effect-reviewer — REVIEWING v4 code for idiom, error-channel, and API-surface
  correctness, and writing or strengthening @effect/vitest tests. Delegate
  review and test authoring here.
- effect-migrator — MIGRATING any Effect v3 codebase to v4: library ports
  behind a characterization gate, or in-place application upgrades driven by
  the migration checklist. Delegate migration work here.
</agents>

When a task is substantially "write / review / migrate Effect code," dispatch
the matching agent rather than doing it inline with the skills — they enforce
the verify-against-installed-beta, typed-error-channel, and hardening
disciplines that are easy to drop when working freehand.

<dogfood_feedback>
The effected plugin AND the @effected packages are actively dogfooding. Two
feedback loops, both proactive:

Plugin: if a skill, an agent, or this SessionStart hook gives wrong,
unhelpful, or confusing guidance, fires at the wrong moment, recommends a v4
API that does not match the installed `effect` beta, or shows any rough edge
worth improving, note it as you go.

Packages: if an @effected package has a gap in its services, an API that
reads awkwardly or could compose more fluently, a capability you had to
re-implement, or an idea for a new construct, service, layer, or package —
that is signal the ecosystem wants. Suggest it to the user.

When you dispatch one of the Effect agents, ask it to flag both kinds of
findings and report them back to you. At the end of the session, surface what
you noticed and ask the user — for example: "I hit X with the effected
plugin. Want me to open an issue?" Open an issue ONLY if the user explicitly
agrees (`gh issue create --repo spencerbeggs/effected --title "..." --body "..."`);
never file one on your own judgement, and never treat this reminder as
standing permission to file.
</dogfood_feedback>
</effect_plugin>
CONTEXT
)

emit_context "SessionStart" "$CONTEXT"

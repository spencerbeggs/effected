#!/usr/bin/env bash
set -euo pipefail

# SessionStart hook (no matcher — fires on all starts including resume/compact):
# brief the main agent that the "effective" plugin ships Effect v4 skills and
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
The "effective" plugin is loaded: Effect v4 development skills plus three
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
- effect-v4-module-index — the routing map: every core module (plus the
  unstable namespaces) in one what-it-is / when-to-reach-for-it table, with
  the source-path convention. Consult FIRST when deciding which module a
  task needs, and during planning's contract-inventory gate.
- effect-v4-source-lookup — the evidence ladder for confirming a v4 API before
  relying on it: migration notes settle renames, vendored source settles
  existence and signature, only a probe settles semantics.
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
- effect-v4-construct-map — the comprehensive v3→v4 migration reference.
- effect-api-extractor-bases — the @public X_base idiom for a zero-warning API.
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
- effect-migrator — PORTING a v3 *-effect package to v4 (@effected/*),
  engine-first behind a compliance gate. Delegate migration work here.
</agents>

When a task is substantially "write / review / migrate Effect code," dispatch
the matching agent rather than doing it inline with the skills — they enforce
the verify-against-installed-beta, typed-error-channel, and hardening
disciplines that are easy to drop when working freehand.

<dogfood_feedback>
The effective plugin is newly built and is being dogfooded. If a skill, an
agent, or this SessionStart hook gives wrong, unhelpful, or confusing guidance,
fires at the wrong moment, recommends a v4 API that does not match the installed
`effect` beta, or shows any rough edge worth improving, note it as you go. When
you dispatch one of the Effect agents, ask it to flag any such rough edges and
report them back to you. At the end of the session, surface what you noticed and
ask the user — for example: "I hit X with the effective plugin. Want me to open
an issue?" Open an issue ONLY if the user explicitly agrees
(`gh issue create --repo spencerbeggs/effected --title "..." --body "..."`);
never file one on your own judgement, and never treat this reminder as standing
permission to file.
</dogfood_feedback>
</effect_plugin>
CONTEXT
)

emit_context "SessionStart" "$CONTEXT"

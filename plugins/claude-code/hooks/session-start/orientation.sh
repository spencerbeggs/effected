#!/usr/bin/env bash
set -euo pipefail

# SessionStart hook (no matcher — fires on all starts including resume/compact):
# brief the main agent that the "effected" plugin ships Effect v4 skills and
# three specialist subagents, that its own Effect knowledge is stale by
# construction, and that the answers are already on disk — so it must delegate
# or load a skill rather than guess.
#
# Also reports the vendored-source posture: whether this repo vendors Effect v4
# source at .repos/effect and whether that pin matches the kit's current pin.
#
# Contract: reads the SessionStart envelope on stdin (drained, unused), writes
# an additionalContext briefing to stdout as hookSpecificOutput JSON.
#
# IMPORTANT: nothing in this script may write to stdout except the single
# emit_context call at the end. A stray echo produces two concatenated objects
# and Claude Code rejects the whole payload as invalid JSON.

# shellcheck source=../lib/hook-output.sh
. "${CLAUDE_PLUGIN_ROOT}/hooks/lib/hook-output.sh"

# Fail open without jq (emit_context builds JSON with jq).
if ! command -v jq &>/dev/null; then
	emit_noop
	exit 0
fi

# Drain the envelope on stdin; we do not need any field from it.
cat >/dev/null 2>&1 || true

# The kit's current Effect pin. ONE-LINE MAINTENANCE: bump this on every
# catalog advance, in the same commit that moves catalog:effect. It is
# deliberately a constant rather than read from the host repo's catalog — the
# point is to tell a LAGGING repo what it should move to, so comparing against
# that repo's own (possibly stale) catalog would defeat the check.
EFFECT_PIN="4.0.0-rc.112"

# --- vendored-source posture -------------------------------------------------
# Resolve the host repo root. CLAUDE_PROJECT_DIR is set by Claude Code; fall
# back to the working directory.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
VENDOR_NOTE=""

if [ ! -f "$PROJECT_DIR/.gitmodules" ]; then
	VENDOR_NOTE="This repo has NO .gitmodules, so it vendors nothing — you have no
authoritative v4 source to read and are one step from guessing. Before doing
Effect work here, vendor the Effect source at .repos/effect. Use silk's repos
skill (/silk:repos, or \`savvy repos add\`) — it owns the sparse-checkout and
read-only discipline; do not hand-roll \`git submodule add\`. Pin it to
effect@${EFFECT_PIN}. Offer this to the user before starting; it is a
one-time cost that pays for itself on the first API question."
elif ! grep -q '\.repos/effect' "$PROJECT_DIR/.gitmodules" 2>/dev/null; then
	VENDOR_NOTE="This repo has a .gitmodules but NO .repos/effect entry, so Effect v4
source is not vendored here. Add it with silk's repos skill (/silk:repos, or
\`savvy repos add\`), pinned to effect@${EFFECT_PIN}. Do not hand-roll
\`git submodule add\` — the skill owns the sparse-checkout and read-only rules."
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

CONTEXT=$(
	cat <<CONTEXT
<effect_plugin>
The "effected" plugin is loaded: Effect v4 development skills plus three
specialist subagents, distilled from the @effected packages and the official
Effect-TS v4 guides.

<do_not_guess>
READ THIS BEFORE WRITING ANY EFFECT CODE.

This project is Effect **v4 only**. Effect v4 is a ground-up redesign, not an
increment on v3, and it is still moving on the release-candidate line. Whatever
you know about Effect from training is v3-shaped and is **out of date by
construction** — not "mostly right", not "close enough to adapt". Modules moved
into core, Either is gone, @effect/cli and @effect/sql no longer exist as
packages, and signatures you are confident about have changed.

The answers are already on disk. Guessing burns time and tokens re-deriving
what this plugin already states, and produces code that type-errors in ways
that take an hour to unwind. So:

- Do NOT write Effect from memory, and do NOT reason from a v3 API you
  remember. If you are reaching for a name because it feels familiar, that is
  the signal to stop and look it up.
- DELEGATE the work: dispatch effect-developer to write it or effect-reviewer
  to review and test it. Each arrives with these skills preloaded.
- If dispatch is unavailable, LOAD THE SKILL instead — effect-v4-module-index
  to find the right module, effect-v4-idioms and effect-v4-schema for the
  constructs, effect-v4-source-lookup for the evidence ladder.
- VERIFY before relying: the vendored source settles what exists and its
  signature; only a runtime probe settles semantics. A probe beats an hour of
  type-error archaeology.

This plugin carries no migration material, by design — that era is over and
the kit is v4-native. Nothing here, and nothing you write, should carry the
older API's framing.
</do_not_guess>

<vendored_source>
${VENDOR_NOTE}
</vendored_source>

<skills>
Available via the Skill tool (several also auto-load on trigger):
- effect-v4-planning — the design-first gate: run before writing any
  implementation code. Walks four design pillars (data types, errors,
  services/layers, observability, testing) and requires a compact design
  summary before Schema.Struct/Context.Service gets touched.
- effect-v4-module-index — the routing map for Effect core: every core module
  (plus the unstable namespaces) in one what-it-is / when-to-reach-for-it
  table. Consult FIRST when deciding which module a task needs.
- effected-packages — the routing map for the @effected kit: what each package
  contains, when to reach for it, and a per-package reference (services, usage,
  testing machinery). Consult before building lockfile/config/glob/semver/XDG/
  workspace/git capability the kit already ships.
- effect-v4-source-lookup — the evidence ladder for confirming a v4 API before
  relying on it: the vendored source settles existence and signature, only a
  probe settles semantics.
- effect-v4-house-style — the cross-cutting house style: module layout and the
  cycle firewall, naming, typed-error taxonomy, TSDoc habits, layer
  conventions, test organization, observability posture.
- effect-v4-schema — the one Schema skill (the flagship): house "do this, not this"
  rules + worked patterns (Class-vs-Struct, optionality, checks/refine/makeFilter,
  codecs, the FromString static, make-vs-new, brand/Opaque, custom Equal/Hash) on
  top of Effect's canonical guide split into loadable references/.
- effect-v4-services-layers — Context.Service class form, Layer composition, and
  the memoization discipline (build-once-by-reference; the layer-function trap).
- effect-v4-idioms — core Effect: typed errors, Result, generators,
  scope/resources, forking, structural equality.
- effect-v4-cli — the CLI framework is effect/unstable/cli in core.
  Command.Environment, tier impact, exit codes.
- effect-v4-observability — spans/logging/metrics; OTel composed at the edge,
  libraries telemetry-agnostic, named spans on public fallible boundaries only.
- effect-v4-testing — @effect/vitest, it.effect, test layers, property tests,
  and the false greens (a "0 tests passed" run that exits 0, TestClock at the
  epoch, an accumulating TestConsole).
- building-a-format-package — the shared architecture of every @effected
  format package (jsonc/yaml/toml/markdown): the module-per-concept surface,
  the own-the-engine policy, the cross-package parity contract, and the
  conformance-corpus harness.
- effect-api-extractor-bases — inline class factories + the narrow _base
  suppression for a zero-warning API (no @public X_base const).
- hardening-a-parser-port — depth guards, code-point/proto/C0 checks, and the
  malformed-input-fails-as-a-typed-error-never-a-defect invariant.

The GitHub Actions / API suite — fifteen skills over @effected/github-actions,
github, commands, npm and sbom. START at the router; the rest are named by it
and load on demand:
- building-a-github-action — the ROUTER: which package owns a capability,
  which skill teaches it, what does NOT exist (no @actions/*, no ANSI API, no
  GithubMarkdown/ReportBuilder/ErrorAccumulator successor), and the fact that
  the action bundler and scaffold are downstream savvy-web tooling, not here.
- designing-an-action — the build PROCESS for a new, rebuilt or ported
  action: recon, a frozen parity contract with a known-unknowns ledger, one
  persisted API dossier, a contracts-first walking skeleton whose stubs
  succeed, then TDD fill per step. The router routes capabilities; this
  sequences the whole build.
- structuring-an-action — the canonical repo SHAPE: the annotated file tree,
  where a piece of code belongs (entry point, step, shared service, shim),
  and the structural standards and footguns that keep it that way. Designing
  owns the order you build in; this owns the shape you build into.
- bootstrapping-an-action — USER-INVOKED ONLY: the eight-question interview
  that turns a fresh copy of the action template into a plan file, then hands
  off to action-engineer running designing-an-action. Never auto-load it.
- actions-runtime — Action.run, ActionServices, ActionRuntime.layer, the extra
  layer that may require anything the runtime provides, failure rendering.
- actions-inputs-outputs — ActionInput (Config, INPUT_ mangling) and
  ActionOutputs, plus the Config.withDefault trap that silently swallows a
  malformed input behind a default.
- actions-reporting — logs, groups, buffers, annotations, job summaries, check
  runs, sticky PR comments.
- actions-state-and-secrets — ActionState, the Secret declassification seam,
  DryRun, the DetachedProcess bare-pid guard.
- actions-cache-and-artifacts — ActionCache, Artifact, BlobStore,
  ToolInstaller, CacheKey; the Azure confinement and uses:-only-step traps.
- github-api — the route IS the key (typed params and response, zero casts),
  pagination, one retry policy, one GitHubError, upsert over TOCTOU.
- github-app-tokens — GitHubApp, the client constructors, and the GitHubToken
  provision/read/dispose bridge with its one-hour contract.
- running-commands-and-tools — Run combinators, ToolDiscovery, LocalExec,
  Redaction; every subprocess concept is core's and no implementation is.
- release-and-publish — NpmRegistry, PackagePublish, NpmExecutor, release and
  tracking tags, versioning strategies, the release-age gate.
- supply-chain-attestation — SBOM, NTIA, in-toto/SLSA, OIDC, Sigstore signing,
  attestation upload.
- testing-actions — the makeTest/layerTest doubles convention, the scripted
  octokit harness, and this domain's discriminating mutants.
</skills>

<agents>
When subagent dispatch is available and permitted in this session, prefer
delegating a whole Effect task to one of these specialists via the Agent tool
over hand-rolling it inline — each arrives with the relevant skills preloaded
and carries the discipline end to end. When it is not, load the matching skills
directly and apply the same discipline inline; the skills are the substance,
the agents are the delivery mechanism. The specialists:
- effect-developer — writing NEW Effect v4 code (schemas, services, layers,
  typed errors, CLIs). Delegate feature implementation here.
- effect-reviewer — REVIEWING v4 code for idiom, error-channel, and API-surface
  correctness, and writing or strengthening @effect/vitest tests. Delegate
  review and test authoring here.
- action-engineer — building, extending or debugging a GITHUB ACTION, a
  release/publish pipeline, or any program talking to the GitHub API. Carries
  the Actions suite above. Delegate whole action- and release-engineering
  tasks here.
</agents>

When a task is substantially "write or review Effect code" or "build an action
/ call the GitHub API," dispatch the matching agent rather than doing it
inline — when dispatch is permitted; otherwise load the same skills and do it
inline. Either way what matters is the verify-against-the-installed-release,
typed-error-channel, and hardening disciplines they carry, which are easy to
drop when working freehand.

<dogfood_feedback>
The effected plugin AND the @effected packages are actively dogfooding. Two
feedback loops, both proactive:

Plugin: if a skill, an agent, or this SessionStart hook gives wrong,
unhelpful, or confusing guidance, fires at the wrong moment, recommends a v4
API that does not match the installed \`effect\` release, or shows any rough
edge worth improving, note it as you go.

Packages: if an @effected package has a gap in its services, an API that
reads awkwardly or could compose more fluently, a capability you had to
re-implement, or an idea for a new construct, service, layer, or package —
that is signal the ecosystem wants. Suggest it to the user.

When you dispatch one of the Effect agents, ask it to flag both kinds of
findings and report them back to you. At the end of the session, surface what
you noticed and ask the user — for example: "I hit X with the effected
plugin. Want me to open an issue?" Open an issue ONLY if the user explicitly
agrees (\`gh issue create --repo spencerbeggs/effected --title "..." --body "..."\`);
never file one on your own judgement, and never treat this reminder as
standing permission to file.
</dogfood_feedback>
</effect_plugin>
CONTEXT
)

emit_context "SessionStart" "$CONTEXT"

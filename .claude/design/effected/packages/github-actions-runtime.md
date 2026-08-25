---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - github-actions.md
  - github-actions-storage.md
  - github-actions-reporting.md
  - github-actions-attestation.md
  - github.md
  - commands.md
---

# @effected/github-actions — the runner runtime

## Overview

The runner runtime is the services an action uses to talk to the runner it is executing inside — environment, inputs, outputs, state across the phase boundary, the workflow-command protocol, logging, the dry-run guard, the secret declassification seam, the App-token bridge and detached-process lifecycle — together with `Action.run`, the entry point that composes them into one layer and renders the failure.

This is the half of the package a consumer always pays for, so it is the half that stays light. The Actions cache, the artifact store and the blob backends are [storage and provisioning](github-actions-storage.md), the living-document surfaces are [the reporting suite](github-actions-reporting.md), and OIDC plus the `@effected/sbom` adapters are [the attestation seam](github-actions-attestation.md) — and the composed runtime layer [deliberately excludes](github-actions.md#bundle-reachability-confining-the-heavy-edges) the Azure-touching services, so an action that merely reads an input and sets an output links none of them. Package-wide framing is in [github-actions.md](github-actions.md).

## `Action.run` and the composed runtime

`Action.run(program, options?)` is the entry point: it provides the runtime layer, renders a failure, sets the exit code and never rejects. The runtime layer provides the environment, logger (plus the workflow-command `Logger`), outputs, state, the platform services and an HTTP client — and [deliberately not](github-actions.md#bundle-reachability-confining-the-heavy-edges) the cache, artifact or blob services.

Three decisions about it are load-bearing:

- **The layer option is NOT self-contained.** It is typed so a caller's layer may require **anything the runtime provides** — the platform, the HTTP client, every runner service. A predecessor typed it as requiring nothing, and that single `never` is what produced consumer comments explaining why a requirement "could not be allowed to travel upward". It could; the type just said otherwise. A test pins this by passing a layer requiring both the filesystem and the outputs service straight through with no sub-provide and asserting the mask reaches the runner — narrowing the option back makes that test **fail to compile**, which is the mutant that proves it discriminates.
- **The wiring inside is `provideMerge`, not a flat merge.** State needs outputs (it masks before it persists) and outputs needs the environment; merged as siblings they never see each other and the layer does not build.
- **Failure rendering is decided against real call sites**, all of which call `Action.run` and none of which formats a cause themselves. Kept: one error line carrying tag and message — what a human scanning a workflow log for the first red line needs — plus the exit code, and the full pretty-printed cause behind the runner's own debug switch. Dropped: splicing a JS stack into the *visible* error (in a bundled action it points at one line of the bundle) and the nested try/catch swallow blocks, replaced by one last-resort guard at the promise boundary. `Action.run` also does **not** wrap the program in a log buffer: a predecessor did, and an unhandled defect inside the buffer swallowed the whole transcript, so the run failed and printed nothing.

## `ActionEnvironment`

Two friction fixes define its shape.

**The webhook payload loses the filesystem from its `R`.** Reading the event path made every caller carry a `FileSystem` requirement, which consumers worked around by capturing it at layer construction and re-injecting it per call. The fix is the standard one: **the layer requires it, resolves it once at construction and every member's `R` is `never`.** Not a new capability — the same capability with the requirement in the right place.

**The scoped environment override is parallel-safe, because it never touches the process environment.** Mutating a process global cannot be made parallel-safe; the answer is to stop treating it as the source of truth at read time. The layer seeds an immutable map once at construction and holds it in a `Context.Reference` (the v4 spelling of what v3 called a `FiberRef` — there is no `FiberRef` module in v4), so an override is **fiber-scoped**: two fibers overriding the same variable concurrently see their own values and neither leaks into the other or into the real environment. Nothing to restore, nothing to race.

The cost is honest and documented: a variable exported mid-run, or set by a child process, is not observed by an already-seeded reader. That is the correct trade — an action's environment is fixed at start by GitHub's own model, and exporting a variable targets *subsequent steps*, not the current one.

**The test double takes an optional payload directly**, rather than routing it through an event-path filesystem read. The double hard-provides a noop filesystem, so seeding the path through overrides sends the read nowhere and there was no route to a payload at all — a consuming action whose entire phase-detection algorithm is a pure function of the payload had to hand-compose a filesystem stub at every call site. An unarranged payload still fails typed, naming the variable: the argument is additive and preserves the die-on-unstubbed posture rather than opening a silent-default escape hatch.

## `ActionInput` — `Config`-backed, and richer than the toolkit

Inputs are read through a `ConfigProvider` that owns the `INPUT_` name mangling, **never through the process environment directly**. This closes a documented production bug: a consumer read `INPUT_SBOM_CONFIG` and silently got nothing, because the runner uppercases the name and replaces **spaces** with underscores while leaving dashes alone. A `Config`-backed accessor makes that class of bug unrepresentable, because no consumer spells the variable name.

Beyond the toolkit-faithful accessors, two shapes existed only as consumer hand-rolls and are now one implementation with one set of tests: a **list** accessor absorbing the whole union grammar consumers had reinvented (JSON arrays, bullet lists, comma-separated values) rather than shipping a variant per shape, and a **key-value pairs** accessor. A schema-decoding accessor covers everything else.

**The pairs accessor validates the key, always; the value, on request.** An **empty key** (`=value`, or a bare `=`) is rejected unconditionally: `{ "": v }` cannot be what a workflow meant, and the damage lands far from the typo — an empty key became a repository filter that matched nothing, and the run reported zero results with no indication why. An empty **value** (`key=`) is accepted by default, because setting a property to the empty string is legitimate, and `requireValue` opts into rejecting it. **Every rejection names the offending line**, which is the difference between a fixable `ConfigError` and one that says a multi-line input is bad somewhere.

**Absence is one rule across every accessor**: a missing input and an input set to empty are both *missing data*, because the runner writes an empty string for an input the workflow omitted. An optional input therefore needs a default or an option wrapper at the call site, or the read fails outright.

**An input whose contract is "empty disables it" needs the option form, not a default.** Empty is classified missing *before* a default is consulted, so the default substitutes and the disable state is unreachable; only the option form distinguishes the states. This is confirmed against the runner's own source and a live probe rather than inferred, and two consequences follow: the runner publishes a variable for **every** declared input, so "absent" is a state a runner never actually produces, and an input declaring no manifest default arrives set-and-empty when unsupplied — so deleting a manifest default does not restore a fallback, it silently flips every unsupplied run onto the disabled branch.

**Two provider traps.** Never compose a bare environment provider beneath these: it uppercases the config path, so an input-name key never matches and the read silently takes its default — which fails **green** in test code. And the single-segment retry makes the obvious mangled-key test non-discriminating, since swapping the typed accessor for a bare `Config.string` leaves the suite green; a test asserting the mangling must not rest on that substitution alone.

### The provider the runtime installs

A live action shipped a **false green**: every bare `Config.string("dry-run")` read fell back to its default, because the runner exposes inputs under mangled names and a plain-named lookup finds nothing. The ruling is that `Action.run` installs an input-aware provider by default, so a program that bypasses the typed accessors **degrades to the right answer rather than to the default**.

The installed provider's semantics are deliberately narrow, because an earlier probe found that a naive record-backed provider **uppercases every config path in the program**, silently changing the resolution of any `Config` a consumer wrote that is not an input:

- A **flat, single string-segment** path — the only shape the runner could have set — first tries the `INPUT_` derivation of the name through the same helper that owns the mangling, then the name unchanged through the ambient provider. Nested and numeric paths pass through **untouched**.
- **The shadowing trade is pinned by test**: a workflow input named like an environment variable shadows it for bare reads, in any casing, while an *unsupplied* input does not shadow, because the attempt resolves through the ambient provider whose empty-is-absent rule drops it.
- **A caller-supplied provider in the layer option wins**, by normal last-wins precedence.
- The ambient half is whatever provider is explicitly installed when the layer builds, and otherwise a **fresh** environment provider rather than the cached default: the default is cached once per process, and a snapshot taken before the runner's variables were visible would resurrect exactly the missed-input class this ruling kills.

A general lesson came out of the first probe and is worth more than the line it deleted: **a surviving mutant is a question about the code, not about the test.** The answer there was that the code was unnecessary.

**A latent defect worth not re-introducing:** an issue built with an absent actual value is classified as *missing data*, so **every validation failure was silently swallowed by any default** — `dry-run: yes` resolved to `false`, and the action would have performed every mutation the workflow author meant to rehearse. Fixed by carrying the offending value on the issue. Nothing about the default combinator's signature suggests the fallback depends on how the failure was *constructed*; this is a v4 semantics trap, not a typo.

## Logging and the workflow-command protocol

`WorkflowCommand` is **pure**: it renders the wire protocol with the required escaping and nothing else. It is the one piece of this package a non-Actions consumer might legitimately want, and keeping it pure means it is testable without a runner.

`ActionLogger` owns groups, the buffered step renderer and annotations. The important design point is the seam with the rest of the kit: **every kit package logs with `Effect.log*`, and this package ships the `Logger` that maps those logs onto workflow commands** — which is why `@effected/github` [deleted its own log-rerouting hack](github.md#actions-decoupling). The mapping belongs to one `Logger` at the edge, not to each library.

Three shapes are decisions:

- **A silent layer is a named constant.** A survey counted dozens of ad-hoc empty-logger provides across two consumer repos, purely to silence logs in tests. A no-arg layer *factory* would mint a fresh layer per call and defeat memoization for nothing.
- **Buffering is opt-in and flushes on every exit path**, including a defect. `withBuffer` takes a success disposition, so a step can be quiet when it succeeds and still spill its transcript when it does not — and only a **success** is ever discarded, because a typed failure, a defect and an interruption are all the moment the transcript was kept for. Step debugging overrides the discard, since asking for debug output means wanting to see what a green step did.
- **`withStep` is the one-line-success shape a named step actually wants**: buffer with discard-on-success, one summary line on success and a failure header ahead of the spilled transcript. The failure header goes through the console rather than the log, so it lands ahead of the flush and does not mint a second error annotation beside the one `Action.run` already renders. The success summary is emitted **outside** the buffered region — inside, it would be discarded with the transcript it replaces, leaving a green step with no line at all. Its predecessor's shape was independently derived wrong three times during one port, because grouping plus buffering looks like complete parity until you notice nothing emits the success line.

Log annotations use the **readable** property vocabulary rather than the wire names, set through a combinator, so a caller never spells an annotation key — the same reasoning that makes the input accessors safe. The debug check reads through the environment service, not the process environment.

## Outputs and state

**Reporting a failure emits the annotation but does not set the exit code.** That belongs to `Action.run`, so an action that reports a failure and then recovers is not doomed by a side effect it cannot undo.

**Runner-file delimiters are derived, not random.** GitHub's own toolkit uses a random UUID and accepts a collision chance; deriving one and extending it until it is absent from the value makes collision *impossible* rather than improbable, needs no crypto service and is deterministic under test. A value containing the delimiter would otherwise terminate its block early — a value-controlled injection into the runner's own file.

**Both error sets are now [per-reason tagged unions](github-actions.md#errors)** — `ActionOutputError` is `RunnerFileUnavailableError | RunnerFileWriteError | InvalidOutputNameError | OutputEncodeError | DetachedOutputError`, and `DetachedProcessError` likewise across its five failures. The names survive as union aliases, so nothing in the surface moved; what changed is that "the runner file is not there" and "the output name is invalid" are separately recoverable, which is the distinction a `pre`/`post` phase actually acts on.

**State round-trips through the real runner file in tests**, in a temp directory, because the phase boundary is the thing under test and an in-memory double would assert the double.

## Secrets: the declassification seam

**`Redacted` cannot survive serialization, by design.** That is not a defect to work around; it is the whole value of the type. So the design does not try to make it serializable — it makes **declassification explicit, auditable and impossible to do quietly**: one module is the only place in the package where a secret becomes a string, and it **masks through the runner's own secret command before it returns the plaintext**. Masking and declassification are the same call, which is what makes the invariant worth a module: *you cannot obtain plaintext from this package without the mask having been applied first.*

`Redacted.value` appears nowhere else in `src/`, and **a structural test asserts that**. It is not ceremony — it caught two real leaks a review would plausibly have waved through: an OIDC accessor that unwrapped its own token to decode it (restructured so a private issue path returns the raw value and the public members wrap or read it), and a request signer that genuinely needs the raw secret for its HMAC. The second was answered by *adding a member to the seam* rather than granting an exception, so the signing layer masks both credentials once at layer construction. That is worth having even though the key is never written anywhere: a signing key leaks through something nobody audited — a debug log of outgoing headers, a serialized error, a stack trace holding the closure — and the runner's filter redacts all of those.

**The test itself had a phantom-edge bug** of exactly the kind the reachability walkers hit: a raw text scan reads TSDoc as code, so a module whose comment *explains* that it does not unwrap a secret was reported as unwrapping one. It strips comments first, keeps a non-empty control and has a third test for the stripper — which is load-bearing once the scan depends on it, because a blinded scan is a silent false green.

State persistence gets the same treatment rather than a second mechanism: the save-a-secret path masks then persists, because the runner's state file is plaintext by GitHub's protocol and the mask is the only available defense. [`@effected/github` deliberately does neither](github-auth.md#the-seam-the-actions-runtime-needs) — masking is an Actions output command and persistence is an Actions file, so both are this package's job.

**The one context where a mask is inert is a detached worker**, whose stdout is a log file no runner parses — a mask emitted there does nothing except write the plaintext into the log. A detached outputs layer answers that: the worker composes it (the mask a documented no-op, the runner-file members failing typed, failure reporting a plain log line) and the **parent masks before the spawn**. The invariant is unchanged; what the layer changes is which side of the process boundary the mask lands on.

What this deliberately does **not** attempt is encrypting the handoff: the child runs on the same runner as the parent under the same user, so an encryption key would travel the same channel as the secret and buy nothing but ceremony.

## The App-token bridge

Five phase-oriented statics over [`@effected/github`](github-auth.md#the-seam-the-actions-runtime-needs)'s App service: provision a token in `pre`, build a client layer from the persisted token in `main`, read it, project a bot identity, dispose in `post`.

**The member-usage table is documented per exported member and executable.** The consumer ask it answers is explicit: under partial mocks, an opaque requirement set becomes runtime unimplemented-method roulette. So a partial mock is built from the table rather than from a stack trace, and a test supplies exactly the documented members and succeeds while one supplying fewer dies.

Three behaviours are carried deliberately, each load-bearing:

- **Failed provisioning revokes.** Provisioning is an `acquireUseRelease` whose release arm revokes on any failure — scope verification, identity, persistence — because a workflow retrying a failing `pre` would otherwise leave an hour of unreferenced write tokens behind, each a live credential nobody is tracking. The revoke is ignored on its own failure: the action is already failing for a reason the caller needs to see.
- **The token is masked before it is persisted**, through the seam, so the ordering is structural rather than remembered.
- **Identity resolution degrades.** A hiccup on the identity read logs a warning and yields a token without identity fields rather than failing the action.

**The one-hour contract is ruled in the conservative direction: document the hour, never carry the credentials forward.** A `main` phase rebuilt from a persisted token cannot re-mint one, and the credential that could is the App's private key — persisting *that* through a plaintext runner file would trade a one-hour token for a permanent one. So reading an expired token **fails typed, naming the expiry** (a predecessor never checked, so a long `main` simply started answering 401 with no explanation, which is the hardest failure in this lifecycle to diagnose from a log), the skew is adjustable because the check and the request it guards are not the same instant, a phase that can outlive the hour calls provision itself as a documented contract, and dispose **skips revoking an already-expired token**, since the request would fail and could only turn a successful run into a failed one on the way out.

## Detached processes and the bare-pid guard

An action that spawns a long-lived child in `main`, persists its pid and reaps it in `post` needs three pieces, all of which consumers hand-rolled: a detached spawn with stdio routed to a log file, a readiness poll and a reap.

**The bare-pid guard is why reaping lives here.** Killing crosses a process boundary, no handle survives the phase boundary and it needs `node:process.kill`, which a boundary package may not import. The guard is the load-bearing part: **signalling pid 0 hits the entire process group and −1 hits every process the user owns.** A pid round-tripped through the runner's plaintext state file that decodes to `0` — an absent key, a truncated file, an empty-string coercion — would, unguarded, **kill the runner**. So reaping refuses any non-positive pid as a typed failure, and the pid is validated on the way *out* of state as well as on the way in. That guard sits beside the state service that can produce the bad value, which is the whole reason it is here rather than in [`@effected/commands`](commands.md).

The pid brand is **core's**, not a local one — core already owns it, and declaring a second was the re-declaring-a-core-concept half of the commands invariant. What justifies a local export is what core does not have: a **validating** constructor. Core's is nominal and applies no runtime check, which is right for a pid the spawner just produced and wrong for one that has been through a text file.

Readiness polling is the poll-until-a-domain-predicate helper consumers hand-rolled twice, once with a suspension footgun explained in a comment.

**The fd-routing gap is real and this package is where it is answered.** Core cannot route a detached child's stdio to a **file descriptor** — its stdout option maps to an in-process pipe, which defeats detachment. So this package does the fd-level spawn itself, because it is the one package permitted to, which keeps `@effected/commands` clean of a Node-specific escape hatch. If core grows fd routing, this becomes a thin adapter and the `node:child_process` import disappears; recorded so the eventual removal is a known follow-up rather than an archaeology exercise.

**Child environments go through `ChildEnv`.** Handing a child an environment block without extending the parent's silently replaces the child's entire environment, so the path-prepending helper returns the additions **and** the extend flag together, keyed by the spelling of `PATH` the base environment already uses. The base environment is an explicit argument rather than a default read of the process environment — which is also what makes the Windows casing branch exercisable from a test on any host.

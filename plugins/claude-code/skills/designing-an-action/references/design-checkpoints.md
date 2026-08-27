# Design checkpoints

The correctness rules that make each step of the walking skeleton non-negotiable — what each one protects against, and how to enforce it rather than merely state it.

## Cross-phase state survives the JSON round trip

Every state field's encoded form must survive `JSON.stringify` → the phase-boundary file → `JSON.parse` intact. An `Option` field is `Schema.OptionFromNullOr`, never `Schema.Option` — the latter's encoded form is an `Option` *instance*, not a JSON primitive, and the schema that decodes it back correctly in one process rejects it in the next. The failure lands one phase later than the mistake: the writing phase reports success, and the reading phase can't decode the value it wrote. Apply this proactively for every optional field in a state bundle; do not wait to discover it as a test-time trap.

## Failure posture is a design-time decision, not a wiring-time discovery

Decide each step's failure posture when its contract is written, not while wiring the program's entry point. Three tiers cover the space:

- **Fail-the-job** — the tagged error propagates, and the run goes red.
- **Degrade-to-warning** — the step logs and the program continues with a documented fallback.
- **Double-netted** — wrap in both a normal catch and a defect catch, because a cleanup phase must never turn a green run red. A credential-revocation step that fails on the way out is the canonical case: the run already succeeded, and a cleanup failure should demote to a logged warning, not flip the exit code.

Record the tier per step alongside its contract. When the tier says fail-the-job, fail the effect itself — never report success through a manual "mark failed" call and then return normally, which tells the runner's exit-code channel one thing while the log says another.

## The logging contract is test-enforced, not aspirational

A run's log is a decision record, and it earns that status only if it says so consistently: a run-context opening block; every skipped step logging its own skip and the reason, never silence; warnings reserved for genuine acceptance signals rather than routine status; a closing result block. Assert on the captured log stream in a test — a skip that silently stops logging is a defect a type system cannot catch, and only an assertion on the actual transcript does.

## Layer minimalism is proven by a compile failure, not a runtime check

Add to a program's layer only what the runtime doesn't already provide. Prove there is no over-provision with a typed test double: a program typed against the runtime's own service union plus only the extra services it actually needs should fail to *compile* the moment an unused requirement is added — not merely fail a runtime assertion later. A compile-time proof can't regress silently; a runtime check can.

## Bundle truth is verified, not assumed

A unit-test runner executes source and can never see a bundler failure, so the skeleton needs its own verification that the *built* artifact works: a freshness check that rebuilds and diffs the committed bundle, and — wherever the bundle needs one — a guard proving a native dynamic import actually survives the bundler pass. Non-compilable guard scripts like this belong in a `lib/scripts/`-style location the build system treats as cache-invalidating, never alongside the compiled source, so a stale guard can never silently keep passing after the thing it guards moves. The slot for this checkpoint is required even before the action has anything to assert; an empty guard is a placeholder, not evidence.

Pair this with a load-bearing rule for any data an action bakes in at build time: a decode failure at that stage is a defect, never degraded to an empty result. Silently swallowing a build-time decode failure into an empty success turns a broken bundle into a truthful-sounding "nothing here" — worse than a loud failure, because it reports as correct.

## Dependency honesty resolves the peer closure before flagging anything

Every declared package dependency must be imported by the action's own source, or be a required peer dependency of another declared dependency. A structural check that flags an "unused" dependency must resolve the peer closure first — a required peer is a legitimate un-imported dependency, not a stale one to delete on sight. Deleting a peer that a declared dependency actually requires produces a runtime failure a type checker cannot catch.

## Every error class has a test that constructs it

Audit every error channel in a step's contract for whether it can actually fire. A channel that exists only to satisfy a type signature — never reachable because the code path it guards can't produce it — is worse than no channel: it forces every caller to handle a case that doesn't exist, and it makes the type a documented lie. The mirror form is just as real: a step failure reported through a bare, untagged error where a typed error belongs is the same defect approached from the other side. When you port a member from a reference implementation, either demonstrate the failure path with a test or delete the reason from the signature.

## Doc-refresh is part of the definition of done

A package's own context documentation, and any register of temporary workarounds, stay current as part of the same milestone gate that runs tests and typecheck — not a follow-up task. A stale doc teaches whoever reads it next an API that no longer exists.

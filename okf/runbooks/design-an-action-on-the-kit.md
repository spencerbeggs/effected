---
type: Runbook
title: Design a GitHub Action repository on the kit
description: The ordered sequence in which a new action's design decisions are actually forced, from kit-capability recon through documentation refresh.
status: stable
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-17T04:41:11Z
integrity:
  generated:
    body: 9820e305410881b5
---

# Design a GitHub Action repository on the kit

## Trigger

Starting a new GitHub Action repository on `@effected/github-actions`, or
redesigning an existing one to bring it into conformance with
[the canonical shape](../conventions/github-action-canon.md).

## The design sequence

Follow the steps in this order — it is the order in which the three
migrated actions (silk-release-action, silk-runtime-action,
silk-update-action) proved the decisions are actually forced, not an
arbitrary checklist.

1. **Recon against the installed kit.** Inventory the needed capabilities
   at construct level, not package level — verify against installed
   versions, not memory. Record what genuinely is absent; those become
   shims (see [the canon's §B8](../conventions/github-action-canon.md#b8-blessed-shims-live-in-srcshims)).
   Re-run this step on every kit bump.
2. **Freeze the I/O contract.** Inputs and outputs as data: `NAMES` const
   tuples, with defaults written once in `action.yml` and mirrored — never
   duplicated — in code. Line-list inputs first; reserve a JSON input for
   genuinely nested structure, which then triggers schema-publication
   machinery. Design the cross-field interaction validation now, and plan
   the three-way sync test between `action.yml`, `INPUT_NAMES` and the
   decoded shape.
3. **Choose phases deliberately.** `pre`/`main`/`post` is not a default:
   `pre` exists to fail fast on credentials, `post` exists for cleanup
   that must never fail the workflow. A layer-less entry is legitimate
   when `pre` provisions everything `main` reads back.
4. **Design cross-phase state as schemas.** `Schema.Class` bundles under
   `STATE_KEYS`; every field's encoded form must survive
   `JSON.stringify` → `GITHUB_STATE` → `JSON.parse`. Brand ids whose zero
   value is invalid.
5. **Place the token lifecycle, if the action uses App auth.** Provision
   in `pre` with required-scope verification, persist the envelope to
   `ActionState`, build the client layer in `main`, and revoke
   unconditionally in `post` under `catchDefect`.
6. **Set the secret-masking policy.** Mask everything supplied before any
   decision about whether it will be used. A plaintext appears only
   through a named `Secret.*` member; a new declassification need is a new
   member, never an inline unwrap.
7. **Decide failure posture per step.** Three tiers: fail the job;
   degrade to a warning; or double-net with `catch` plus `catchDefect`
   (post, summary writes). Fail the effect — never call the low-level
   failure setter and return normally — and emit outputs on every abort
   path.
8. **Audit the error taxonomy.** No error class without a constructor
   site, and no untyped error where a step failure needs a tag. Pick the
   class shape by whether every failure reason carries the same fields.
9. **Compose layers minimally.** Start layer-less — provide
   configuration-derived services inside `program` from the decoded
   inputs — and grow a per-entry layer only when a service must be
   provided outside `program`. Add only what the kit's runtime layer
   omits. Prove there is no over-provision with a typed services test
   double that must fail to compile if a requirement is missing.
10. **Design reporting on one stack.** Use the kit's reporting suite,
    conditioned on what the installed kit actually covers; a genuine gap
    goes through a shim, never a hand-rolled namespace object. Decide
    whether the action can have two runs in flight against one reporting
    document, and mint a stamp once at startup if it can.
11. **Write the logging contract.** A run-context opening block; the
    detect-headline pattern (what was detected first, evidence at debug);
    every skipped step logging its own skip reason; warnings reserved for
    acceptance signals; a closing result block. Enforce it with a test
    that asserts on the captured log stream.
12. **Compose steps into a pipeline.** One module per step;
    `program.ts` stays pure composition holding only cross-step joins; the
    output fold starts from all-disabled defaults so a feature that never
    ran still reports its default.
13. **Plan the tests with the structure.** The doubles convention
    (unstubbed members die loudly); the realism gradient (real detectors
    over temp fixtures, kit in-memory layers, faked domain services with
    spies); the filesystem double is always
    [`@effected/memfs`](../modules/memfs.md), never a hand-rolled
    `FileSystem.layerNoop` over a `Map`; the three-way input sync test;
    log-stream assertions; mutate the edges before declaring green. On a
    migration, convert doubles first and the runner separately.
14. **Verify bundle truth.** `dist` is the artifact and the test suite
    runs source, so the suite alone can never see a bundle failure. Guard
    native dynamic imports explicitly. Treat a build-time data decode
    failure as a defect, never a degraded empty value. Prefer bundle-safe
    standalone functions to class-static aliases for tree-shaking. CI does
    a rebuild-and-diff dist-freshness check.
15. **Refresh the docs.** All three tiers of `CLAUDE.md` (root, `src/`,
    `__test__/`) current; kit-surface claims re-verified against the
    installed version; the shim register re-audited. Context files are
    post-mortem-shaped: each non-obvious rule names the incident, the
    wrong explanation believed first, and the guard.

## End state

The repository conforms to
[the canonical shape](../conventions/github-action-canon.md): every design
decision in the sequence above has been made deliberately and is
documented at the point it was decided, rather than discovered as a gap
after the repository already has consumers.

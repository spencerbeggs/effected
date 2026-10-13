---
type: Convention
title: A package that commits fixtures commits a provenance README beside them
description: Every committed fixture directory carries a README stating the producing tool and version, the exact generating command, whether the fixture is hand-authored and why, and the property it exists to pin.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - testing
sources:
  - id: package-json-fixtures-readme
    resource: ../../packages/package-json/__test__/fixtures/README.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: a0461b517a65951e
---

# A package that commits fixtures commits a provenance README beside them

When a package commits fixtures, it commits a `README.md` beside them.
Per fixture, that file states:

- The **producing tool and its version** — `sort-package-json@4.0.0`, not
  "sort-package-json".[^package-json-fixtures-readme]
- The **exact command and the settings that shaped the output** — for
  example running `sortPackageJson(inputText)` with the process cwd
  inside a pnpm workspace so its package-manager detection resolves to
  non-npm.
- Whether the fixture is **hand-authored, and why** — the shape a real
  tool declines to emit, the negative case no installer produces.
- **What property the fixture exists to pin**, and where a format has no
  oracle at all, that fact and its reason.

The load-bearing one is the third. A hand-authored fixture is
indistinguishable from real tool output to the next reader, who will
either trust a synthetic file as ground truth or regenerate it and
silently lose the property it encoded. The first two are what make a
fixture *refreshable* rather than guessable, and a committed oracle needs
its tool version recorded or a later disagreement cannot be attributed —
whether the computation under test moved, or the oracle's semantics did.

`packages/package-json/__test__/fixtures/README.md` is a working
example: it names the exact `sort-package-json` version, the exact call
and cwd condition that produced the expected output, and the
regeneration procedure to use only when intentionally re-baselining
against a new oracle version.[^package-json-fixtures-readme]

Writing this file is cheap while generating the fixture and
near-impossible to reconstruct afterwards — write it in the same commit
as the fixture, never as a follow-up.

[^package-json-fixtures-readme]: `packages/package-json/__test__/fixtures/README.md` —
    names `sort-package-json@4.0.0`, the exact `sortPackageJson(inputText)`
    call and cwd condition, and the regeneration procedure.

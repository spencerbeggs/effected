# Drift and versioning

The library classifies every target's change against the file on disk as
`none`, `created`, `annotations` (documentation-only keywords) or `contract`
(anything a validator asserts or a generic tool writes into an instance).
The CLI adds the dimension the library lacks: whether anyone depends on the
label yet. Together they decide what a build writes.

## The drift table

| `published` | `policy` | `none` / `created` | `annotations` | `contract` |
| --- | --- | --- | --- | --- |
| `false` | any | write | write | write |
| `true` | `allow` | write | write | write, loud warning |
| `true` | `semantic` | write | write | **drift** |
| `true` | `strict` | write | **drift** | **drift** |

Two rules are fixed and never relitigated per call site:

1. **An unpublished schema is never drift.** A `contract` change at a pinned
   but unpublished version rewrites the file in place — the iterate-until-you-
   submit case. `published` defaults to `false`; flip it the day the catalog
   entry is accepted upstream.
2. **Gate failures are not drift.** A lint warning or an ajv strict-mode
   finding fails both commands regardless of `onDrift` and regardless of
   `--force`. A document the editors cannot load has no warn-and-write mode.

`DriftPolicy.classify({ published, change }, policy)` is the pure classifier
behind the table, answering `"write"` or `"drift"`, if a test wants the same
verdict the CLI reaches.

## What drift does — `onDrift`

- `error` (default) — **nothing is written for any schema**, catalog entries
  included; exit `1`. A partial write would leave a repository half-bumped.
  The message names each drifting schema, its change class, the
  `nextVersion` the library computed, and the two ways out: bump the version
  in the config, or `--force`.
- `warn` — write anyway, exit `0`, one warning per drifting schema on
  stderr. This is the posture for an automated dependency-bump workflow,
  where the bump should land and the summary should shout.

## Reading the report

One line per schema:

- `written (contract) <path>` / `unchanged <path>` — a build that wrote.
- `would write (annotations) <path>` — `check`: a build would touch the file.
- `DRIFT contract at published 1.2 → suggest 1.3 — <path>` — the policy
  refused it. A prerelease label prints no suggestion: it already declares
  its own instability and is rewritten in place.
- `held (drift elsewhere) <path>` / `held (gate failed elsewhere) <path>` —
  this schema was clean, but a sibling refused the run, so nothing was (or,
  under `check`, would be) written. Fix the sibling.

`check` reports exactly what `build` would do under the same flags and exits
under the same conditions — including `held`. It is one predicate over one
walk, not a second code path, which is why it can stand in for a drift test.

## `--force`

`--force` is sugar for `--drift=allow` for one run: the policy classifies and
reports, then writes. The CLI logs a warning that a published document may be
rewritten in place, which breaks every consumer pinned to its URL. Its
legitimate uses are seeing what a dependency bump did to a document before
deciding whether it warrants a bump, and repairing a published file whose
on-disk text no longer parses (the library classifies unparseable text as a
contract change so it stays regenerable). Bumping the version is the answer
to a contract change; forcing is not.

## The version grammar

A label is one to three dot-separated numeric components — `major`,
`major.minor` or `major.minor.patch` — with an optional SemVer prerelease
(`1.3.0-beta.1`). Build metadata (`+build`) is rejected: it is hostile in a
URL and SemVer precedence ignores it, so two labels differing only in build
would both claim to be latest. Surrounding whitespace and a leading `v` are
rejected too.

The label is preserved **verbatim** — it is the file name
(`<name>-<version>.json`) and the URL — and missing components read as `0`
only for ordering, so `1`, `1.0` and `1.0.0` are one version. SchemaStore's
own corpus is mostly two-part, and all three spellings are available.

Bare-major labels carry one cosmetic cost: an integer-like object key
enumerates ahead of every dotted key in JavaScript regardless of insertion
order, so a catalog entry's `versions` map serializes `"2"` before `"1.5"`.
SchemaStore reads that map by key, not by position; nothing is broken.

## What `next` suggests

`SchemaVersioning.next(version, change)` is pure and total with three arms:

- a non-`contract` change → the same label (nothing to break);
- a prerelease label → the same label (it already declares instability);
- otherwise → a **minor** bump that preserves the component count
  (`1` → `1.1`, `1.2` → `1.3`, `1.2.3` → `1.3.0`).

It suggests minor because the differ cannot tell an added optional property
from a removed required one — every contract change reads as a change, not
as breaking or additive. The suggestion's job is to be strictly greater and
conspicuous. **Bump major by hand when you know the change is breaking.** It
never mints a prerelease from a stable label.

`isPinned` — a label with no prerelease — is the one predicate both the
library's contract guard and `next` read, so a caller can never be refused a
write and told to keep the same label.

## Bumping

To cut a new version of a published document: change `version`, `$id` and
`path` together in the config (the three spell the same label), leave the
old target in place if its file should keep existing, and run `schema:build`.
The catalog entry's `versions` map picks up the new label on the same run
because it is derived from every versioned schema of the name. Two targets
with the same name and the same version under different spellings are
rejected by `defineConfig`.

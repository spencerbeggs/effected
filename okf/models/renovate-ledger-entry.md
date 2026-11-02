---
type: DataModel
title: An upgrade-ledger entry is one change, selected by the versions a consumer's upgrade crosses
description: "The effected-renovate ledger's file format: a BASELINE.md naming the round's previous tag and floor, plus one NNNN-slug.md per change with a kind, a shows, an applies map of >=X.Y.Z thresholds and the detect patterns applicable.mjs runs through git grep; the restricted YAML subset it is written in; how entries are selected, ordered and chained across rounds."
status: draft
resource: ../../plugin/skills/effected-renovate/references/ledger
tags:
  - release
  - dx
  - docs
sources:
  - id: applicable-mjs
    resource: ../../plugin/skills/effected-renovate/scripts/applicable.mjs
  - id: bump-config-deps-mjs
    resource: ../../plugin/skills/effected-renovate/scripts/bump-config-deps.mjs
  - id: renovate-bats
    resource: ../../plugin/__test__/effected-renovate.bats
  - id: effect-upgrade-skill
    resource: ../../.claude/skills/effect-upgrade/SKILL.md
  - id: ere-probe
    resource: git grep -IE probe over okf/ on 2026-11-01
generated:
  by: "okfit/claude-code"
  at: 2026-11-02T17:54:48Z
integrity:
  generated:
    body: 317623abd67b3623
---

# An upgrade-ledger entry is one change, selected by the versions a consumer's upgrade crosses

## Overview

The upgrade ledger lives at
`plugin/skills/effected-renovate/references/ledger/` and ships inside the
plugin. It is how this repository tells a consumer what a kit release
changed. Each change a consumer must find or act on is one file. The
consumer's `/effected-renovate` run hands the ledger to
`scripts/applicable.mjs`. The script keeps only the entries the
consumer's own upgrade crossed, and it lists the consumer files where
each entry's search matched.[^applicable-mjs] The project skill
`/effect-upgrade` writes the entries: in its version mode, and in
`--record` at the end of a branch. Its `--reset` mode closes a
round.[^effect-upgrade-skill] For why the ledger exists in this shape, see
[the upgrade-ledger decision](../decisions/upgrade-ledger-in-the-plugin.md).

The directory holds exactly two kinds of file. Any other file is ignored,
and so is any name that does not end in `.md`.

- `BASELINE.md` is required. It records the release this round counts
  from.
- `NNNN-slug.md` files are the entries. `NNNN` is four digits and `slug`
  is `[a-z0-9-]+`.

## BASELINE.md

| Field | Rule |
| --- | --- |
| `repo` | `owner/name` of the repository whose tags carry earlier rounds (`spencerbeggs/effected`). |
| `path` | The ledger's repo-relative directory. It is used at the `previous` tag, so it must be the path the directory had *at that tag*. |
| `previous` | The `@effected/ai-plugins@<version>` tag that carries the round before this one, or the literal `none` for the first round. |
| `floor` | A map of package name to a plain version (`X.Y.Z` or `X.Y.Z-pre`, no operator): the versions this round's consumers start from. May be empty. |

The body is free prose. A reset rewrites `previous` and `floor`, and
nothing else edits them.

## An entry

| Field | Required | Rule |
| --- | --- | --- |
| `id` | yes | Equals the file's four-digit prefix as a string. Ids are unique within a round and restart at `0001` after a reset. |
| `title` | yes | A non-empty string. It is the line `applicable.mjs` prints. |
| `kind` | yes | One of `security`, `breaking`, `behaviour`, `tooling` or `adopt`. |
| `shows` | yes | One of `typed` (the compiler finds it), `behavioural` (only a test or a run finds it) or `none`. |
| `applies` | yes | A non-empty map of package name to `>=X.Y.Z`: the first published version that carries the change, for each package that carries it. An Effect-side change is keyed on `effect`. |
| `detect` | for `security`, `breaking`, `behaviour` | A list of patterns that find the old shape in a consumer's code. |
| `closes` | no | A list of the tracking issues the change closed. |
| `changesets` | no | A list of `.changeset/` file names, without `.md`, that the entry records. |
| `renames` | no | A map of old package name to new, for a config dependency that was republished under a new name. |

The body must be non-empty. It speaks to the downstream agent in the
imperative and names shapes rather than signatures, and it tells the
reader to check the installed `.d.ts`. Entries are exempt from the
plugin's no-versions rule; see
[consumer-text-states-current-effect-behaviour](../conventions/consumer-text-states-current-effect-behaviour.md).

`detect` patterns run through `git grep -nIE`, which is POSIX extended
regex. `--check`, however, only proves that each pattern compiles as a
JavaScript `RegExp`. A JavaScript-only escape therefore passes the check
and silently matches nothing. `\d` is the common case: `4\.0\.[0-9]`
matched 77 lines of `okf/` while `4\.0\.\d` matched none.[^ere-probe]
Write `[0-9]`, `[[:space:]]` and plain alternation, and use no
lookaround. Prove each pattern against a real call site before you
commit it.

## The frontmatter subset

`applicable.mjs` has no dependencies, because an installed plugin has no
`node_modules`. It parses a restricted YAML subset itself, and anything
outside that subset fails `--check` with `unreadable line`:

- **Top-level keys** match `[A-Za-z][\w-]*`. A line is `key: value`, or a
  bare `key:` that opens a block. Blank lines and lines that start with
  `#` are skipped.
- **Scalars** may be bare, `"double"`-quoted or `'single'`-quoted. Nothing
  is typed, so `id: 0001` and `id: "0001"` both read as the string `0001`.
- **A double-quoted value is decoded as a JSON string wherever it
  appears**: a scalar, a flow-list item, a block-list item or a block-map
  value. So the regex `Crypto\.` is written `"Crypto\\."` in every
  position. A single-quoted or bare value is literal.
- **Flow lists** are `key: ["a", 'b', c]`. A bare item ends at the next
  comma.
- **A block under a bare key** is either a list (indented `- item` lines) or a map
  (indented `name: value` lines, where the name is quoted or contains no colon). It is
  never both. One level deep is the limit.
- **Comments.** Whitespace followed by `#` outside quotes ends the value.
  A `#` inside quotes is kept, so `"a #b"` reads as `a #b`.

Hence the house shape: `applies` and `renames` are block maps with quoted
keys, and `detect`, `closes` and `changesets` are one-line flow lists of
double-quoted strings.

## Selection

The before versions come from the pre-upgrade lockfile:
`git show <base>:pnpm-lock.yaml`, where `<base>` defaults to the merge-base
of `HEAD` with `origin/HEAD` (or `main`, or `master`). `--base` or
`--before` overrides it. The after versions come from the working tree's
`pnpm-lock.yaml`, or from `--after`.[^applicable-mjs]

- **What counts.** The script reads every importer's direct dependencies,
  across every YAML document in the lockfile. pnpm writes config
  dependencies in a document of their own, so a config dependency such as
  the catalog plugin counts. A peer suffix (`0.4.0(effect@4.1.1)`) is
  stripped. A `link:`, `file:` or `workspace:` resolution is not a
  version and is skipped.
- **Across importers.** The before version is the *lowest* the package
  resolved to in any importer, and the after version is the *highest*.
  One lagging workspace package is therefore enough to cross a
  threshold.
- **Crossing.** An entry applies when at least one package in `applies`
  sat below its threshold before and at or above it after. Versions
  compare by semver precedence, so a prerelease sorts below its release.
- **Absent before.** A package the repository did not resolve before has
  no crossing. A newly adopted package triggers none of its own entries.
  An entry that only a new dependent would need is therefore not worth
  writing.
- **Renamed before.** The one exception is a rename. Every `renames` map in
  the selected rounds, in their baselines and their entries, is folded into
  the before versions: a new name the repository did not resolve takes the
  old name's version, because a republished package continues its old
  version line. A repository still on `@effected/pnpm-plugin-effect` 0.19.x
  therefore crosses a `@effected/pnpm-plugin-effected` `>=0.21.0` threshold.
  A new name the repository already resolved keeps its own version.
- **Hits.** For each selected entry, `detect` runs as one
  `git grep -nIE -e … -e …` over tracked files. It excludes
  `pnpm-lock.yaml`, every `CHANGELOG.md` and `.changeset/`. Text output
  shows the first 20 hits and a count of the rest, while `--json` carries
  all of them. `hits: none` on an entry with `detect` is a real result:
  the old shape does not occur.

## Ordering

The selected entries sort by `kind` in the order security, breaking,
behaviour, tooling, adopt. Within a kind, `typed` sorts before
`behavioural`, which sorts before `none`, and file path breaks a tie. The
compiler-confirmed work therefore comes first, and the adoptions, which
are offered and never applied unasked, come last.

## The chain across rounds

A reset empties the ledger, so a consumer several releases behind needs
the earlier rounds. Before selection, the script checks the current
round's `floor`. If any floor package resolved below its floor before the
upgrade, the repository predates the round, and the script reads the
round at `previous`:

- **`previous: none`.** The chain ends with the notice
  `this repository predates the earliest ledger round (<floor>)`.
- **`--offline`.** It prints the tag to fetch and stops.
- **Otherwise** it fetches the directory listing and each `.md` file at
  that tag with `gh api repos/<repo>/contents/<path>?ref=<tag>`, and then
  repeats the check against the fetched round's own baseline. The chain
  is capped at 10 rounds, the current one included.

Each `gh` call runs with `GH_HOST` and `GH_REPO` removed from its
environment, an empty `GH_TOKEN` removed and `GH_PAGER=cat`. A consumer
shell pointed at another host or repository therefore cannot redirect the
fetch, and the bats suite pins this.[^renovate-bats] A fetched round is
cached under
`${XDG_STATE_HOME:-~/.local/state}/effected/renovate/<tag>/`, where every
character outside `[\w.@-]` in the tag becomes `_`. The cache is never
refreshed once its `BASELINE.md` exists, because a release tag does not
move. Every crossed entry from every round in the chain is selected
together and sorted as one list.

## Renames

Selection reads `renames` too; see "Renamed before" above. `bump-config-deps.mjs` reads `renames` from every entry in the shipped
round, whether or not that entry applies, and it never reads fetched
rounds. A `configDependencies` key that matches an old name is rewritten
to the new name at the new name's latest version.[^bump-config-deps-mjs]
Keep a rename entry in place until the old name can no longer appear in a
consumer, and consider folding it on reset rather than dropping it.

## Validation and gates

`node plugin/skills/effected-renovate/scripts/applicable.mjs --check
[--ledger <dir>]` validates the baseline and every entry against the
rules above. It also checks for duplicate ids. It prints every problem
and exits 1, or prints `N entries valid` and exits 0. A run that is not
`--check` refuses to select from an invalid ledger.

`plugin/__test__/effected-renovate.bats` pins two repository-wide
gates.[^renovate-bats] The first is that the shipped ledger passes
`--check`. The second is that every pending `.changeset/*.md` with a
`## Breaking Changes` section has its name in some entry's `changesets`.
The grep accepts a one-line flow list or an indented `- name` block-list line.
The suite also runs the built `applicable.mjs --check` from both plugin
builds through pluginfinity's `run_script`, which proves the script ships
and runs with no plugin variables.

## What breaks if an entry is wrong

- **A threshold that is too high or too low** hides the entry from every
  consumer who crosses the real version. Take each threshold from the
  release plan (`pnpm changeset status --verbose`), never from a guess.
- **A `detect` pattern that matches nothing** reads to the consumer as
  "not affected". A pattern that matches everything buries the real hits.
- **A wrong `shows`** sends the consumer to the wrong gate. A `typed`
  entry the compiler never flags is taken as handled.

[^applicable-mjs]: `plugin/skills/effected-renovate/scripts/applicable.mjs`
    — `lockfileVersions`, `parseFrontmatter`, `entryProblems`,
    `baselineProblems`, `crossings`, `foldRenames`, `roundRenames`, `olderThanBaseline`, `fetchRound`,
    `detectHits` and `main`.
[^bump-config-deps-mjs]: `plugin/skills/effected-renovate/scripts/bump-config-deps.mjs`
    — `ledgerRenames`.
[^renovate-bats]: `plugin/__test__/effected-renovate.bats` — the chain
    test with a stub `gh` and `GH_HOST=evil.example`, the two `repo:`
    cases, and the `built:` case.
[^effect-upgrade-skill]: `.claude/skills/effect-upgrade/SKILL.md` — "The
    upgrade ledger", "Record mode" and "Reset mode".
[^ere-probe]: git grep -IE against okf/ on 2026-11-01: `4\.0\.[0-9]`
    matched 77 lines, `4\.0\.\d` matched 0.

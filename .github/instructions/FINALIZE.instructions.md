---
applyTo: "**"
---

# Finalizing a branch

This is the complete flow for taking finished work on a branch and landing it as a
reviewable pull request in this repository: verify, write changesets, commit, push, open
the PR. Follow it in order. Every rule below is enforced by tooling — a git hook, the
`savvy` CLI, or CI — so skipping a step does not save time, it just moves the failure
later.

Do not use `--no-verify`, `--no-gpg-sign`, or any other hook bypass at any point. If a
hook rejects your work, the work is wrong, not the hook.

## Step 0 — Verify before you finalize

Run these from the repo root and read the output. Do not claim a gate passed without
having seen it pass.

```bash
pnpm lint          # Biome. Use pnpm lint:fix to auto-correct.
pnpm lint:md       # markdownlint
pnpm typecheck     # tsc --noEmit across the workspace
pnpm test          # vitest
```

Never invoke Biome directly (`biome check`, `npx biome`, `pnpm exec biome`). Only the
root `pnpm lint` / `pnpm lint:fix` / `pnpm lint:fix:unsafe` scripts resolve this repo's
configuration; any other route reads the wrong config and can damage the read-only
vendored checkouts under `.repos/`. `npx biome` in particular resolves to an unrelated
package that exits 0 without checking anything — a false green.

If `pnpm lint` fails with `Failed to resolve the configuration from @savvy-web/silk/biome`,
that is a transient rebuild race, not a config error. Re-run it.

## Step 1 — Write the changesets

A changeset is a file in `.changeset/` that declares which packages this branch releases
and what their release notes say. It is **release documentation for someone upgrading the
package**, not a summary of your diff.

### 1a. Decide whether a changeset is needed

Work out which workspace packages your branch touched. A "release surface" is either a
directory listed in `pnpm-workspace.yaml` (the package whose `package.json#name` lives
there), or a path linked to a package by `.changeset/config.json` — today that is
`plugins/silk/**` and `.github/workflows/hook-tests.yml`, both of which belong to
`@savvy-web/silk`.

**Six categories of change — and only these six — produce no changeset content.** Do not
invent additional exclusions:

1. **AI context documents** — `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.cursorrules`,
   or any file whose purpose is coaching an AI tool.
2. **Internal design docs and specs** — markdown under `.claude/design/`, `.claude/plans/`,
   `docs/internal/`.
3. **Trivial user-doc updates riding along with code** — when a code change also touches a
   related README snippet, the changeset describes the code change, not the README edit.
   A substantial user-facing doc rewrite is not trivial and belongs under `## Documentation`.
4. **Cross-package documentation drift** — a doc edited only because *another* package's
   behavior changed. The changeset belongs to the package whose behavior changed. If the
   doc edit stands alone, with no accompanying behavior change on the branch, this does
   not apply and it must be classified normally.
5. **Behavior-neutral settings and config** — `.editorconfig`, IDE settings, lint/format
   toggles, Renovate/Dependabot config, CI matrix tweaks that change neither what is built
   nor what is tested.
6. **Routine churn** — dependency pins within an existing range, lockfile updates from a
   plain `pnpm install`, upstream type-definition updates.

If the branch contains *only* changes in these categories, no changeset is needed. Say so
explicitly in your PR summary rather than staying silent about it.

If a changed path fits none of these and you cannot confidently attribute it to a package,
**do not silently drop it**. Note it in the PR summary as an open question for the
reviewer.

### 1b. One package per changeset file

Always write single-package frontmatter. `@changesets/cli` accepts several packages in one
file; this project's convention does not. A branch affecting three packages gets three
files, each with its own frontmatter and its own body. Multiple files for the *same*
package are fine.

### 1c. Choose the bump

| Bump | Use for |
| :--- | :--- |
| `patch` | Bug fixes, docs, internal refactoring, tests, CI/build changes |
| `minor` | New features, new exports, non-breaking additions |
| `major` | Removed exports, changed signatures, breaking behavior changes |

When torn between `patch` and `minor`, choose `minor`. When torn between `minor` and
`major`, choose `major`. A brand-new workspace package gets its own `minor` changeset
announcing what it is and what it does.

### 1d. Write the file

Name it `.changeset/<adjective>-<noun>-<verb>.md` — the `@changesets/cli` filename style,
e.g. `.changeset/brave-pandas-shout.md`.

```markdown
---
"@savvy-web/package-name": minor
---

## Features

* Short, user-facing statement of what the consumer gets
```

The frontmatter is `"package-name": bump` — quoted key, one line per package (but see 1b:
one package per file here).

### 1e. Section headings — exact and exhaustive

Every `##` heading must match one of these thirteen strings exactly, case-sensitively.
They render in this order:

| Heading | For |
| :--- | :--- |
| `## Breaking Changes` | Backward-incompatible changes |
| `## Features` | New functionality |
| `## Bug Fixes` | Bug corrections |
| `## Performance` | Performance improvements |
| `## Documentation` | Documentation changes |
| `## Refactoring` | Code restructuring |
| `## Tests` | Test additions or modifications |
| `## Build System` | Build configuration changes |
| `## CI` | Continuous integration changes |
| `## Dependencies` | Dependency updates |
| `## Maintenance` | General maintenance, style |
| `## Reverts` | Reverted changes |
| `## Other` | Uncategorized |

Use `### Sub-heading` under a `##` category to give a distinct named feature its own
heading.

### 1f. Structural rules CSH001–CSH005

These are lint-enforced. A violation fails the pre-commit hook and CI.

* **CSH001** — no `#` (h1) headings anywhere in the body, and no heading depth skips
  (never jump `##` → `####`).
* **CSH002** — every `##` heading matches one of the thirteen categories exactly.
* **CSH003** — no empty sections, no empty list items, and every code fence carries a
  language identifier.
* **CSH004** — no content before the first `##` heading. The YAML frontmatter does not
  count as content, but a stray sentence between the frontmatter and the first heading
  does.
* **CSH005** — a `## Dependencies` section **must** contain a Markdown table in the
  five-column schema below. Prose may accompany the table, before or after it, but a
  section containing only prose or only bullets is invalid.

```markdown
| Dependency | Type           | Action  | From   | To     |
| :--------- | :------------- | :------ | :----- | :----- |
| effect     | dependency     | updated | 3.18.0 | 3.19.1 |
```

* **Dependency** — the package name, non-empty.
* **Type** — one of `dependency`, `devDependency`, `peerDependency`, `optionalDependency`,
  `workspace`, `config`, `runtime`, `packageManager`. (`runtime` is a language-runtime
  upgrade such as Node; `packageManager` is the package manager's own upgrade such as
  pnpm. Both are release-neutral, like `devDependency`.)
* **Action** — one of `added`, `updated`, `removed`.
* **From** — the previous version, or `—` (em dash) for an addition.
* **To** — the new version, or `—` (em dash) for a removal.

At most **one** changeset file per package may carry a `## Dependencies` table. Prefer
generating dependency changesets rather than hand-writing them:

```bash
pnpm exec savvy changeset deps regen
```

That deletes every pure-dependency changeset and regenerates one fresh single-package
`patch` changeset per affected package, with a correctly formatted table. Run it only
after you have written the content changesets for the branch — a dependency edge into a
package is meaningless if that package's own release note is missing.

### 1g. Depth: match the tier to the change

| Tier | When | Shape |
| :--- | :--- | :--- |
| Simple | Small fixes, internal tweaks | `## Category` plus bullets. No prose. |
| Structured | Multi-faceted changes | Several `## Category` sections; `###` per distinct sub-feature. |
| Rich | Significant features, breaking changes | Narrative paragraphs, `### Named Feature` headings, code examples, migration guidance. |

`patch` bumps stay Simple. Breaking changes are always Rich and **must** include migration
guidance.

### 1h. Write for the upgrader, not the reviewer

Lead with what the user gets, not how the code got there. One bullet per distinct
user-visible change; no exhaustive enumeration; no file-by-file walkthrough.

Good — user-facing and actionable:

> Added `suppressWarnings` option to `ApiModelOptions` for granular API Extractor warning
> suppression. Rules match by `messageId`, text `pattern`, or both.

Bad — implementation detail nobody upgrading cares about:

> Refactored the warning system to use a new options pattern with a factory class and
> builder interface.

**Never invent an API-shaped code example from memory.** Before writing any code block
that calls the package's API, verify every identifier, field name, and nesting level
against the real surface: read the exported types or the source the diff touches, or copy
from an existing test or example in the repo. Changeset validation checks structure, not
example correctness — a wrong field name ships silently into the release notes. If you
cannot verify a shape, describe the change in prose instead.

### 1i. Validate

```bash
pnpm exec savvy changeset check
```

This returns the CSH001–CSH005 diagnostics. Fix everything it reports before committing.

## Step 2 — Commit

Commit messages are validated by the `commit-msg` git hook against the
`@savvy-web/commitlint` Silk preset. Compose the message in a file and validate it
*before* committing — the hook fires after `lint-staged`, so a bad guess costs a full
lint cycle before you learn about it.

```bash
pnpm exec savvy commit lint /tmp/commit-msg.txt   # non-zero exit is an absolute stop
git commit -F /tmp/commit-msg.txt
```

Do not try to eyeball line lengths. Run the validator.

### Format

```text
type(scope): subject

body (optional — a few bullets, or one to two short paragraphs)

Closes #1, #2, #3 (optional, all issues on ONE comma-separated line)

Signed-off-by: Full Name <email@example.com>
```

Blank lines separate the subject, body, closing trailer, and signoff. This spacing is the
house style.

### Allowed types

Exactly one of: `ai`, `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`,
`release`, `revert`, `style`, `tdd`, `test`. Do not invent types.

* `ai` — AI/LLM context document updates (CLAUDE.md, design docs).
* `release` — version bumps and changelog commits.
* `tdd` — requires a mandatory structured scope matching `^\d+:(spike|red|green|refactor)$`,
  e.g. `tdd(42:red)`. Unlikely to apply to your work; use `test` for ordinary test changes.

Scope is optional for every other type. When present it names the component or concern:
`(deps)`, `(cli)`, `(config)`.

### Subject rules

* Imperative mood: "add", "fix", "remove" — never "added", "adding", "fixes".
* Lowercase first letter after the colon (house convention; not mechanically enforced, but
  match it).
* Maximum **100 characters** for the whole `type(scope): subject` header.
* No trailing period, no punctuation at the end.
* No markdown — no backticks, bold, italics, or links.
* Be specific about what changed.

Bad: `feat: Updated the user authentication flow`
Good: `feat: add JWT refresh token rotation to auth flow`

### Body rules — brevity is the doctrine

This repo squash-merges. A long commit body is **discarded at merge**. Explanation that
deserves to survive goes in the PR description, the changeset, or a design doc.

The body is optional, and an absent body is a correct body. Omit it whenever the subject
says the whole thing.

When you do write one: **three to five bullets, or one to two short paragraphs — not both,
and never more than about eight body lines.** Bullets are the default shape; use `-`
dashes, one line each, imperative, roughly 10–20 words. Reach for prose only when the
point is a single trap or constraint the diff does not reveal on its own.

Each bullet or paragraph is **one continuous line**. Do not soft-wrap at 72 columns — a
wrapped continuation line reads as stray output. The hard cap is 300 characters per line,
but anything past roughly 200 means the *content* is wrong, not the formatting: cut it.

A line earns its place only if a reader scanning `git log` next quarter needs it: the
user-visible or API-visible change, a behavior change a consumer could trip over, or a
non-obvious constraint the diff hides. Cut everything else — restatements of the subject,
test counts and coverage deltas, investigation notes and evidence, file-by-file
walkthroughs, mechanical renames carried along by the real change, routine CLAUDE.md or
config tweaks, vague qualifiers like "for clarity", and transitive lockfile entries.

The test: **would you lose something if this line were deleted?** If not, delete it. Most
first drafts lose half their lines to that question and improve.

A large commit does **not** earn a large message.

### Formatting the preset rejects in a commit body

Markdown headers (`##`), numbered lists (`1.`), code fences, links, bold, horizontal
rules, more than two inline-code spans, and references to plan files or design docs ("as
decided in the plan", "see .claude/plans/…").

Dash bullets (`- item`) are allowed and preferred. Numbered lists are not — use dashes.

### Trailers

`Closes`, `Fixes`, or `Resolves` followed by `#N` closes a tracked issue. **All issues go
on one comma-separated line**, never one trailer per line:

```text
Closes #247, #248, #251, #252

Signed-off-by: Spencer Beggs <spencer@savvyweb.systems>
```

If the branch name encodes a ticket number and the work closes it, always include it. If
the list would exceed 100 characters (roughly a dozen issues), start a second `Closes`
line rather than wrapping the first.

Every commit requires a **DCO signoff as the last line**, separated from any `Closes`
trailer by a blank line, in the exact form `Signed-off-by: Full Name <email>`. Use the
committer's real name and git-config email (`git config user.name`, `git config user.email`).
Every trailer line, signoff included, is capped at **100 characters**.

### Worked examples

Bullets, several separable things:

```text
feat(actions): canonicalize GitHub Actions skills

- Consolidate Actions skills into indexed guidance with focused references
- Add action design and repository structure skills
- Validate construct coverage across exported package APIs

Signed-off-by: Spencer Beggs <spencer@savvyweb.systems>
```

No body at all:

```text
chore(deps): bump node to 26.8.1

Signed-off-by: Spencer Beggs <spencer@savvyweb.systems>
```

## Step 3 — Open the pull request

The PR **title** is a conventional-commit subject and follows every subject rule in Step 2
— type, imperative mood, 100-character cap, no trailing period, no markdown.

The PR **description** is a different document. It is markdown and is *not* held to the
commit-message rules: headings, code fences, tables, links, and a long summary are all
correct here.

### Read before you write

A PR description in this repo can have more than one writer — a human, a release
automation, and an agent. Always read the current body before editing it:

```bash
gh pr view <number> --json body --jq .body
```

If the body contains no `<!-- silk-release:… -->` markers, it is an ordinary PR. Write a
normal description. **Do not synthesize a managed region to make it look managed.**

### If the body has silk-release markers

The `@savvy-web/silk-release-action` regenerates part of the body on every push. The
failure mode is silent: text in the wrong region looks correct in the browser and
disappears on the next push, with no error anywhere.

````markdown
<!-- silk-release:start -->
<!-- silk-release:summary:start -->
<!-- silk-release:summary:end -->

```proposed-squash-commit
feat: add the thing

- item

Closes #123, #456

Signed-off-by: Name <email>
```

<!-- silk-release:references:start owned="123,456" -->
Closes #123
Closes #456
<!-- silk-release:references:end -->
<!-- silk-release:end -->
````

Ownership:

| Region | Owner | Survives regeneration |
| :--- | :--- | :--- |
| Anything outside `silk-release:start`/`end` | Humans | Yes — never regenerated |
| `silk-release:summary` | **You** | Yes — carried through explicitly |
| `proposed-squash-commit` fence | **You** on an ordinary PR | **No** on a release PR |
| `silk-release:references` | Shared — you may add | Your additions, via `owned` |
| Everything else inside the managed region | The action | Rebuilt every push |

Rules that follow from this:

* Write **only** between markers you own. Replace the text between them and leave every
  other byte of the body exactly as `gh pr view` returned it.
* **Never hand-edit the `owned="…"` attribute.** It is how the action distinguishes its
  references from yours; a wrong value makes it delete a real link or resurrect a dropped
  one.
* On a **release PR**, the action rebuilds the `proposed-squash-commit` fence on every
  push. Treat it as read-only there and put anything that must survive into the summary
  region.
* If the body has markers but your region is missing one of its pair, **stop and report
  it** rather than guessing where the region goes. A misplaced marker pair is worse than
  none.

### The proposed-squash-commit fence

`proposed-squash-commit` is not a standard GFM language, but GitHub renders it and
integrations read it. **Do not "correct" it to `text`.**

Its contents become the squash-commit message, so they must satisfy every rule in Step 2.
Validate them the same way — extract the fence to a file and run
`pnpm exec savvy commit lint <file>`.

### Linking issues

These rules are empirical, and the duplication between the two spellings is load-bearing:

| Location | Spelling | Read by |
| :--- | :--- | :--- |
| Inside the `proposed-squash-commit` fence | `Closes #123, #456` — one comma-separated line | commitlint |
| Inside the references region (or plain body) | `Closes #123` — one bare line each | GitHub's linker |

**Only a bare `Closes #N` line, on its own line, outside every fence, actually links an
issue.** A reference inside a fenced block is inert — GitHub does not see it. Neither
consumer accepts the other's spelling, so do not make the two forms match, and do not move
the bare lines inside the fence to tidy the body.

To link an issue the release action does not know about, add a bare `Closes #N` line
inside the references region; the action subtracts the ids in `owned="…"` from what it
finds and preserves the rest as yours. You cannot force-link an issue the action has
deliberately dropped.

### Writing the summary

The audience is a reviewer deciding whether to approve, and a maintainer six months later
asking why this shipped.

* Open with the outcome in two or three sentences. What behavior is different now? A
  reviewer should be able to stop after this paragraph and know whether they care.
* Then the reasoning the commit message cannot carry: what you ruled out, what surprised
  you, what you verified and how.
* Call out anything a reviewer must check by hand — a migration, a behavior change a
  consumer could trip over, a deliberate scope exclusion.
* State what you did **not** do, if the diff would otherwise imply you did.
* Put verification here concretely: the command you ran and its result, not "all tests
  pass".
* Note any changed path you could not confidently attribute to a package (Step 1a), and
  say explicitly if the branch needed no changeset and why.

Do not recap the diff file by file — GitHub already renders it, and the listing crowds out
the reasoning only you have. Length is not the enemy here; irrelevance is.

### Two checks that apply to a PR body

* **plan-leakage** — do not cite `.claude/plans/`, `.claude/design/`, or write "as decided
  in the plan". This repository is public and those documents are not something a reader
  can open. Restate the reasoning in the summary instead of pointing at a path.
* **closes-trailer** — if the branch name encodes a ticket, the body should close it. Add
  the bare `Closes #N` line.

## Final checklist

1. `pnpm lint`, `pnpm lint:md`, `pnpm typecheck`, and `pnpm test` all ran and passed.
2. Every affected package has a changeset, or its absence is explained in the PR summary.
3. Each changeset file names exactly one package, uses only the thirteen valid headings,
   and passes `pnpm exec savvy changeset check`.
4. Any `## Dependencies` section carries the five-column table, and only one file per
   package has one.
5. Every code example in a changeset was verified against the real API surface.
6. The commit message passed `pnpm exec savvy commit lint` — header under 100 characters,
   imperative subject, body under about eight lines, no markdown, `Closes` on one line,
   DCO signoff last.
7. No hook was bypassed: no `--no-verify`, no direct Biome invocation.
8. The PR title is a valid conventional-commit subject.
9. The PR body was read before it was written, only regions you own were modified, and any
   `owned="…"` attribute is byte-identical to what you found.
10. Bare `Closes #N` lines sit outside every fence; the fence uses the comma-separated
    form.

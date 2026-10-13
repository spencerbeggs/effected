---
type: Consumer
title: spencerbeggs/reposets
description: A declarative GitHub repository management CLI — a committable TOML config names settings, secrets, variables, rulesets, deployment environments and CodeQL setup across groups of repositories, applied by one `sync` command.
repository: spencerbeggs/reposets
status: stable
tags: [bundle, dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: fd2f89b8740220fe
---

# spencerbeggs/reposets

`spencerbeggs/reposets` publishes `reposets`, a declarative GitHub
repository management CLI. Its published package is `package/`, not the
repository root. It is unlike every other consumer in this register, and
each difference is why its dogfood loop found what it found:

- It is a CLI, not a GitHub Action. Every other consumer runs on a
  GitHub-provided runner with one platform and one log sink; this one runs
  on a person's terminal, which is what surfaced
  [`@effected/cli`](../modules/cli.md).
- It is the first consumer of the application control plane —
  [`@effected/app`](../modules/app.md) and
  [`@effected/store`](../modules/store.md) had shipped and had never been
  driven from outside their own test suites before this loop.
- It is the first loop that upstreamed code rather than only findings.
  Two ports were written downstream against a design doc and landed in
  the kit: the repository resource services plus sealed-box crypto into
  [`@effected/github`](../modules/github.md), and the whole of
  [`@effected/cli`](../modules/cli.md). Both were folded, corrected and
  gated on the kit side; neither arrived as a merge of consumer source.

The loop that produced these findings is closed: its findings landed, the
wave it drove released, and the consumer resolves through published
`catalog:effect` pins. Verified against a survey of the checkout dated
2026-08-25; there is no local checkout at present, so everything here is
as of that survey.

## What it exercises

The whole application control plane, wired together rather than sampled:
`App.layer` gives it XDG-namespaced directories, a migrated SQLite store
and a TTL cache; `AppConfig` loads its TOML config over the same
namespace. Using all four capabilities together is what made gaps in
their *seams* visible — the resolver chain, read-through caching, the
UTF-8 codec and decode options were all seam findings, not feature
requests.

It exercises the GitHub resource surface in a direction no GitHub Action
consumer needs: the actions in this register read and report, while this
CLI *writes* configuration repeatedly across a fleet and needs to know
exactly what it sent. That produced `AppliedSettings`, a pagination sweep,
and a ruleset `source_type` fix, all landed in
[`@effected/github`](../modules/github.md)'s resource surface.

It is the first exercise of durable local state as a product feature
rather than an implementation detail: a sync journal, last-applied
fingerprints for drift detection, and a TTL cache over three GitHub
lookups — the first exercise of `@effected/store`'s rollback path against
a real database rather than an in-memory test suite.

It is also `@effected/schemastore`'s first consumer outside the repository
that scoped that package, using it as a devDependency to generate the
config's JSON Schema at build time.

## What this loop proves that the earlier ones did not

A consumer can report a genuinely missing capability, not merely a
misprojected one. Earlier consumers in this register mostly found
projections — surfaces the kit already had the pieces for, differently
shaped. This loop found absences: the resolver chain on `AppConfig.layer`,
a `Cache.through` combinator, a UTF-8 byte-array decode helper, decode
`parseOptions`, several unrepresented GitHub route families, and a
workflow-listing endpoint were all genuinely missing rather than
mis-projected. The difference is not consumer quality — it is that
earlier consumers exercised surfaces the kit had already been shaped
against, and this one arrived first at the application and store layers
and at the terminal. The first consumer of any surface should be expected
to find absence; later ones should be expected to find projections.

Absence and projection call for different responses: a projection gets
absorbed, while an absence gets designed — and this loop's two largest
absences were designed before being built. The `cli` package was written
up and reviewed by the consumer as a boundary decision before the port
began, which is what kept a considered `Stdio` dead end to a paragraph
rather than a rewrite.

A shared symptom across two call sites is as often a shared author habit
as a shared dependency defect. The consumer filed a blocking finding after
both a `doctor` command and a `sync` command reported "no config found"
for a present-but-invalid file, reasoning that two independent sites
producing identical bad output implicated the loader. The premise was
challenged rather than the fix accepted, and the actual cause was the
consumer's own `orElseSucceed(() => [])` written independently in both
places. A finding whose evidence is "it happens in two places" deserves
its premise challenged before its fix is implemented — same author, same
habit, twice, is a plausible alternative to a shared kit defect.

Withdrawal is a normal move and cheap when the reasoning is public.
Several findings — a discovery defect, core-API claims, a named-export
condition on a CommonJS dependency, and an `ownerType` scope exception —
were retracted by one side or the other after being tested against a
stated rule. Each retraction left a rule behind, stronger for having
survived a challenge than it would have been unopposed.

## Where the kit's edge sits

- Credential resolution, including the 1Password SDK. Secret *values*
  arrive by a mechanism the consumer chooses; the kit owns encrypting and
  sending them once resolved.
- The config dialect — group targeting, ruleset shorthand, cleanup
  policies with preserve lists, resolvable value labels. This is the
  product, and none of it is GitHub's vocabulary or the kit's.
- The sync engine — phase ordering, the decision table, dry-run
  reporting, GHAS-license and personal-account awareness. The kit answers
  what a repository *is* and what a write *sent*; which writes to make is
  the application's decision.
- Drift fingerprints. The consumer keeps its own content-hashing library
  for its own drift model after the sealed-box crypto moved upstream —
  the crypto that belonged to GitHub's API left the consumer, and the
  hashing that belongs to its own drift model stayed.

## Open questions

- It still has not adopted `@effected/cli`, the package its own design
  doc drove into existence. The port landed in the kit and has released,
  but as of the last survey the consumer had advanced its other pins past
  it without taking `cli` up — so the one piece of adoption evidence that
  package most needs is the one this loop did not produce. Whether the
  consumer's own CLI boundary collapses onto it cleanly is still
  unanswered.

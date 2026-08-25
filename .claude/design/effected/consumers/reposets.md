---
status: current
module: effected
category: feedback
created: 2026-08-14
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 90
related:
  - README.md
  - ../packages/app.md
  - ../packages/store.md
  - ../packages/cli.md
  - ../packages/config-file.md
  - ../packages/github.md
  - ../packages/github-resources.md
  - ../packages/xdg.md
---

# spencerbeggs/reposets

## Overview

`/Users/spencer/workspaces/spencerbeggs/reposets` publishes `reposets`, a declarative GitHub repository management CLI: a committable TOML config names repository settings, secrets, variables, rulesets, deployment environments, advanced-security toggles and CodeQL default setup, and one `sync` applies them across groups of repositories. The published package is `package/`, not the repo root.

It is unlike every other entry in this register, and each difference is why its loop found what it found.

- **It is a CLI, not a GitHub Action.** Every other consumer runs on a GitHub-provided runner with one platform, one log sink and a workflow to report into. This one runs on a person's terminal, which is what surfaced [`@effected/cli`](../packages/cli.md).
- **It is the first consumer of the application control plane** — [`app`](../packages/app.md) and [`store`](../packages/store.md) had shipped and had never been driven from outside their own suites.
- **It is the first loop that upstreamed code rather than only findings.** Two ports were written downstream against a design doc and landed here: the six repository resource services plus the sealed-box crypto into [`github`](../packages/github.md), and the whole of `@effected/cli`. Both were folded, corrected and gated on this side; neither arrived as a merge of consumer source.

**The loop is closed.** Its findings landed, the wave it drove released, and the consumer now resolves through published `catalog:effected` pins rather than the local overrides it ran the loop on. Verified against the checkout on 2026-08-25. The loop's own mail was transitory and gitignored; what is durable is here and in the packages' own docs.

## What it exercises

**The whole application control plane, as one wiring.** `App.layer` gives it XDG-namespaced directories, a migrated SQLite store and a TTL cache; `AppConfig` loads the TOML config over the same namespace. The four capabilities are used together rather than sampled, which is what made the gaps in their *seams* visible — the resolver chain, read-through caching, the UTF-8 codec and the decode options are all seam findings, not feature requests.

**The GitHub resource surface, in a direction no action needed.** The actions in this register read and report; this one *writes configuration*, repeatedly, across a fleet, and needs to know exactly what it sent. That is what produced `AppliedSettings`, the pagination sweep and the ruleset `source_type` fix — [github-resources.md](../packages/github-resources.md) carries all three in their own terms.

**Durable local state as the product feature.** A sync journal, last-applied fingerprints for drift detection and a TTL cache over three GitHub lookups. This is the first exercise of `store`'s rollback path against a real database rather than an in-memory suite.

**`schemastore` as a devDependency**, generating the config's JSON Schema at build time — the intended shape for that package, and its first consumer outside the repo that scoped it.

## What this loop proves that the earlier ones did not

**A consumer can report a genuinely missing capability.** The register's standing observation — every finding was a projection the kit already owned the pieces for — held across seven consumers and does not hold here. The resolver chain on `AppConfig.layer`, `Cache.through`, `Uint8ArrayFromUtf8`, `parseOptions`, six unrepresented route families and a workflow listing were all absent rather than mis-projected. The difference is not consumer quality; it is that the earlier consumers exercised surfaces the kit had already been shaped against, and this one arrived first at `app`, `store` and the terminal. **Expect the first consumer of any surface to find absence, and later ones to find projections.**

**Absence and projection call for different responses.** A projection gets absorbed. An absence gets designed, and this loop's two largest ones were designed *before* being built — `cli.md` was written and reviewed by the consumer as a boundary decision, and the port followed it. That ordering is what kept the `Stdio` dead end to a paragraph.

**A shared symptom across two call sites is as often a shared author habit as a shared dependency defect.** The consumer filed a blocking finding after `doctor` and `sync` both reported "no config found" for a present-but-invalid file, reasoning that two independent sites producing identical bad output implicated the loader. The premise was challenged rather than the fix accepted, and it was their own `orElseSucceed(() => [])` in both places. **Challenge the premise of a finding before implementing it**, particularly a finding whose evidence is "it happens in two places" — same author, same habit, twice.

**Withdrawal is a normal move, and cheap when the reasoning is public.** Five items were retracted by one side or the other after being tested against a stated rule: a discovery defect, two core-API claims, a named-export condition on a CommonJS dependency and an `ownerType` scope exception. Each retraction left a rule behind — the `Repo`-scoped rule in [github.md](../packages/github.md#the-repo-coordinate) is one of them, stronger for having survived a challenge than it would have been unopposed.

## Where the kit's edge sits

The kit stops at the typed API and the control plane. What stays in the consumer, deliberately:

- **Credential resolution**, including the 1Password SDK. Secret *values* arrive by a mechanism the consumer chooses; the kit owns encrypting and sending them.
- **The config dialect** — group targeting, ruleset shorthand, cleanup policies with preserve lists, resolvable value labels. This is the product, and none of it is GitHub's vocabulary or the kit's.
- **The sync engine** — phase ordering, the decision table, dry-run reporting, GHAS-license and personal-account awareness. The kit answers what a repository *is* and what a write *sent*; which writes to make is the application's.
- **Drift fingerprints.** It keeps `blakejs` for its own content hashing after the sealed box moved upstream, which is the correct residue: the crypto that belonged to GitHub's API left, and the hashing that belongs to its own drift model stayed.

## Open questions

- **It still has not adopted `@effected/cli`**, the package it drove. The port landed here, has released, and the consumer advanced its pins past it without taking it up — so the one piece of adoption evidence `cli` most needs is the one this loop did not produce. Whether the consumer's own boundary collapses onto it cleanly is still unanswered.

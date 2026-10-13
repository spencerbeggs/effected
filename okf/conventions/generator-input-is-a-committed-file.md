---
type: Convention
title: A generator's data input is a committed file, not a submodule
description: Vendor a source repository as a git submodule only when a package needs to read the repository; commit the one document a generator actually reads.
status: stable
stale_after: 2027-03-13T00:00:00Z
tags: [architecture, ci]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 4e7a43bd298bbf4e
---

# A generator's data input is a committed file, not a submodule

**Commit the one file a generator reads. Reach for a git submodule only
when a package needs to read the repository itself** — its history, its
build tooling, more than one file it needs to stay in sync as a set —
never as the default way to pin an external data source.

`@effected/spdx` and `@effected/schema-org` each generate a vendored
TypeScript table from one published upstream document, committed into the
package's own `lib/data/`:

- `@effected/spdx`'s `lib/data/spdx-licenses.json` is the SPDX workgroup's
  published license catalog: 300,646 bytes (roughly 332 KB), read from an
  upstream `spdx/license-list-data` repository that is itself roughly
  1.86 GB.
- `@effected/schema-org`'s `lib/data/schemaorg-current-https.jsonld` is
  schema.org's published `-current` release document: 1,550,917 bytes
  (roughly 1.5 MB), read from a schema.org release repository that is
  itself roughly 254 MB.

Both packages vendored the source repository as a git submodule first, and
both moves cost a CI outage to learn from. A git submodule's sparse
checkout configuration lives in that submodule's own `.git/config` and
does not travel with the outer repository's clone — so a collaborator's
fresh clone, and every CI checkout, paid the full upstream history to reach
what amounted to a rounding error's worth of JSON, and validation time
roughly tripled as a result.

**The rule that generalizes: submodule a repository when a package needs
to read the repository; commit the file when it needs one file.** A
generator that reads exactly one published document, on a hand-run,
manually-triggered cadence, is exactly the case a committed file serves
better than a submodule — the file is reproducible offline on any machine
at any time, the diff on a bump is readable in the same commit as the
regenerated output, and no clone anywhere pays for history it will never
read.

A future package facing the same choice should measure which side of the
line it is on before choosing: if the generator (or anything else in the
package) needs more than one file from the upstream project, needs its
history, or needs to track the upstream project's own build tooling, a
submodule is the right tool and this convention does not apply. If it
reads exactly one document to produce exactly one generated table, commit
the document.

Revisit this convention if either vendored document ever needs to become
a live fetch (which would also mean re-tiering the owning package, since
neither `@effected/spdx` nor `@effected/schema-org` does IO today) or if a
future package's upstream source turns out to require more than the single
file this convention assumes.

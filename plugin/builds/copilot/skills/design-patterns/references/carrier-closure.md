# Carrier closure

A tool built on the kit — anything that runs as a program, a carrier and
its front ends above all — owns the versions it was tested with. It shares
no `Context.Service` tag, Schema class or brand with the repository that
installs it, so nothing forces the two onto one copy of `effect` or of a
kit package. Treat the tool's whole dependency closure as **sealed**: one
copy of each package per closure, not one per tree.

That is the opposite of a library, and the difference is the point:

| | Library (imported) | Tool (run) |
| --- | --- | --- |
| Shares values with its host | yes: services, schemas, errors | no |
| `effect` and kit packages | `peerDependencies`, the host's copy runs | regular `dependencies`, its own copy runs |
| Kit ranges | caret, so a host's packages dedupe onto one copy | **exact**, so a kit patch never arrives without a release of the tool |
| Duplicates in a host's tree | a defect: two tags, two schemas | expected and harmless while the host is on a different kit release |

A tool released on an older kit release keeps working beside a repository
that has moved to a newer one, until the tool next releases. Nothing has to
wait for every tool in the ecosystem to move at once.

## Why the ranges must be exact

On `0.x`, a caret holds the minor and floats the patch. A floating patch
inside a tool's closure breaks in two ways:

- **The tool changes with no release.** A fresh install picks up a kit patch
  published after the tool shipped. What the tool writes, reports or exits
  with can move under the same tool version.
- **A peer binds across the closure.** A kit library resolved inside the tool
  satisfies its kit peers from whatever copy is in scope. With carets, a
  library's newer patch can land beside a peer on the older line it no
  longer supports, and the tool dies at import with
  `does not provide an export named …`.

Exact pins on the tool's packages close both. Pinning also seals the peers
below: a peer resolves from the package that installs it, and the tool
declares its full peer closure (see
[carrier-package.md](./carrier-package.md#the-dependencies-vs-peerdependencies-rule)),
so every kit peer under the tool resolves to the version the tool pinned.

## Applying it

- **Every package that runs is a tool package**: the carrier, every front
  end, the engine, and any build-time package the tool loads (a bundler, a
  config loader). Libraries in the same repository keep carets and peers.
- **Inside the monorepo that builds the kit packages**, write `workspace:*`
  on every `@effected/*` edge of a tool package. It publishes as the exact
  version.
- **In a repository that installs the kit from npm**, write
  `catalog:effected:exact` on every `@effected/*` (and `effect`) dependency
  of a tool package. The catalog plugin serves `effected:exact` beside
  `effected`: the same entries with the operator stripped, so it publishes
  exact versions and still moves with every plugin bump. Plain
  `catalog:effected` publishes the catalog's caret, so it does not pin.
- **Declare the full peer closure as regular dependencies**, exact like the
  rest. An entry no file imports may be load-bearing: it satisfies a peer
  of something the tool does import.
- **Hold it with a test.** Read each tool package's source manifest and
  fail on any `@effected/*` dependency not written `workspace:*` (in the
  kit's monorepo) or `catalog:effected:exact` (elsewhere). Assert the list
  is non-empty, so the test cannot pass by checking nothing.
- **Expect more releases.** Every kit release the tool's closure includes
  ripples a patch down to the carrier. That is the release model working:
  the carrier version names exactly what runs.

## What pinning does not seal

- **A library's own regular kit dependencies.** A library under the tool
  resolves its regular `dependencies` by their own carets, whatever the tool
  pins. Only its peers come from the tool.
- **`effect` itself, when the host pins it graph-wide.** The kit's catalog
  plugin derives overrides that hold every `effect` in a repository to one
  version, a tool's included.

The full seal is bundling the closure into the tool's published `dist`, so
nothing resolves at install time. Until a tool bundles, these two gaps are
why a tool on a much older kit release can still need a bridge in a
consuming repository; the `effected-renovate` skill's step 3 has the
parent-scoped override recipe.

## The library side: breaking floors

A library's peer floor moves when the library releases: under
`workspace:^` it publishes a caret on the peer's new version. If the peer
released a breaking `0.x` minor and the library releases only a patch, a
host on the old line of both resolves the patch and gets a peer range its
peer copy does not satisfy. changesets bumps every dependent `patch`
whatever the dependency did, so this happens by default.

The rule: **a release whose published peer range stops admitting a peer's
old line must leave its own line too** (a minor on `0.x`, a major from
`1.0`). `@effected/changesets`'s `ReleasePlan.breakingFloors` reports each
release that breaks it; raise each one, plan again, and repeat until none
is left, because a raised library can cross its own dependents' floors.
Regular dependencies are not gated: they install privately for the
dependent and strand no consumer.

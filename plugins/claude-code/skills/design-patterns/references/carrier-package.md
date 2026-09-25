# Carrier package

## The problem it solves

npm, pnpm, yarn and bun all create `node_modules/.bin/*` entries only for a
package's **direct** dependencies. A transitive dependency, or a peer an
installer auto-resolves, is *reachable* by `require`/`import` but never
*runnable* — its bin never lands in `.bin`. Hoisting settings
(`publicHoistPattern` and friends) fix module **resolution**; none of them
fix bin-**linking**, because bin-linking was never resolution-shaped to
begin with.

That makes "install one package, get several tools" fail silently for any
toolchain whose bins live in sub-packages: a consumer installs the
meta-package, `node_modules/.bin/the-cli` and `node_modules/.bin/the-cli-mcp`
never appear, and nothing in the install log says why.

Reaching for `peerDependencies` on the front ends, or `autoInstallPeers`,
does not fix it either — a peer still only bin-links when it is also a
*direct* dependency of the importer, and auto-installing peers can pull in
version ranges the meta-package never asked for.

## Roles

Roles, not necessarily separate packages — a small tool may fold several of
these into one package as long as the edges below still hold:

```text
carrier -> {cli, mcp, lsp, ...front ends} -> engine -> [profiles] -> core
```

Every edge points **down**. A higher role may depend on a lower one; a
lower role never depends on a higher one, and two roles at the same tier
never depend on each other.

- **core** — the domain model. Zero opinions, no `node:*` imports, no
  platform-node dependency, no `process` reads anywhere. As a library it
  declares its runtime companions (`effect`, `@effected/*`) as
  `peerDependencies` **and** the same names in `devDependencies` — the
  standard pure-library split, so a consumer's own resolved copy is the one
  that runs. When the tool has a user config file, core is also where its
  Schema shape, version and published JSON Schema identity live — see
  [carrier-app-and-schemas.md](./carrier-app-and-schemas.md) (optional).
- **profiles** (optional) — policy choices core deliberately refuses to
  make because more than one answer is legitimate. Fold this into the
  engine when there is no real policy axis; don't invent a layer for a
  single fixed choice.
- **engine** — everything a CLI command handler and an MCP tool handler
  would otherwise both have to implement: the platform/runtime layer,
  config discovery, one program per operation that returns a typed result
  plus its machine-readable envelope, the renderers of those envelopes, and
  the package's `ENGINE_VERSION`. Front ends **render**; the engine
  **computes**. Two invariants worth testing directly:
  1. No file under the engine's `src/` reads `process` — **no allowlist**,
     stricter than a front end gets, because the engine is shared by two or
     more front ends and an environment read baked in by whichever one
     imports first is a bug that only shows up in the other.
  2. Every ambient name — an XDG application namespace literal, a
     well-known directory name — exists exactly once, in the engine. Both
     front ends provide the *same* platform layer wholesale so they resolve
     the same config-directory structure by construction, not by convention
     repeated twice.

  The payoff: installing the MCP server alone never resolves the CLI's
  command-framework dependency tree, because the engine, not the CLI
  package, owns everything both front ends need. When the tool has a user
  config file, the engine is also where the platform layer and config
  discovery live — see
  [carrier-app-and-schemas.md](./carrier-app-and-schemas.md) (optional).
- **front ends** (cli / mcp / lsp / …) — peers of each other. They **never**
  import each other. If two front ends need the same thing, that thing
  moves *down* into the engine — never sideways. Treating one front end's
  barrel export as the copy contract the other imports from is the
  documented anti-pattern to avoid: it reintroduces a same-layer edge under
  a different name.
- **carrier** — ships almost no behavior of its own. It takes a regular
  `dependencies` edge on every front end (see below — this is the one rule
  that is easy to get backwards) plus one bin shim per front end. By
  recommendation those are the only bins in the tool and front ends declare
  none; a tool whose front ends also stand alone may share the names
  instead, at the cost of provenance under flat installs (see
  [carrier-entry-contract.md](./carrier-entry-contract.md#who-declares-a-bin)).
  It **may also be a library** — a build-tool plugin that happens to also be
  the meta-package, or a package that carries config shims alongside the
  bin shims — as long as it only ever imports a front end from inside a bin
  shim, never from its own library surface. That confines the same coupling
  the pattern exists to avoid to one file per front end.

## The `dependencies` vs `peerDependencies` rule

This is the rule the whole pattern turns on, and it inverts the usual
library instinct:

- **A library** (a package other packages *import*) declares its runtime
  companions as `peerDependencies` (plus the same names in
  `devDependencies` for its own tests) — that is what keeps one resolved
  copy of `effect` in a consumer's tree.
- **An installed package** — anything that runs as a program: the carrier
  above all, and every front end whose `main` a carrier shim runs (a front
  end declares no `bin` of its own, but it is still what runs) — declares
  its **full runtime closure** as regular
  `dependencies`: its own imports, plus **every peer of every library it
  depends on**. The peer chain has to terminate somewhere, and an installed
  package is where it terminates.

One consequence worth documenting explicitly wherever it shows up: a front
end's `dependencies` will list packages that **no file under its `src/`
imports**. That is not dead weight to prune — it is **load-bearing**: those
entries satisfy a peer that some other declared dependency needs. Removing
one breaks installs at install time, for a consumer who has never even
heard of the removed package, and nothing in a lint pass catches it because
nothing in the source references the name. Say so, in the package, wherever
this shape appears — a reviewer who only greps `src/` for an import will
otherwise "clean up" a real dependency.

## The carrier-as-library deviation

The carrier is allowed to be more than a shim collection. A build-tool
plugin package can *be* the carrier — it is what a consumer's build
configuration imports, and it can also carry the bin shims for the CLI and
MCP server the same ecosystem ships. A carrier can also bundle small config
shims alongside its bin shims. Both are acceptable deviations from "the
carrier ships no behavior" as long as the one invariant holds: the
carrier's own library surface never imports a front end directly — only a
bin shim does, and a bin shim is not library surface a consumer's bundler
ever reaches through normal imports.

## Release model

The carrier's `workspace:*` reference to each front end becomes an
**exact pin** at publish time, not a caret range. There is no fixed or
linked changeset group tying the carrier's version to its front ends'
versions — instead, a changeset config option that bumps internal
dependency ranges by `patch` on every internal release means **any**
front-end release automatically patch-bumps the carrier and re-pins its
dependency on that front end. A consumer upgrading the carrier is the whole
story for staying in sync with every front end at once; there is no
separate "also bump the CLI" step because the carrier's own release already
did it.

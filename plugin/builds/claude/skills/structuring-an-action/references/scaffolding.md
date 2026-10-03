# Scaffolding a new action

## The manifest is the single source

The manifest's inputs, outputs, and their defaults are the one place those names and values are decided. Everything else — the names-as-data tuples in `schema/`, any documentation of an input's behavior — mirrors the manifest; none of it re-declares a default independently. Annotate an input in the manifest itself when a setting is load-bearing enough that a workflow author could misconfigure it silently — the manifest is read by the humans this action serves, and a comment buried in source code never reaches them.

## The build config

The builder configuration declares which source files are entries, whether to minify, and whether to produce a local, committed build target for smoke-testing. Its escape hatches — anything that tells the bundler to treat a particular import specially — are added **per need**, each with a comment explaining what breaks without it and how that was confirmed, never copied forward from another action's configuration on the assumption that it can't hurt. An inert escape hatch teaches the next reader that cargo-culting bundler configuration is normal; it usually isn't needed, and when it is, the reason is specific to one dependency's shape.

## Dependency honesty from the very first commit

A fresh scaffold declares only what its own source actually imports — there is no "common set" of packages worth pre-declaring just because a mature action of this shape usually ends up needing them. A pre-declared, not-yet-imported dependency is unused on day one, which is precisely the state a dependency-honesty check exists to forbid, and it teaches whoever reads the scaffold first that unused declarations are normal here. Add a dependency in the same change that adds the import that needs it — including when an optional module (App authentication, say) is what introduces it.

## Repository workflows

At minimum, a repository built on this shape needs: a workflow that runs the test suite and lint on every change; a release workflow; and a **self-dogfood workflow**, in which the action runs itself against its own repository. A self-dogfood workflow catches an entire class of regression nothing else does — the difference between "the unit tests pass" and "the built action actually runs on a real runner against real inputs" — and it's the cheapest possible integration test, since the repository is always available as a target.

A committed local-build target, produced by the same build step that produces the real distribution bundle, gives a fast, no-network way to smoke-test the built artifact before it ever reaches a workflow run. Gate the freshness of any committed bundle in CI by rebuilding and diffing — a stale committed bundle is a silent divergence between what's reviewed and what actually runs.

## The root context file and the shim register

The repository's own top-level context documentation covers what's specific to *this* repository — its own conventions, its own layout — and explicitly does not restate API knowledge that belongs to the kit's own documentation surface. Included in it: the **shim register**, a live accounting of every local stand-in currently in place for a kit capability checked and found absent (see [services-and-shims.md](services-and-shims.md) for the header contract each shim itself carries). A scaffold with no shims yet still documents the register as empty, rather than omitting the section — its presence is what reminds a later contributor that the convention exists at all.

## Everything else

Standard repository hygiene — a license, a code of conduct, contribution and security policies, issue templates, dependency-update automation, an editor/devcontainer configuration — carries over from whatever baseline the organization already uses for a small, single-purpose repository; none of it is specific to being a GitHub Action. The distinguishing scaffolding is entirely in the pieces above: the manifest as single source, per-need build escape hatches, dependency honesty from the first commit, a self-dogfood workflow, and a maintained shim register.

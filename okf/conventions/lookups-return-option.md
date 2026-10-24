---
type: Convention
title: A public lookup that can miss returns Option, never T | undefined
description: Every public find, first, get, by-key or resolve lookup on a kit value or service, and every getter derived from one, returns Option; T | undefined survives only in four named exemption classes, and argument-side optionality is out of scope.
status: draft
stale_after: "2027-04-23T00:00:00Z"
tags:
  - architecture
sources:
  - id: owner-ruling
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: "2026-10-23T00:00:00Z"
  - id: jsonc-node
    resource: ../../packages/jsonc/src/JsoncNode.ts
  - id: git-config
    resource: ../../packages/git/src/GitConfig.ts
  - id: workspace-package
    resource: ../../packages/workspaces/src/WorkspacePackage.ts
  - id: hosted-schema
    resource: ../../packages/schemastore/src/HostedSchema.ts
  - id: memfs-volume
    resource: ../../packages/memfs/src/MemoryFileSystem.ts
  - id: import-graph
    resource: ../../packages/workspaces/src/ImportGraph.ts
  - id: ui-key
    resource: ../../packages/cli/src/ui/UiKey.ts
  - id: frontmatter-resolver
    resource: ../../packages/markdown/src/FrontmatterResolver.ts
generated:
  by: "okfit/claude-code"
  at: 2026-10-24T00:37:31Z
integrity:
  generated:
    body: 4514097a2844e323
---

# A public lookup that can miss returns Option, never T | undefined

A public lookup that can come back empty returns `Option<T>`. That covers
every `find`, `first*`, `get`, `by*` and `resolve*` member on an exported
kit value or service, and every getter derived from one. The absent case is
`Option.none()`, never `undefined`.[^owner-ruling]

This is already the kit's majority shape. The sibling format packages'
tree lookups return `Option` (`JsoncNode.find`, `findAtOffset`,
`pathAt`),[^jsonc-node] as do `GitConfig.get`[^git-config] and the
derived `WorkspacePackage.scope` getter.[^workspace-package] The rule names
that shape so a new surface does not need a survey to find it, and so a
review can cite a rule instead of a precedent. It also brings
`MarkdownDocument`'s `frontmatter`, `firstSection`, `sectionByHeading` and
`find`, and `HostedSchema.resolvedCurrent`,[^hosted-schema] onto `Option`.

A `Result`-returning lookup is still a lookup. `SchemaResolver.declarationOf`
extracts a `$schema` declaration from decoded frontmatter and can miss, so
its success channel is `Option<SchemaDeclaration>`, giving
`Result<Option<SchemaDeclaration>, …>`.[^frontmatter-resolver] An overload
narrows the shape when the caller rules the miss out: under
`requireDeclaration: true` the miss is a typed failure, so the success is the
bare declaration and no `Option` is wrapped around a value the type knows is
present. The miss is
a tolerated success, distinct from the typed failures, and `Option` keeps
it from being confused with a stray `undefined`; "the absent case is a
tolerated success inside a `Result`" was considered as a fifth exemption
and declined, because the `Result` already separates failure from success
and buys nothing for the miss itself.

Why `Option` rather than `undefined`: a stray `undefined` can carry
meaning nobody meant it to. A spread, an optional field, or a defaulted
argument can produce one by accident, and the receiving code cannot tell
that from a real miss. `Option` makes the miss a value the caller has to
handle, and it composes with `Option.map`, `Option.match` and
`Effect.fromOption`. The same argument settled
[the ascend ceiling](../decisions/physical-ceiling-is-a-separate-static.md),
though there it was applied to a parameter, where a stray `undefined`
would have changed behaviour (an unbounded walk). That precedent does not
reach argument-side optionality in general; see the scope section
below.

## A derived getter is a lookup

A getter that computes its answer by walking or searching the value, such
as `MarkdownDocument.frontmatter` (derived from the head of the tree, not
stored) or `HostedSchema.resolvedCurrent` (`current`, else the newest
advertised version), is a lookup that happens to use property syntax. It falls under
the rule. A getter that only reads back a stored optional field is data,
and falls under exemption 1 below. The test is whether the getter can miss
because of a search or a resolution. If it can, it is a lookup. The
public type is what a reader sees, so this holds even when the getter's
body happens to read one stored slot: `resolvedCurrent` returns a field of
an already-resolved record, but it is named and documented as a
resolution, and a caller cannot tell the difference.

Cost is no argument for `undefined` here. Derived getters already
recompute on every access (markdown's navigation getters walk the tree
each time), so the extra `Option` allocation is negligible next to the
walk.

## The four exemptions

`T | undefined` stays only in these classes. Anything outside them follows
the rule.

1. **Optional data fields.** A field on a Schema, a wire shape or a foreign
   shape that is optional in the data itself, including mdast-shaped node
   fields. This is the data's own optionality. Wrapping it in `Option`
   would make the type disagree with what is on the wire.
2. **Caller-supplied callbacks.** A callback or fault handler that the
   caller supplies, whose `undefined` answer is part of the callback's own
   contract: decline, pass through, or no objection. Examples are memfs
   fault handlers, `ImportGraph`'s
   `followPackage`,[^import-graph] and `TextInput`'s `validate`. The kit
   reads these results; it does not hand them out.
3. **Non-Effect host adapters.** An adapter at a boundary that has no
   Effect runtime, whose result feeds an optional field as is. Examples are
   `ProcessGuard.parseInjectCrash`, which fills
   `ProcessGuardOptions.injectCrash` before the runtime starts, and
   `UiKey.fromInk`, which runs inside Ink's input handlers.[^ui-key]
4. **Test-double inspectors.** Inspectors shaped like the assertions that
   call them, namely the memfs volume inspector (`text`, `bytes`,
   `readDirectory`, `mtime`, `readLink`, `lstat`).[^memfs-volume] A test
   asserts directly on the result (`assert.strictEqual(volume.text(p),
   "x")`, `assert.isUndefined(...)`). `Option` there would add a step to
   every assertion and catch nothing.

A new exemption is a change to this concept, not a judgement made at the
call site.

## Argument-side optionality is out of scope

The rule governs what a lookup **returns**. It says nothing about
parameters. A method that takes an optional argument, such as
`HostedSchema.idFor(version?: string)`, where omitting the version means
"the unversioned id", stays as it is.[^hosted-schema] Do not cite this
rule against it. The ascend-ceiling decision is no counter-precedent:
there an omitted ceiling would have meant an unbounded walk, while
`idFor`'s omitted version is a documented default. A caller holding an `Option` result passes it on with
`Option.getOrUndefined`.

[^owner-ruling]: conversation with the repository owner, 2026-10-23 —
    ruling 1 of the breaking kit wave: Option for public lookups, with
    named exemptions.
[^jsonc-node]: `packages/jsonc/src/JsoncNode.ts` — `find`,
    `findAtOffset` and `pathAt` each return `Option.Option`.
[^git-config]: `packages/git/src/GitConfig.ts` — `get(section,
    subsection, key)` returns `Option.Option<string>`.
[^workspace-package]: `packages/workspaces/src/WorkspacePackage.ts` —
    the derived `scope` getter returns `Option.none()` for an unscoped
    name.
[^hosted-schema]: `packages/schemastore/src/HostedSchema.ts` —
    `resolvedCurrent`, and `idFor`/`urlFor`/`fileNameFor` taking an
    optional `version`.
[^memfs-volume]: `packages/memfs/src/MemoryFileSystem.ts` —
    `MemoryFileSystemVolume`, whose inspectors return `undefined` for an
    absent path.
[^import-graph]: `packages/workspaces/src/ImportGraph.ts` —
    `followPackage` returns `undefined` to decline following a specifier.
[^frontmatter-resolver]: `packages/markdown/src/FrontmatterResolver.ts` —
    `SchemaResolver.declarationOf` returns
    `Result.Result<Option.Option<SchemaDeclaration>, …>`; `Option.none()`
    for data with no `$schema` key. The `requireDeclaration: true` overload
    returns `Result.Result<SchemaDeclaration, …>` with the miss as a typed
    failure.
[^ui-key]: `packages/cli/src/ui/UiKey.ts` — `fromInk` maps an Ink key
    event to a `UiKey`, or `undefined` when the event has no binding.

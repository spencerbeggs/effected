---
type: Decision
title: CliLinks finds the editor directory with its own bounded ascent
description: "CliLinks walks up to find a .vscode directory with an inline Path.dirname loop over FileSystem.exists, rather than depending on @effected/walker, which would add @effected/glob to every cli consumer's closure."
status: stable
tags: [architecture, bundle, deps]
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T23:56:58Z
verified:
  - by: human:spencer
    at: 2026-10-09T17:01:48Z
  - by: human:spencer
    at: 2026-10-13T21:42:59Z
integrity:
  generated:
    body: 44c56e989071df0b
  verified:
    by: human:spencer
    at: 2026-10-13T21:42:59Z
    content: 6cd0f235d63cf3fe
---

# CliLinks finds the editor directory with its own bounded ascent

Superseded by [CliLinks finds the project root with @effected/walker](cli-takes-the-walker-edge.md): the user reversed this ruling, and `CliLinks` takes the walker edge. This draft is left for a human to verify and deprecate.

## Context

`CliLinks` decides whether to emit editor-aware links and needs to find a
`.vscode` directory above the working directory. `@effected/walker` already
walks upward, and the P3 design (spec D-G, never recorded as a concept) used
it.

## Decision

This supersedes spec D-G, which is not a concept and so cannot be named in
`supersedes`. `CliLinks` does not depend on `@effected/walker`. It runs an
inline bounded loop of about ten lines: `Path.dirname` upward, asking
`FileSystem.exists` at each level, stopping at the root or a fixed depth.

The reason is the peer closure. `@effected/walker` peers on `@effected/glob`,
so taking the edge would force two extra installs on every `@effected/cli`
consumer to locate one directory. `@effected/cli` is
[boundary tier](../conventions/peer-dependency-discipline.md) and takes no new
`@effected/*` peer for this.

## Alternatives rejected

- **Depend on `@effected/walker`.** Rejected for the closure cost above.
- **Make the peer optional.** Rejected: an optional peer reached from a module
  the root imports is a crash for consumers who skipped it.

## Consequences

The ascent logic is duplicated in small. If the walk ever needs the full
walker's semantics (ceilings, symlinks, several markers), move to the walker
and record a new Decision.

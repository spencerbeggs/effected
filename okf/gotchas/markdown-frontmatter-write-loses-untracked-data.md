---
type: Gotcha
title: Writing frontmatter re-serializes the whole block and can drop untracked data
description: A frontmatter write looks like a targeted update but actually re-serializes the entire block from the decoded value, silently dropping anything the codec's data model does not carry — such as yaml comments.
status: stable
stale_after: 2027-01-13T00:00:00Z
resource: ../../packages/markdown/src/Frontmatter.ts
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 5fd20b4f2585ad19
---

# Writing frontmatter re-serializes the whole block and can drop untracked data

## What a reader sees

A consumer calls the frontmatter write API with an updated value, expecting
it to behave like `@effected/yaml`'s or `@effected/toml`'s own edit layers —
a surgical change that leaves everything else in the block untouched,
consistent with the kit's stated fidelity obligation for its format
packages.

## What they will wrongly conclude

That a frontmatter write preserves everything in the original block that
the new value did not explicitly change — comments, blank-line layout,
key ordering choices not reflected in the decoded value — the same way a
`YamlEdit`-based patch would.

## What is actually true

The frontmatter writer produces exactly one edit: a replacement spanning the
whole capture, both fence lines included. The replacement body is
re-serialized in full from the encoded data by the target format's codec —
`gray-matter` parity, not surgical editing. Anything the format's data model
does not carry is lost on write: a yaml frontmatter block's comments, for
instance, do not survive a write through this seam, even though
`@effected/yaml`'s own edit layer, used directly on a yaml document, would
have preserved them.

## The check

Read `packages/markdown/src/Frontmatter.ts`'s write-seam implementation and
the ["read and write" section](../interfaces/markdown-frontmatter.md#read-and-write)
of the frontmatter interface before assuming a frontmatter write is
surgical. A consumer that needs comment-preserving frontmatter edits must
decode the block's raw text with the underlying format package's own edit
layer directly rather than going through this write seam; per-key surgical
frontmatter editing over those edit layers is recorded future work, not yet
built.

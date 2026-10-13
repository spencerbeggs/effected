---
type: Limitation
title: Bun's package-tuple integrity position is assumed, not documented
description: Integrity data is read from an inferred index in bun's package tuple because bun does not document the tuple's shape.
status: stable
bounds: ../modules/lockfiles.md
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 8f7302f75ba39723
---

# Bun's package-tuple integrity position is assumed, not documented

## Condition

`@effected/lockfiles` parses `bun.lock`, whose per-package entries are JSON tuples rather than named objects, and reads integrity data out of one specific tuple index.

## Symptom

Nothing observable under normal operation — the permissive reading, pinned by a fixture from a current bun release, correctly extracts integrity today. The risk is latent: bun could change the tuple's positional shape in a future release without documenting the change, since the shape itself is under-documented upstream in the first place.

## Why this is acceptable

Bun does not publish a stable, documented schema for its lockfile's package-tuple shape the way npm and pnpm document their object-keyed formats. Reading a tuple by position is therefore inherently an inference from observed output rather than a promise from bun. The read is defensive where it can be: it is decoded through a permissive schema whose failure is a skip, not a parse error, so an unexpected info object at that position costs a consumer nothing beyond the missing integrity data, never their whole lockfile parse.

## What the fix would take

Bun publishing and versioning a documented schema for its lockfile tuple shape would let this package pin against a stable contract instead of an inferred position, and add a version-gated reader if the shape changes across bun releases the way pnpm's lockfile version already does. Until bun documents the shape, the fallback is watching bun releases for lockfile-format changes and updating the fixture (and the assumed index, if it moves) when one is observed.

---
type: Gotcha
title: Calling Store.layerSqlite inline at two provide sites opens the database twice
description: Store.layerSqlite is a parameterized factory, and Effect layers memoize by reference — calling it a second time with identical options builds a second layer instance, opening a second connection to the same database file.
status: stable
resource: ../../packages/store/src/Store.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
  - performance
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: e7972d5cb8d42627
---

# Calling Store.layerSqlite inline at two provide sites opens the database twice

## What a reader sees

Two different parts of a program each call `Store.layerSqlite({ filename:
"state.db", migrations })` inline, at their own `Layer.provide` call site,
with identical arguments — reasoning that identical options should mean
identical behavior either way.

## What they would wrongly conclude

That providing the "same" layer twice, with the same options, is
equivalent to sharing one layer built once — that Effect deduplicates two
structurally-equal layer calls the way it would deduplicate two references
to the same bound value.

## What is actually true

`Store.layerSqlite` is a parameterized factory: each call constructs a new
layer instance, and Effect's layer memoization works by **reference**, not
by structural equality of the arguments passed. Two separate calls with
identical `filename` and `migrations` values are still two distinct layer
instances from Effect's point of view, so providing both opens two
separate connections to the same underlying SQLite file rather than
sharing one. The database gets opened twice, silently, with nothing about
either call site indicating it is not the sole owner of the connection.

## The check

Call `Store.layerSqlite(options)` exactly once, bind the result to a
`const`, and provide that same bound value at every site that needs
it.[^store-layer-sqlite] Never call the factory inline at more than one
`Layer.provide` or `Layer.mergeAll` site with the same options, even when
the options are identical — identical arguments do not make Effect treat
the two calls as one layer.

[^store-layer-sqlite]: `packages/store/src/Store.ts:152-273` — the
    `Store` class doc states the layer statics are parameterized factories
    and that failing to bind the result once "and the database is opened
    twice" is the direct consequence of calling it more than once.

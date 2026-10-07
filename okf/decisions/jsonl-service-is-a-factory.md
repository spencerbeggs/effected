---
type: Decision
title: The jsonl Journal service is a per-registry factory, not a generic key
description: "`Journal.Service<Self>()(id, { events, config })` produces one class per event registry, with its layer a single static value built from the definition-site config."
status: draft
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-10-07T19:15:53Z
  body_sha256: 54c9ae1c05edb0ee1518117582344a523c1e5eb65f7e40829c480a354be847fd
---

# The jsonl `Journal` service is a per-registry factory, not a generic key

## Context

`@effected/jsonl` needed a service shape that lets several distinct
journals — each declaring its own set of events via its own registry —
coexist in one Effect layer graph, each one typed by its own registry
rather than a shared, widened shape. The first shape paired the
per-registry class with a function-valued `.layer(config)`, and the
double-journal hazard that function carried is what moved the config to
the definition site.

## Decision

`Journal` is not a `Context.Service` generic over the registry.
`Context.Service` binds a concrete shape at declaration, and the resulting
key cannot be parameterized at retrieval — there is no form in which
`yield* Journal` returns something typed by a registry supplied at the use
site. Instead `Journal.Service` is a per-registry service-class factory:
each registry gets its own uniquely-keyed service class, so several
journals coexist in one layer graph and each one's operations are typed by
its own registry. The registry and the journal's config ride on the
class-definition site and are inferred, so `Self` is the only explicit type
parameter:

```ts
class MailJournal extends Journal.Service<MailJournal>()("dogfood/MailJournal", {
  events: MailEvents,
  config: { path: ".dogfood/mail.jsonl" },
}) {}

const program = Effect.gen(function* () {
  const mail = yield* MailJournal;
  yield* mail.append("mail-received", { round: 7 });
}).pipe(Effect.provide(MailJournal.layer));
```

`config` is a plain record or an `Effect` producing one, so a path can come
from `Config` or another service and resolve when the layer builds; that
effect's error and requirements flow into the layer's own channels.

The class's static `layer` is a value, not a function. Layers memoize by
reference, and there is exactly one `layer` per class, so providing it at
two sites provides one journal twice — two independent journals over one
file cannot be minted through it. The static `make(config)` serves the
remaining case, a path known only at run time: every call builds an
independent journal, so the consumer wraps it once —
`Layer.effect(MailJournal, MailJournal.make(config))` — and binds that
layer to a single value. Bind-once survives only on this explicitly
runtime path.

## Alternatives rejected

**A function-valued `.layer(config)`**, the shape `@effected/config-file`
established and the one this package first shipped. Each call returns a
new layer, and because layers memoize by reference, calling it at each
provide site mints two independent journal instances over one file, each
with its own semaphore, watcher and hub — the appends are no longer
serialized against each other, the in-process version of the bug the
cooperative-writer rules exist to prevent. Its only defence was a TSDoc
warning and a bind-once rule a reviewer had to enforce on every consumer;
moving the config to the definition site makes the hazard structurally
impossible for the common case, at the cost of `make` for paths that are
only known at run time.

**A non-generic service plus a generic client factory**, the shape core's
`eventlog` uses to solve the same problem. Recorded as the escape hatch if
the per-registry factory ever proves unworkable, but rejected as the
primary shape: the registry has to type the service's own operations, not
a wrapper's, and splitting them into a separate client would put the typed
surface one indirection away from the thing consumers actually hold.

## Consequences

A consumer defining a new journal writes one small class declaration,
config included, rather than reaching for a generic parameter at every call
site, and the compiler enforces that a journal's operations are typed by
exactly the registry it was declared with. Providing `MailJournal.layer`
anywhere, any number of times, is always the same journal. The remaining
discipline is confined to `make`: a code reviewer checking a runtime-path
journal must confirm the `Layer.effect(Class, Class.make(config))` it
builds is bound to one value and provided from there, not rebuilt at each
provide site.

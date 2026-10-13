---
type: Gotcha
title: A renamed field typed never turns a silent conditional-spread drop into a compile error
description: "Dropping a renamed field outright lets a caller's conditional spread (`...(token !== null ? { token } : {})`) compile clean while silently omitting the field, because a spread of an unknown property is not an excess-property error — typing the deprecated field never makes the same spread fail to compile instead."
status: stable
resource: ../../packages/npm/src/NpmRegistry.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
sources:
  - id: npm-registry-source
    resource: ../../packages/npm/src/NpmRegistry.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: d4a8b6200e587a59
---

# A renamed field typed never turns a silent conditional-spread drop into a compile error

## What a reader sees

`@effected/npm`'s `RegistryTarget.token` field is typed `readonly
token?: never`,[^npm-registry-source] and a call site somewhere still
writes `...(token !== null ? { token } : {})` when constructing the
object. TypeScript compiles this without complaint.

## What they would wrongly conclude

That leaving a deprecated field typed `never` rather than deleting it
outright is pure ceremony — a documentation gesture with no functional
effect, since the field cannot legitimately hold a value anyway and the
spread "obviously" still does what it always did.

## What is actually true

`RegistryTarget` replaced a bare `token` field with a `credential` union
(`{ kind: "token" } | { kind: "basic" }`). Simply deleting the old
`token` field would have been a **silent** break: a caller's conditional
spread of a property TypeScript no longer knows about is not an
excess-property error, so the spread would compile clean and the field
would simply vanish from the constructed object — an authenticated probe
silently becomes an anonymous one. Against a private registry that
answers 401 to an anonymous read, `NpmRegistry.version` reads that as
"not published," and a publish flow acting on that reading republishes a
version that already exists.

Typing the field `never` instead of deleting it, and keeping it for one
deprecation cycle, converts that same spread into a genuine compile
error: assigning any value — even inside a conditional spread — to a
field typed `never` fails to typecheck. An alias to the new field would
have kept the silent path compiling too, which is why the field is typed
`never` rather than `Redacted<string>` or removed outright.

## The check

When retiring a field a caller might still be constructing through a
conditional spread, do not delete it outright and do not alias it to the
replacement. Type it `never` for one deprecation cycle, so any surviving
call site that still tries to populate it fails to compile rather than
silently dropping the value. Generalize this rule to any field removed
from a type that callers commonly populate through a spread rather than a
literal object — the spread is exactly the shape that an outright
deletion cannot catch.

[^npm-registry-source]: `packages/npm/src/NpmRegistry.ts:33-44` — the
    `@deprecated` `token?: never` field and its comment explaining the
    conditional-spread hazard it exists to catch at compile time.

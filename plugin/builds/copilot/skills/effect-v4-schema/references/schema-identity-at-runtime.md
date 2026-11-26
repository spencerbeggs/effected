# Schema identity — erased checks and schemas that are functions

## A `Schema.check` narrowing is ERASED from the published type

A check narrows what **decodes**, not what the value is **typed** as — so a
checked schema and its base publish as the *same* declared type.
`CorepackIntegrityHash` (corepack-form-only) and the wide `IntegrityHash`
brand both emit as `Schema.brand<Schema.String, "IntegrityHash">` in
`@effected/npm`'s built `.d.ts`; a consumer reading the types cannot tell
them apart. The consequence bites in two directions:

- **A faithful private re-fork of a shared checked schema is invisible** to
  `tsc` AND to every behavioral test — the mutant that re-forks the schema
  keeps the entire rejection matrix green. When two modules must share a
  checked narrowing of one brand, the only proven guard is a **runtime
  identity assertion** on the consumer's field schema
  (`X.fields.integrity.schema === CorepackIntegrityHash`; through
  `Schema.Option`, `.fields.<name>.value === …`), with a control proving it
  discriminates (`=== IntegrityHash` must be false). The failing assert
  prints "Compared values have no visual difference" — which is the point.
  Do not downgrade it to a behavioral test, which cannot fail, or a
  source-text import walker, which passes if the import is left unused.
- **A behavioral break can be type-invisible**: strictening a field's check
  ships a byte-identical `.d.ts` while previously-accepted inputs now fail at
  decode. Announce such a change loudly in its release notes — nothing
  downstream fails to compile.

## A schema value is a function at runtime

Every schema — `Schema.String`, a `Struct`, a `Literals`, a `Schema.Class`
factory result, a `.check(...)`-ed schema — is built by `internal/schema/make.ts:46`
as `function Schema() {}` with its prototype swapped to the schema proto, so
`typeof` reports `"function"`, never `"object"`. Probed against a
control (`Schema.isSchema(42)` → `false`):

```text
Schema.String:                        typeof=function  isSchema=true  objectGuardAccepts=false
Schema.Struct({...}):                 typeof=function  isSchema=true  objectGuardAccepts=false
Schema.Literals([...]):               typeof=function  isSchema=true  objectGuardAccepts=false
Schema.Class factory result (Person): typeof=function  isSchema=true  objectGuardAccepts=false
Schema.String.check(...):             typeof=function  isSchema=true  objectGuardAccepts=false
```

So a `typeof value === "object"` guard in a config loader classifies every
user-supplied schema as "not a schema" and reports a config with five schemas as
declaring none — a false *negative* the loader's own tests cannot see when their
fixtures are objects too. Use
`Schema.isSchema` (`Schema.ts:2349`, a `TypeId` brand check), and when a guard
must also accept plain objects, test `isSchema` **first**.

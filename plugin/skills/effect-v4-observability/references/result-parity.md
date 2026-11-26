# Result-parity: the sync twin of a spanned boundary

**Pure `Result`-returning siblings of a spanned boundary carry no span.** This
is the kit's **Result-parity rule**, a kit-wide policy rather than a package
idiosyncrasy.

## Scope

A public boundary returning `Effect` with `R = never`, no async step and no IO —
where the wrapper carries nothing but a span and the error channel — must
expose the sync form as the primitive, spelled `*Result` (`Fmt.parseResult`
pure, `Fmt.parse` spanned).

- **Never `*Sync`**: the Effect form is also synchronous, and the kit uses
  `*Sync` for genuinely-blocking-IO facades returning nullables.
- **Interface/adapter seams are out of scope.** The policy applies to the
  engine, not every adapter over it: a codec implementing an `Effect`-shaped
  interface stays as it is.

## What the sync variant does not get

The sync variant is not an Effect and gets no span, no log, no metric. Do not
wrap it in one to "keep coverage uniform" — the uniform-coverage rule governs
the *Effect* surface.

## The two obligations instead

1. The Effect variant is defined **in terms of** the Result variant behind its
   named span, so tracing sees every Effect-path call and the two can never
   diverge:

   ```ts
   static parseResult(text: string): Result.Result<unknown, ParseError> { ... }
   static parse = Effect.fn("Fmt.parse")((text: string) => Effect.fromResult(Fmt.parseResult(text)))
   ```

2. The sync variant's TSDoc points Effect consumers at the spanned variant.

## Review findings

- A sync twin whose Effect sibling lacks a span.
- A sync twin that quietly grows its own logging.
- An in-scope boundary with no `*Result` twin at all.

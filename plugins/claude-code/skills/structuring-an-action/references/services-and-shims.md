# Services and shims

Both `services/` and `shims/` are documented conventions, not tracked empty directories. An action that needs neither ships neither — document the convention itself in `src/CLAUDE.md` so the slot is discoverable without a placeholder file or an empty directory pretending something lives there. A `.gitkeep`-style fossil under a convention directory is the same false signal as a bundle guard that never asserts anything.

## When a capability earns `services/`

A step used exactly once stays a step — its logic lives in its own module under `steps/`, scoped to that one use. Promote a capability to a `Context.Service` class under `services/` only when a second step, or a second action, genuinely needs the same behavior behind the same interface. Promoting too early produces a service with one consumer and a test double nobody else exercises; the cost of promoting late is a mechanical refactor, which is cheap compared to maintaining an abstraction with a single caller.

## The shim register

A shim is a local, blessed stand-in for a kit capability that was checked and found genuinely absent — never a workaround adopted because checking felt slower than writing the workaround. One module per missing contract, named for what it stands in for:

```ts
// shims/my-missing-contract.ts
/**
 * Stand-in for <capability> — checked absent in @effected/<package> as of
 * version <X.Y.Z>. Tracking issue: <link>. Remove this module once the kit
 * ships the capability and re-point callers at it directly.
 */
```

The header is mandatory, not a nicety: it records which kit surfaces were checked absent and at which version, a tracking-issue link, and the condition under which the shim gets removed. A shim with no header is indistinguishable from a permanent, undocumented fork of kit behavior — and a fossilized "the kit doesn't ship this" comment, never re-checked, is the single most common way a shim outlives the gap it was written for.

**Re-audit the whole register on every kit version bump.** A shim's absence-claim is a fact about one version of one package; the next version is exactly the point at which that fact might no longer be true.

## The upstream-migration protocol

Watch for code that belongs in the kit rather than in this repository — a raw subprocess call standing in for a capability a kit package almost-but-not-quite ships, a second hand-rolled copy of logic the kit already half-covers. Recognizing this pattern mid-build is common; deciding what to do about it silently is the mistake.

When you spot one: **ask the user** whether to contribute the fix upstream now or write a local shim for it. Either way, file an issue against the kit describing the gap, and — if a shim goes in — a linked tracking ticket in this repository pointing at it. A shim with a tracking issue is a documented, temporary decision; a shim with no tracking issue is exactly how "wait for the kit" quietly becomes permanent.

This protocol is the same one `designing-an-action`'s recon phase names for a capability discovered missing before the skeleton exists; it applies identically here, for a gap discovered mid-build.

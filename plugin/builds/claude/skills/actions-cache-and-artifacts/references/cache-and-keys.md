# `ActionCache` paths, and `CacheKey`

## `ActionCache`'s `paths` are glob patterns on save, hashed literally on both sides

`save` resolves `paths` with `actions/cache` parity before archiving:
`**/node_modules` matches directories and archives them recursively;
non-matching patterns — including an absent literal — are dropped
silently; a fully-empty resolution fails typed with zero backend calls;
`~` and `!` work; relative patterns root at `GITHUB_WORKSPACE`.

`restore`'s tar is pure extract and consumes no paths — its `paths`
argument exists only to derive the cache **version**, which hashes the
**literal** pattern list on both save and restore, never the resolved
paths (this matches the upstream toolkit's own version derivation). Pass
the same literal list to both calls, or the entry is invisible on
restore — a glob resolving to different files between save and restore
doesn't matter to the version; only the literal strings do.

Treat `tar: **/…: Cannot stat` as the signature of a resolution step being
skipped — patterns handed to `tar` verbatim rather than resolved first.
Resolved paths reach `tar` via a manifest file (`-T`), never argv — a
workspace-rooted `**` resolution can be tens of thousands of paths, well
past the OS argv length limit.

## `CacheKey`: pure, no service, no layer

`CacheKey` is a `Schema.Class` over validated, comma/newline-refusing
segments, with a restore-key ladder that is **policy-carrying, not only
derived**:

- Absent an explicit policy, every prefix becomes a rung, most-specific
  first.
- `withRestoreDepths([4, 3])` makes the key carry an explicit ladder — each
  depth is the count of leading segments kept, rungs emitted in the given
  order. Order *is* the policy: GitHub tries rungs in the order given.
- `withoutRestoreKeys()` is the exact-match-only spelling — zero rungs.
- `withNamespace(segment)` is the **cache-bust** spelling: it prepends
  `segment` AND drops the ladder. Both halves are one intent — a restore
  key is a prefix match, so folding a bust token in *after* the retained
  prefix leaves an ordinary run's rung prefix-matching busted entries.
  Segment-first means a namespaced key shares no prefix with an
  unnamespaced one; the dropped ladder means no rung can reach outside the
  namespace even when the segment equals an ordinary leading segment.
  Follow it with `withRestoreDepths` to get an in-namespace ladder back
  deliberately.

All four ride the same schema field, survive an `ActionState` round trip,
and pass through `ActionCache.restore(paths, cacheKey)` untouched — never
hand-build a ladder beside a typed key.

Two properties every hand-rolled restore-key ladder gets wrong:

- **Every rung ends in the separator.** GitHub matches a restore key as a
  bare prefix, so a rung like `Linux-pnpm` with no trailing separator
  would also match `Linux-pnpmx-…` from an unrelated cache.
- **A one-segment key produces no rung at all.** An empty prefix would
  match every cache in the repository.

`CacheKey.forBranch` orders segments `os → scope → branch → hash`
deliberately: reversed, a feature branch's first fallback would jump
straight to `main` before ever trying its own branch.

### `hashFiles`: byte-compatible with `@actions/glob`'s `hashFiles`

Every detail that makes this true is easy to get wrong: paths are sorted
and de-duplicated before hashing, each file is digested on its own, and
the per-file digest feeds the accumulator as **binary**, not hex:

```ts
accumulator.update(createHash("sha256").update(bytes).digest());
```

A hex-fed accumulator produces a perfectly plausible-looking digest that
simply never matches a cache entry written by any other action in the same
workflow — the failure is silent, not an error. `hashFiles` returns
`Option.none()` for an empty file set: "nothing matched" is not a digest,
it's the signal that a pattern is wrong, and folding it into a key would
cache silently against a constant.

### `matchingFiles`: discovery kept separate from matching

The walk is core `FileSystem.readDirectory(workspace, { recursive: true })`;
the matching is `@effected/glob`'s glob-set engine — the same minimatch
dialect `@actions/glob` uses, so a workflow author's exclusion pattern
behaves identically to every other cache step in the same workflow.
`node:fs.globSync` is rejected here on a correctness argument, not a
weight one: it welds discovery and matching into one non-stubbable call,
and Node's own glob dialect isn't minimatch — a dialect divergence would
be a silent cache-key difference from every sibling action, the worst
failure mode a cache key can have.

Candidates are matched by their path **relative to the workspace**, making
"never hash a file outside the workspace" structural; directories are
excluded by an explicit file-type check, because a directory named
`notes.txt` matches a `**/*.txt` pattern and is not a file.
`CacheKey.hashMatching` is `matchingFiles` fed straight into `hashFiles` —
the pairing every consumer would otherwise write by hand, whose two halves
have to agree about ordering.

### Where `hashFiles` is homed, and why

`hashFiles` lives here honestly, not permanently. It cannot live in a
pure-tier glob package — pure tier, forbidden the filesystem dependency —
and it cannot live in a boundary-tier walker package today, because core's
cryptography contract at this Effect version is digest-and-RNG only, no
HMAC, and this package alone is licensed for a direct `node:crypto`
import. If a second, non-Actions consumer ever wants `hashFiles`, that's
the trigger to move it — into a small dedicated package, or back into a
boundary-tier package once core grows an HMAC contract — not a reason to
duplicate it in place.

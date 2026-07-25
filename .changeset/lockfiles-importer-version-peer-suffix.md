---
"@effected/lockfiles": minor
---

## Breaking Changes

### `ImporterDependency.version` no longer carries pnpm's peer suffix

pnpm records an importer dependency's version with a peer-disambiguation chain appended to it. That chain was previously stored verbatim in `version`, so the field was neither printable nor comparable across refs — it changed whenever any peer moved, even when the dependency itself did not.

The parser now splits the two apart. `version` holds the plain resolved version, and the new optional `peerSuffix` holds the raw parenthesized chain:

```ts
// pnpm-lock.yaml records: 4.0.0-beta.101(effect@4.0.0-beta.101)(ioredis@5.11.1)

dep.version;
// before: "4.0.0-beta.101(effect@4.0.0-beta.101)(ioredis@5.11.1)"
// after:  "4.0.0-beta.101"

dep.peerSuffix;
// after:  "(effect@4.0.0-beta.101)(ioredis@5.11.1)"
```

Consumers that stripped the suffix themselves can delete that code and read `version` directly. Non-registry resolutions such as `link:../utils` and `file:...` still pass through verbatim, and the bun, npm and yarn formats never populate `peerSuffix`.

The same splitter now serves the pnpm `packages:` key parser, so both halves of the model normalize identically.

## Tests

* The codec round-trip arbitrary generates `peerSuffix` as part of a resolution record rather than independently of `version`, so it no longer samples a suffix-without-version state the parser cannot emit

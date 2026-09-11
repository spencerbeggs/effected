---
"@effected/jsonc": minor
---

## Features

- `JsoncFingerprint.hashResult(value, digest)` and `JsoncFingerprint.hashTextResult(text, digest, options?)` are the synchronous twins of `hash` and `hashText`, for callers with no fiber to run an `Effect` in — a bundler plugin's synchronous hook, a cache `read`/`write` invoked from inside a host callback. Each agrees byte for byte with its `Effect` counterpart. Closes effected#531.
- The new `JsoncDigest` type (`(bytes: Uint8Array) => Uint8Array`) is the caller's own SHA-256 implementation, taken as an argument the way `@effected/tsconfig-json`'s `TsconfigLoaderSyncOptions` takes its file and path operations: the package still imports nothing from `node:*` and assumes no runtime, and a Node consumer passes a one-line `createHash("sha256")` wrapper.
- They are named `*Result`, not `*Sync`, per the kit's sync primitive policy — what differs from the `Effect` form is the return type.
- `JsoncCanonicalizeError` gains an `InvalidDigest` code, raised at path `""` when a supplied digest returns anything other than 32 bytes, so a wrong-algorithm binding fails typed instead of emitting a plausible-looking digest of the wrong width. The 64-lowercase-hex output guarantee is unchanged.
- No change to `hash`, `hashText`, `canonicalize`, `canonicalizeResult` or `normalizeEol`; the additions are purely additive.

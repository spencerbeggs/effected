---
"@effected/ai-plugin": patch
---

## Documentation

- The `TestClock` reference no longer says that a nested `TestClock.layer()` reads virtual time from `withLive`. A nested clock resolves the real clock behind the outer one, and `TestClock.layer()` also provides its own `Scheduler`.
- The schema reference now says that `Schema.toTaggedUnion` rejects duplicate discriminants at compile time. It also still throws at runtime when member types are widened.
- The jsonl reference now describes `FileSystem.watch`'s `onReady` callback when it explains the `JournalWatcher` seam.
- Corrects stale `FileSystem.ts` line citations in the module index, and re-derives skill source anchors against the new vendored tree.

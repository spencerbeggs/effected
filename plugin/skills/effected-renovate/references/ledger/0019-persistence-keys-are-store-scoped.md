---
id: "0019"
title: Persistence stores entries under store-scoped keys
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.0"
detect: ["Persistence\\.layer(Kvs|BackingKvs)", "layerPersisted", "KeyValueStore\\.prefix"]
---

`Persistence.layerKvs` and `layerBackingKvs` store entries under `<storeId>:<key>`, so entries written before the upgrade are not read back and cached results are recomputed. `Chat.layerPersisted` on a `KeyValueStore` loses its stored histories. Old entries are neither migrated nor removed. `KeyValueStore.prefix(...)`'s `clear`, `size` and `isEmpty` are now scoped to the prefix.

What to change: if losing the old entries matters (chat histories, expensive caches), migrate them under the new keys before you deploy, and clear the orphaned ones. Review any `clear` or `size` on a prefixed store that relied on reaching the whole store.

From the Effect changelog, not probed by the kit. Only tests or production find it.

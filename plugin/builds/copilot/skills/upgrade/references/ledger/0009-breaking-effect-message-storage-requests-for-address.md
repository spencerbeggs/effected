---
id: "0009"
title: "effect: a custom cluster MessageStorage must implement requestsForAddress, and SqlMessageStorage adds a migration"
kind: breaking
shows: typed
applies:
  "effect": ">=4.1.6"
detect: ["MessageStorage|SqlMessageStorage"]
---

To fix child workflow executions that left additional waiting parents suspended, cluster `MessageStorage` (and `MessageStorage.Encoded`) gained a required `requestsForAddress({ address, tag })` method. It returns every saved request (processed or not, across shards) whose `entityType`, `entityId` and `tag` match exactly.

Search for code that builds its own `MessageStorage` or `MessageStorage.Encoded`. The compiler reports the missing member; implement it against your store. `SqlMessageStorage` users need no code change, but its migration `0006_address_index` adds an `(entity_type, entity_id, tag)` index on the messages table the first time the new version runs. On a large table, plan for that index build. Check the interface in the installed `effect/cluster/MessageStorage` `.d.ts`.

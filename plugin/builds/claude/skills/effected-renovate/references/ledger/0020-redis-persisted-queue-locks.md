---
id: "0020"
title: Redis PersistedQueue lock format changed
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.0"
detect: ["PersistedQueue"]
---

The Redis `PersistedQueue` lock format is incompatible with older workers on the same prefix. Stop every old worker and let its locks expire before you start an upgraded one; do not run both on one prefix during a rolling deploy.

From the Effect changelog, not probed by the kit. Only production finds it.

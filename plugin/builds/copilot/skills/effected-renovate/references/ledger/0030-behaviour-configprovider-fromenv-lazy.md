---
id: "0030"
title: "effect/Config: ConfigProvider.fromEnv() reads the environment at its first lookup, not when it is called"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.5"
detect: ["fromEnv\\(\\)"]
---

`ConfigProvider.fromEnv()` with no `env` option used to snapshot `process.env` when it was called, often at import, so a variable set afterwards was invisible (Effect-TS/effect#10567). It now captures the environment at its first lookup. A probe on both versions created the provider, then set `PROBE_LATE`, then parsed `Config.String("PROBE_LATE")`: the old version failed with the variable missing, the new one read it.

- **A variable set between creating the provider and the first read is now seen.** Remove any workaround that delayed building the provider, or the layer around it, until the environment was ready.
- **A variable removed before the first read is no longer seen either.** Where code relied on the early snapshot, take one explicitly at the moment it wants: `ConfigProvider.fromEnvRecord({ ...process.env })`.
- `fromEnv({ env })` with an explicit record is unchanged.

Read each hit and decide which side it was on. Verify with the tests that set or clear environment variables around config.

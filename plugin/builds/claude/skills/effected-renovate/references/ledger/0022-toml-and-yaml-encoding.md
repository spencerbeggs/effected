---
id: "0022"
title: Core Toml.parse returns a Result and Yaml.parse honours merge keys
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.0"
detect: ["(Toml|Yaml)[^;]*from \"effect/encoding", "from \"effect/encoding/(Toml|Yaml)\""]
---

This is about **core's** `effect/encoding` `Toml` and `Yaml`, not `@effected/toml` or `@effected/yaml`.

- `Toml.parse` returns a `Result` instead of throwing, and rejects TOML 1.0's forbidden table extensions and out-of-range dates. Replace a `try` around it with handling of the `Result`. The type change shows at compile time; the stricter input rules only in tests.
- `Yaml.parse` supports YAML 1.1 merge keys (`<<`). A document that used `<<` as an ordinary key now merges; quote the key to keep it ordinary.

From the Effect changelog, not probed by the kit. The detect patterns find single-line imports only; a multi-line import needs a manual search for `Toml` or `Yaml` from `effect/encoding`.

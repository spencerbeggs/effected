---
id: "0027"
title: "@effected/npm: an unset variable in an .npmrc key now fails missing-env, and the npmrc parser is exported"
kind: behaviour
shows: behavioural
applies:
  "@effected/npm": ">=0.31.0"
detect: ["NpmConfig\\.load", "missing-env", "\\.npmrc"]
changesets: ["plain-npmrc-parse"]
closes: ["spencerbeggs/effected#1272"]
---

`NpmConfig` now treats an unset `${VAR}` in an `.npmrc` **key** the way it treated one in a value: a credential key such as `//${HOST}/:_authToken` with `HOST` unset fails `missing-env` instead of keeping the literal text. Check any environment where such a key used to load: set the variable, or remove the line.

New surface worth adopting, offered and never applied unasked: `parseNpmrc(text, env)` reads one `.npmrc` text into `NpmrcEntry` values (key, expanded value, the variables left `unset`, and an `array` flag for `key[]=` lines), and `npmrcValue` / `npmrcValues` look entries up. It replaces a hand-rolled npmrc parser in a tool that needs one file's settings without npm's full config resolution. Read the installed `.d.ts` for the exact shapes.

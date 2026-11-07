---
id: "0010"
title: "@effected/glob: Wildcard matches * and ? with no separator, brace, class or dotfile rules"
kind: adopt
shows: none
applies:
  "@effected/glob": ">=0.20.0"
detect: ["patternRegExp"]
closes: ["spencerbeggs/effected#1192"]
---

Offer this to the user; never apply it unasked. It replaces a hand-rolled regular expression built from a pattern such as an actor allow-list entry (`agent:*`), where `*` must cross `/`.

- **`Wildcard.compile(pattern, options?)`** answers a predicate, and **`Wildcard.matches(pattern, candidate, options?)`** is the one-shot form. `WildcardOptions` carries `nocase`.
- `*` is any run of non-whitespace, `?` is one non-whitespace character, and every other character is literal, including `/`, `[`, `{` and a leading dot.
- `nocase` compares under Unicode simple case folding, as a regular expression with the `i` and `u` flags does.
- It runs as a simulation over the pattern's tokens rather than a backtracking regex, so a pattern with many stars stays cheap on an allow-list fed by untrusted input.

Before replacing a matcher, compare its answers with `Wildcard`'s on the inputs its tests already carry, whitespace in particular. Read the installed `.d.ts` for the exact shapes.

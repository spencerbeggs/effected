---
id: "0010"
title: "Glob results change for patterns with two or more **, which used to give false negatives"
kind: behaviour
shows: behavioural
applies:
  "@effected/glob": ">=0.19.0"
detect: ["\\*\\*.*\\*\\*"]
---

Matching changes only where it was wrong: a pattern with more than one `**` used to miss paths it should match, and `partial` answered wrongly for such patterns. Matching with many `**` is also no longer exponential.

Search for patterns that hold two or more `**`. For each, check any snapshot or fixture of matched files: a path that was missing may now appear. Patterns with one `**` or none are unaffected.

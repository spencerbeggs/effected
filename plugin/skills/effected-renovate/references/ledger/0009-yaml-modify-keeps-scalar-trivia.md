---
id: "0009"
title: "YAML modify with indent or indentSequences no longer re-lays out the document on a scalar edit"
kind: breaking
shows: behavioural
applies:
  "@effected/yaml": ">=0.29.0"
detect: ["indentSequences", "YamlFormat\\.modify"]
changesets: ["yaml-modify-keeps-scalar-trivia"]
---

`modify` with `indent` or `indentSequences` used to re-lay out the whole document when it replaced a scalar. It now splices only that one region, so the scalar's comment and quote style survive. Only a test or a run finds the difference.

Where a caller relied on the re-layout, run `YamlFormat.format` over the result to get it. Check any snapshot of a modified YAML file, and read the installed `.d.ts` for the `format` signature.

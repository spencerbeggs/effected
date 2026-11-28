---
id: "0029"
title: "@effected/markdown-lint: nested image labels lint in linear time, and some of their findings now match markdownlint"
kind: behaviour
shows: behavioural
applies:
  "@effected/markdown-lint": ">=0.3.2"
detect: ["MD05[234]|MD039|MD042"]
closes: ["#1416"]
changesets: ["fix-markdown-nested-image-markdown-lint"]
---

Images nested in one another's labels now lint in linear time; a deep chain cost quadratic time under the rules that read image labels. Findings on such labels also moved toward markdownlint: a label holding a `]` in a code span, or a nested image whose title holds a `]`, now ends where micromark ends it. That can add or drop an MD052, MD053, MD054, MD039 or MD042 finding on a document with nested images. Re-run your lint suite and accept a finding that now matches markdownlint; report one that does not.

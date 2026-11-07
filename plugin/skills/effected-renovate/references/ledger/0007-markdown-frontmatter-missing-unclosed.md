---
id: "0007"
title: "@effected/markdown: FrontmatterMissingReason gains unclosed, and an unclosed fence reports it rather than absent"
kind: breaking
shows: behavioural
applies:
  "@effected/markdown": ">=0.28.0"
detect: ["FrontmatterMissing(Reason|Error)", "captureDisabled"]
changesets: ["clear-fences-report"]
closes: ["spencerbeggs/effected#1187"]
---

`FrontmatterMissingReason` is `absent`, `captureDisabled` or `unclosed`. A source that opens with a frontmatter fence and never closes it fails the frontmatter decoders with `FrontmatterMissingError` and reason `unclosed`, not `absent`. It is still not frontmatter, and the document parses with the fence as ordinary content.

Two shapes need work, and the compiler finds only the first:

- **An exhaustive `switch` or `Match.exhaustive` over the reason** stops compiling. Add the `unclosed` arm. The fix it asks of an author is the missing closing fence.
- **A comparison such as `reason === "absent"`, or code that treats any non-`captureDisabled` reason as "no frontmatter"**, compiles and changes meaning. Decide what an unclosed fence means there. To keep the old result, handle both reasons. A linter or a CLI usually wants to report it.

Verify with a test that decodes `---\ntitle: hi\n\nbody\n`, parsed with `frontmatter: true`. Check the literal list against the installed `.d.ts`.

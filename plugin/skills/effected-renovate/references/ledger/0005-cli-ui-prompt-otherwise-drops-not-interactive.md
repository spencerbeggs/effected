---
id: "0005"
title: "CliUi.prompt with a real otherwise no longer has NotInteractive in its error type"
kind: breaking
shows: typed
applies:
  "@effected/cli-kit": ">=0.27.0"
detect: ["catchTag\\(\"NotInteractive\""]
changesets: ["cli-kit-drops-config-peer"]
---

`CliUi.prompt` called with an `otherwise` that is not `undefined` now fails with `Cancelled` alone: a non-interactive run answers with `otherwise`, so it cannot fail. Without one, or with `{ otherwise: undefined }`, `NotInteractive` stays in the error type.

- **A `catchTag("NotInteractive", ...)` after a prompt that has a real `otherwise` is a type error.** `Effect.catchTag` rejects a tag the error union no longer holds. Delete the handler; its branch was dead.
- **A handler on a prompt with no `otherwise` still compiles** and still runs. Leave it.
- **`catchTags` and `catchReason` forms** that name `NotInteractive` on the same call fail the same way; check them against the installed `.d.ts`.

Review each hit: the pattern also matches handlers on prompts that keep the tag.

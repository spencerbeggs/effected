---
"@effected/app": minor
---

## Documentation

### `designing-an-action` and `building-a-github-action` gain a legacy-toolkit porting path

A new `designing-an-action` reference, `porting-off-a-legacy-toolkit.md`, is a symbol-keyed lookup table for porting an action off `@savvy-web/github-action-effects` — one port reconstructed the same mapping by hand from vendored source before discovering the work was mechanical. `designing-an-action` now points there first when a port changes every import and no pipeline step.

`building-a-github-action` gains a "Renamed, not absent" section (`GitHubMarkdown`, `ActionInput.string`, `Service.makeTest`/`layerTest`, `ActionRuntime.layer`) so a renamed construct filed under the skill's absence list no longer reads as a genuine gap.

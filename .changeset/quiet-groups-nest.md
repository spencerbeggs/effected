---
"@effected/cli": minor
---

## Features

* `RenderContext` and `RenderContextOfOptions` gain an optional `groupDepth`. `Render.context` reads the shared group-depth fiber-local (keyed by `WorkflowCommand.groupDepthKey` from `@effected/github-commands`) and sets `groupDepth` when it is above zero; `Render.contextOf` forwards it.

## Breaking Changes

`Render.githubLog` and `Doc.print` now render a top-level collapsible as plain text (title plus indented body) when `groupDepth > 0`, that is, inside an `ActionLogger.group`. Previously they emitted a second `::group::` that GitHub does not nest. Output at depth zero is unchanged.

---
"@effected/templates": minor
---

## Features

### Marker attributes

A managed section's `BEGIN` marker can now carry `name="value"` attribute pairs, written and read back verbatim:

```ts
import { CommentStyle, SectionId } from "@effected/templates";

const ToolSection = SectionId.make({ key: "example-tool", commentStyle: CommentStyle.hash });
const block = ToolSection.section("echo hello", { version: "1.2.3" });
```

- `Section.attributes` is always present — `{}` for a bare marker — so a consumer that never uses attributes never sees drift against a marker already on disk.
- Attributes participate in equality (an attribute change is real drift) but never in identity: changing one updates the block in place rather than orphaning it.
- New `SectionRenderError` reason `"invalidAttribute"`, carrying the offending `attribute` name, for an attribute name outside `[A-Za-z][A-Za-z0-9_-]*` or a value containing `"` or a line break.
- A non-parsing attribute run, a duplicated name, or attributes on an `END` marker all read as ordinary content — never a guessed marker.
- A scanner from before this release does not recognize an attributed marker at all; the line falls out as ordinary content. This only matters once a document actually carries attributes.

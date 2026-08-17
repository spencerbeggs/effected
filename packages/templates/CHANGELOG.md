# @effected/templates

## 0.4.0

### Features

* ### Marker attributes

  A managed section's `BEGIN` marker can now carry `name="value"` attribute pairs, written and read back verbatim:

  ```ts
  import { CommentStyle, SectionId } from "@effected/templates";

  const ToolSection = SectionId.make({ key: "example-tool", commentStyle: CommentStyle.hash });
  const block = ToolSection.section("echo hello", { version: "1.2.3" });
  ```

  * `Section.attributes` is always present — `{}` for a bare marker — so a consumer that never uses attributes never sees drift against a marker already on disk.
  * Attributes participate in equality (an attribute change is real drift) but never in identity: changing one updates the block in place rather than orphaning it.
  * New `SectionRenderError` reason `"invalidAttribute"`, carrying the offending `attribute` name, for an attribute name outside `[A-Za-z][A-Za-z0-9_-]*` or a value containing `"` or a line break.
  * A non-parsing attribute run, a duplicated name, or attributes on an `END` marker all read as ordinary content — never a guessed marker.
  * A scanner from before this release does not recognize an attributed marker at all; the line falls out as ordinary content. This only matters once a document actually carries attributes. [#397][#397]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#397]: https://github.com/spencerbeggs/effected/pull/397

## 0.3.0

### Dependencies

* | Dependency | Type           | Action  | From           | To           |                                                                       |
  | :--------- | :------------- | :------ | :------------- | :----------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.2.0

### Refactoring

* Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

* | Dependency | Type           | Action  | From           | To             |
  | :--------- | :------------- | :------ | :------------- | :------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.1.1

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.0

### Features

* First release. Managed `BEGIN`/`END` sections inside files whose surrounding
  content belongs to the user — a tool owns its delimited block, the user owns
  everything else, and neither destroys the other.

  ### `ManagedSection` — read, check and sync sections in a file

  `ManagedSection.read` / `has` / `check` / `syncAll` / `remove` operate on a
  file over Effect's `FileSystem`. A second identical sync is a no-op — no
  write, no mtime churn — and every byte outside a managed span is preserved
  byte-for-byte, including CRLF line endings and a leading BOM. `syncAll`
  rewrites sections into the declared order, so listing "preamble before tool
  block" is itself the contract.

  ### Failure is always typed, never silent

  Unterminated markers, orphaned markers, overlapping sections and duplicate
  identities all fail as a typed `SectionParseError` rather than being skipped
  or guessed at — a previous generation silently appended a second copy of a
  section on an unterminated marker.

  ### `CommentStyle`, `Section`, `SectionDialect`

  `CommentStyle` ships common presets (and accepts a caller-defined style);
  `Section` / `SectionId` name what is being managed; `SectionDialect` renders
  and scans the delimiter markers for a given comment style. The reconciliation
  algorithm is pure string-to-string (`SectionDocument`), so every invariant —
  idempotency, ordering, text preservation — is testable with no filesystem and
  no runtime. [#180][#180]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180

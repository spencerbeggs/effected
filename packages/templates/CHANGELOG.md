# @effected/templates

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

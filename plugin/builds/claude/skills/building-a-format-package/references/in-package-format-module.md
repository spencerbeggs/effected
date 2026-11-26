# A format module inside an existing package

Not every format earns a package. When a format exists only to serve one host
package — `@effected/git`'s `GitConfig`/`Gitmodules` is the precedent — build it
as a pure module set inside that package and collapse the canonical modules
that no longer pay for themselves.

- **Kept, always**: the pure document facade (parse / lossless `stringify`
  that is byte-for-byte identity on an unmodified document / surgical edits),
  the typed parse-vs-edit error split, `parse` derived from `parseResult` per
  Result-parity, and the `internal/` cycle firewall — the engine emits raw
  records plus diagnostics and never imports the public classes.
- **Folded**: `Document`, `Edit` and `Diagnostic` collapse into the one
  concept module (`GitConfig.ts` owns the document, the splice-based edit
  statics and `GitConfigDiagnostic` together), with the scanner and splice
  primitives split out into `internal/`. Nothing is lost because there is no
  second consumer to parity against, and the parity contract's whole point —
  a consumer moving between two format packages meets the same field names —
  does not apply to a module only one package imports.
- **The typed view rides on top as its own module** (`Gitmodules.ts`), whose
  mutation statics compile into the document model's surgical edits, so the
  file's own formatting survives an edit.

Promote it to a package the moment a second package needs it — that is the
trigger, not size. Until then, the collapse is the correct shape, not a
shortcut.

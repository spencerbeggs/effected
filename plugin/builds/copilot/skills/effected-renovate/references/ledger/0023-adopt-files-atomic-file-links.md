---
id: "0023"
title: "@effected/files: AtomicFile.write can replace a symlinked target rather than follow it"
kind: adopt
shows: none
applies:
  "@effected/files": ">=0.2.0"
  "@effected/package-json": ">=0.31.0"
  "@effected/config-file": ">=0.26.0"
  "@effected/templates": ">=0.19.0"
  "@effected/schemastore": ">=0.31.0"
detect: ["AtomicFile\\.write"]
closes: ["spencerbeggs/effected#1245", "spencerbeggs/effected#1269"]
changesets: ["symlink-writes-choose", "symlink-writes-config", "symlink-writes-sections", "symlink-writes-schemas"]
---

Offer this to the user; never apply it unasked. It fits a tool that writes into a checkout nobody has reviewed, where a committed symlink could point a write outside the workspace, such as a store that rewrites a manifest in a repository.

`AtomicFile.write(target, content, { links: "replace" })` replaces the link entry, live or dangling. Nothing is read, checked or created at the link's destination, and the new file takes no mode from it.

- **The default stays `"follow"`**, which keeps a link a user made on purpose, such as a dotfile. Leave those call sites alone, because `"replace"` turns the link into a regular file.
- **It covers the target only.** A symlink in a parent directory still resolves, so confine the path as well when the parents are not trusted.
- **The kit's writers forward it.** `PackageJsonFile`, `ConfigFile`, `ManagedSection` and `SchemaFile` take the same `links` option and default to `"follow"`. `effected schema build` still follows links, so confine its output path when the checkout is not trusted.

Add a test with a planted symlink at the target that asserts the outside file is untouched. Read the installed `.d.ts` for the exact shapes.

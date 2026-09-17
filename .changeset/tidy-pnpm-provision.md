---
"@effected/github-actions": patch
---

## Bug Fixes

* `PackageManagerInstaller` now provisions pnpm 12 correctly. pnpm's registry package is a wrapper whose `pnpm` bin is a shebang-less placeholder, replaced at install time by a native binary shipped as an `@pnpm/exe.<os>-<arch>[-musl]` optional dependency. The installer detects that layout from the manifest (never the major version), downloads the host's `@pnpm/exe.*` tarball from the same registry, verifies it fail-closed against the packument's `dist.integrity`, and copies the executable over the placeholder in the cached entry.
* Shims now follow their target: Node scripts run under `node`, executables and shell aliases are exec'd directly.
* A cached entry still holding the placeholder from an earlier install is reinstalled over.

Previously, pinning pnpm >= 12 failed at first use with `SyntaxError: Invalid or unexpected token`, because Node was handed the shell placeholder instead of the native binary. The error union and `install` signature are unchanged; pnpm 11 and npm/yarn/bun provisioning are unchanged.

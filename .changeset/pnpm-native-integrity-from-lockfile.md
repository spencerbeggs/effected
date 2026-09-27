---
"@effected/github-actions": minor
---

## Features

### Expected integrity beside the pin

`PackageManagerInstallOptions` gains `integrity`: the expected corepack-form hash of the manager's own artifact, supplied beside a bare pin instead of in its `+<integrity>` tail. Convert a lockfile or registry SRI with `CorepackIntegrityHash.fromSri`. The option counts exactly as a pin integrity does:

* The artifact is verified against it, and the unverified-download warning is not logged.
* It satisfies `requireIntegrity`.
* A tool-cache hit is answered without re-verifying.

When the pin also carries an integrity and the two differ, the install fails with `integrityMismatch` before any cache lookup or download. `expected` is the option, and `subject` names the pin's value. An option that is not in corepack form, such as an unconverted SRI string, fails there too with `integrityMismatch`: no `expected` or `actual` is set, and `subject` says the option is not a corepack hash.

### Lockfile integrity for pnpm's native binary

`PackageManagerInstallOptions` gains `nativeIntegrity`: expected Subresource Integrity strings keyed by bare native-package name (`"@pnpm/exe.linux-x64"`), usually read straight from `pnpm-lock.yaml`. For pnpm 12 and later, the installer verifies the host's `@pnpm/exe.<target>` tarball against that entry instead of the registry packument. The packument is then never requested, so a tarball-only mirror now works.

The option fails closed:

* No entry for the host's package fails with `integrityMissing`, and `subject` names the package.
* An entry with no usable SRI fails with `integrityMismatch`, and `subject` names the package.
* A tarball that hashes to anything else fails with `integrityMismatch`, and `subject` names the tarball url.

Pins with no native overlay ignore it. Without the option, behaviour is unchanged.

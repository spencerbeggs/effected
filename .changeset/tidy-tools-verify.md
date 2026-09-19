---
"@effected/github-actions": patch
---

## Documentation

Verified `PackageManagerInstaller` support for npm 12 (12.0.2) and npm 11 (11.19.1) provisioning, and documented that the installer provisions exactly the pinned version without checking the artifact's `engines.node` against the runner's node — an incompatible pin still installs and runs, with npm itself warning on invocation.

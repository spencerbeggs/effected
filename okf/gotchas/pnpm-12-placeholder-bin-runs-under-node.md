---
type: Gotcha
title: pnpm 12's placeholder bin dies as a SyntaxError when shimmed under node
description: A provisioned pnpm 12 that fails at first use with "SyntaxError - Invalid or unexpected token" at the toolcache's pnpm bin, line 1, is not a corrupt download or a Node fault — the pnpm bin is a shebang-less sh placeholder that only pnpm's install script replaces with the native binary, and a provisioner that skipped lifecycle scripts handed it to node.
status: stable
resource: ../../packages/github-actions/src/PackageManagerInstaller.ts
stale_after: 2027-01-17T00:00:00Z
tags:
  - ci
  - compat
sources:
  - id: installer
    resource: ../../packages/github-actions/src/PackageManagerInstaller.ts
  - id: pnpm-exe
    resource: ../../packages/github-actions/src/internal/pnpmExe.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-17T21:24:06Z
  body_sha256: 435d7e4d837104e76479195c43a4fa261d75d1ba4f56f9ce187787818cfd22f3
---

# pnpm 12's placeholder bin dies as a SyntaxError when shimmed under node

## What a reader sees

The first `pnpm` invocation after provisioning pnpm 12 on a runner dies
with

```text
<toolcache>/pnpm/12.x/<arch>/pnpm:1
# pnpm's native binary replaces this file during installation (see
SyntaxError: Invalid or unexpected token
```

— Node quoting the first line of the file it was asked to run, which is a
`#`-led comment. The install step itself reported success, and the same
pin works on a machine that installed pnpm through pnpm, corepack or
`npm install -g`.

## What they wrongly conclude

That the download was corrupt or truncated, or that the runner's Node is
broken, and that re-running the job or clearing the tool cache will fix
it. It will not: every fresh install produces the identical file, and a
runner that cached the entry keeps replaying it.

## What is actually true

From pnpm 12 the `pnpm` registry package is a thin wrapper. Its `pnpm`
bin is a shebang-less `sh` placeholder that the package's own `install`
lifecycle script overwrites with the host's native executable, fetched as
an `@pnpm/exe.<os>-<arch>[-musl]` optional dependency.[^pnpm-exe] Any
provisioner that extracts the tarball without running lifecycle scripts —
which is what every tool-cache installer does by design — ends up with the
placeholder in place, and any shim that treats "a pnpm bin" as a Node
script (`exec node <target>`) hands the shell placeholder to Node. The
comment line is the invalid token.

`@effected/github-actions` at 0.13.1 and below did exactly that; from
0.13.2 `PackageManagerInstaller` detects the layout from the manifest's
`@pnpm/exe.*` optional dependency, overlays the native binary itself, and
writes a shim by the target's kind rather than the manager's — and a
runner whose cache still holds the placeholder entry is healed on the next
install, because a cache hit is checked for the placeholder and reinstalled
over rather than trusted.[^installer] A runner provisioned by something
else that skips lifecycle scripts still hits the trap; the tell is always
the quoted comment line at `:1`.

See [`actions-storage`](../interfaces/actions-storage.md) for the
provisioning contract and
[the support policy](../conventions/package-manager-support-policy.md) for
which layouts the installer is expected to know.

[^pnpm-exe]: `internal/pnpmExe.ts` — the module comment describing the
    wrapper, the placeholder and the `@pnpm/exe.*` overlay.
[^installer]: `PackageManagerInstaller.ts` — `overlayNativeBinary`, the
    shim body `posixShim` chooses by `isNodeScript`, and the `isPlaceholder`
    cache-hit check that reinstalls over a stale entry.

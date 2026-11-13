---
id: "0018"
title: "@effected/github-actions: package-manager provisioning supports pnpm 12 only and drops yarn"
kind: breaking
shows: behavioural
applies:
  "@effected/github-actions": ">=0.34.0"
detect: ["PackageManagerInstaller", "yarn@", "pnpm@11"]
changesets: ["github-actions-pnpm-12-only"]
---

`PackageManagerInstaller` provisions npm, pnpm 12 and bun. A pnpm 11 pin installs a layout the installer refuses as `layoutUnexpected`, and a `yarn@…` pin has no provisioning path. Nothing fails to compile: the refusal happens when the action runs.

Where a hit provisions a package manager, check the `packageManager` pins and workflow inputs the action is given: move a pnpm 11 pin to pnpm 12, and remove yarn. Where your action serves repositories you do not control, report the refusal to the user rather than falling back. Check against the installed `.d.ts`, and run the action's tests with a pnpm 12 pin.

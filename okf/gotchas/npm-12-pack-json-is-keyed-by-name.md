---
type: Gotcha
title: npm 12's pack --json is an object keyed by name, not an array
description: A PackagePublish.pack or dryRun that fails with PublishError kind "output" on a runner whose npm is 12.x, after working for months, is not corrupt npm output — npm 12 changed `pack --json` from an array of entries to an object keyed by package name, and any decoder written against the npm 11 array rejects every npm 12 answer as unreadable.
status: stable
resource: ../../packages/npm/src/PackagePublish.ts
stale_after: 2027-03-18T00:00:00Z
tags:
  - compat
  - release
sources:
  - id: publish
    resource: ../../packages/npm/src/PackagePublish.ts
  - id: npm-pack
    resource: https://github.com/npm/cli/blob/v12.0.2/lib/commands/pack.js
  - id: npm-12-notes
    resource: https://github.com/npm/cli/releases/tag/v12.0.0
generated:
  by: "okfit/claude-code"
  at: 2026-09-19T02:46:28Z
  body_sha256: 7ba215d12f3da92c3ca5f77b61b220b26754fa650aadf08b4de6fbac52005fd0
---

# npm 12's pack --json is an object keyed by name, not an array

## What a reader sees

`PackagePublish.pack` (or `dryRun`) fails with a `PublishError` whose
`kind` is `output` — "npm's output could not be read" — although `npm pack`
exited 0 and wrote the tarball. It reproduces on every package, on a runner
or workstation whose `npm --version` is `12.x`, and the same code passes on
a machine still running npm 11.

## What they wrongly conclude

That npm printed something unparseable (a stray notice on stdout, a broken
JSON mode), or that the package itself is malformed, and go looking in the
package or in npm's log for the corruption. There is none.

## What is actually true

npm 12.0.0 made `npm pack --json` print the shape `npm publish --json`
already had: an object keyed by the packed package's name. On npm 11 only
`pack` printed an array — `publish --json` was keyed by name there too —
so the breaking change listed in 12.0.0's notes as "the --json output of
npm pack and npm publish have changed" is, for a `pack` consumer, `pack`
moving to match `publish`.[^npm-pack][^npm-12-notes]

The mechanism is one line in npm's `pack` command handing the tarball
logger the package `name` as the key where 11 handed it the array index,
plus npm's JSON output merging each `{ [key]: tarball }` item into an array
only when every key is positional (`lib/utils/display.js`,
`getArrayOrObject`). Name keys fail that test, hence the object — a package
literally named `0` would still merge to an array on npm 12, which is one
more reason to accept both containers rather than switch on the major.

```json
// npm 11.19.1
[ { "id": "pkg@1.1.0", "name": "pkg", "filename": "pkg-1.1.0.tgz", ... } ]
// npm 12.0.2
{ "pkg": { "id": "pkg@1.1.0", "name": "pkg", "filename": "pkg-1.1.0.tgz", ... } }
```

The entry itself is unchanged — `name`, `version`, `filename`, `integrity`,
`size`, `unpackedSize`, `entryCount` all carry the same values — so a
decoder that reaches the entry reads it identically; only the container
moved. `@effected/npm`'s `PackJson` codec accepts both containers from the
release carrying the npm 12 support work, per
[the support policy](../conventions/package-manager-support-policy.md)
(npm 11 and 12 are both in the window, so both shapes are
contractual).[^publish] A consumer decoding `pack --json` on its own, or
pinned to an older `@effected/npm`, hits this the day its runner's npm
moves to 12.

`npm view --json` moved in the same release (it now always answers an
array); the kit shells no `npm view` — `NpmRegistry` replaced it with
direct registry calls — so nothing here reads that output.

[^publish]: `PackagePublish.ts` — `PackJson` and `parsePackJson`, which
    take the first entry of either container.
[^npm-pack]: `lib/commands/pack.js` at v12.0.2 — `logTar(tar, { ..., key: tar.name })`;
    at v11.19.1 the key was the array index, while `publish.js` passed
    `key: pkgContents.name` on both majors.
[^npm-12-notes]: The v12.0.0 release notes, "⚠️ BREAKING CHANGES".

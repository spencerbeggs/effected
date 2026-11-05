# Fixture: heading slugs

`slugs.json` is the oracle for `MarkdownDocument.slug` and
`MarkdownDocument.headingSlugs`. It holds two tables:

- `slugs` — `{ input, slug }` pairs for the undeduplicated primitive.
- `sequences` — `{ inputs, slugs }` runs through one `GithubSlugger`
  instance, pinning the duplicate rule (`dup, dup, dup-1, dup` gives
  `dup, dup-1, dup-1-1, dup-2`).

## Producer

[`github-slugger@2.0.0`](https://github.com/Flet/github-slugger) (ISC), the
reference implementation most tooling ports. GitHub's own algorithm is not
public, so the fixture pins parity with `github-slugger`, not with GitHub.
`src/internal/slug.ts` vendors its `slug` function and character table; both
files were byte-compared against the 2.0.0 tarball.

## Hand-authored inputs

The inputs are hand-chosen; the outputs are never hand-written. Each input
exists to pin one property: `a & b` (no collapsing of the doubled hyphen),
`foo_bar` (underscore kept), ` spaced ` (no trim), `emoji 🎉 here` (symbol
dropped, spaces kept), `e` plus U+0301 (combining mark kept), `2nd ¼ ²` (the
table drops characters `\p{N}` would keep), and `Ⓐ circled` (the table keeps
characters `\p{L}` would drop). A `\p` class differs from the table on
15,847 code points, which is why the table is vendored.

## Regenerate

Only to re-baseline against a newer `github-slugger`; update the version above
and `src/internal/slug.ts` together.

```bash
mkdir /tmp/gs && cd /tmp/gs && npm init -y && npm i github-slugger@2.0.0
cp <repo>/packages/markdown/__test__/fixtures/slugs/generate.mjs .
node generate.mjs <repo>/packages/markdown/__test__/fixtures/slugs/slugs.json
```

`generate.mjs` needs `"type": "module"` in the scratch `package.json`. The
package takes no dev dependency on `github-slugger`.

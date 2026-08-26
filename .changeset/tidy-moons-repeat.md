---
"@effected/pnpm-plugin-effect": patch
---

## Maintenance

`catalog:check` and `catalog:sync` now verify catalog **membership**, not only
the versions of packages the catalog already names.

The upgrade CLI they delegate to walks the catalog literal, so a publishable
package absent from it was invisible: `catalog:check` reported "Catalogs are in
sync" on a tree whose catalog was incomplete, and the only thing that noticed
was a test computing membership separately. `check` now exits non-zero and
`sync` refuses before writing, both naming the missing packages and how to add
them.

The membership test stays, pinning the same rule independently: the gate and
the test live in different TypeScript projects, so sharing one function would
mean widening a tsconfig to buy less than two independent checks already give.

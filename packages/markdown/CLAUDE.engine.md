# Engine and hardening — @effected/markdown

Child context file for the vendored parser engine, the cycle firewall and the
hardening posture. The rules live in the parent; this file is the detail.

**Parent:** [CLAUDE.md](./CLAUDE.md)

---

## Two-phase parse, dialect registries

The engine is a vendored, hardened port of **commonmark.js@0.31.2**
(BSD-2-Clause, attribution headers in every ported module), restructured as
**construct-per-module** under `src/internal/blocks/` (16 modules) and
`src/internal/inlines/` (12 modules), wired through **dialect-keyed registries**
(`blockRegistry.ts`, `inlineRegistry.ts`). This is micromark's decomposition
without its CPS machinery. **A dialect is a registry composition, nothing more** —
the acceptance test for the design is that a future `obsidian` dialect lands as
new construct modules with no public API change.

It runs CommonMark's own two-phase strategy: a **block pass**
(`blockParser.ts`) consuming lines with lazy continuation to build the
container/leaf tree, then an **inline pass** (`inlineParser.ts`) running the
delimiter-stack algorithm over each leaf. Two constructs are seams inside base
constructs rather than registry entries — footnote handling lives inside
close-bracket handling and the image opener
(`makeLinkCloseConstruct`/`makeImageOpenConstruct`, swapped into the gfm table);
the commonmark dialect takes the no-seam defaults and is byte-for-byte unchanged.

**The inline pass builds a mutable linked list** of tokens (`inlineNode.ts`) and
materializes the immutable node Schema classes only once that list is final. The
array form would reintroduce the quadratic behavior the delimiter stack exists to
prevent.

`internal/entityMap.ts` is **generated** by `__test__/tools/generate-entities.ts`
from `entities@6.0.1` (a devDependency, MIT, data attributed).

## Cycle firewall

`noImportCycles` is error-level, held by the house rule: `src/internal/` throws
**raw carriers** (`internal/carriers.ts`) and **never imports a public module**.
The facade (`Markdown.ts`, `MarkdownDocument.ts`, `MarkdownFormat.ts`,
`MarkdownVisitor.ts`) catches those throws and materializes `MarkdownDiagnostic`
(deriving `line`/`character` from `offset`) plus the tagged `MarkdownParseError` /
`MarkdownStringifyError` / `MarkdownModificationError`. `internal/limits.ts` is
the zero-dependency leaf every guard imports.

Defect passthrough is proven, not assumed: non-carrier errors rethrow at every
facade `catch`, so a genuine programmer-error defect never gets laundered into a
typed error channel.

## Hardening inventory

`MAX_NESTING_DEPTH = 256` (`internal/limits.ts`, the cross-package parity
constant) guards every **recursive** surface, enumerated: container nesting in the
block pass, the delimiter/bracket stacks in the inline pass, stringify recursion,
and the visitor walk. Footnote definitions are containers sharing the container
counter, so definition-in-definition recursion is pinned.

**Iterative surfaces are deliberately unguarded** — the toml lesson: know what NOT
to guard. A 5000-sibling document is fine; there is no stack to blow.

- **The calibrated pathological suite** (`__test__/e2e/support/pathological/`, 21
  cases from cmark's `pathological_tests.py`) is the **linear-time guarantee**:
  markdown's DoS vector is quadratic emphasis/link blowup, defeated by the
  delimiter stack. Three of the 21 are deep-nesting cases the depth guard
  correctly refuses — a `GUARD_REFUSED` set pins that posture; they are not
  failures. Budgets are **calibrated against a same-code-path baseline**, not raw
  milliseconds, because v8 coverage instrumentation costs a measured ~3x on the
  materialization-heavy path the calibration now rides (and up to ~18x on tight
  engine loops); an algorithmic regression still fails, because quadratic outruns
  any constant factor. The suite also carries a **ratio-based linearity guard**
  for the destination-scan cap, which is instrumentation-immune where a budget is
  not.
- **The bare link-destination scan is capped at 32 open parens**
  (`MAX_LINK_DESTINATION_PARENS`, `references.ts`) — cmark's
  `MAX_LINK_DEST_PARENS`, sanctioned by the spec's "implementations may impose
  limits on parentheses nesting" clause. Without it the scan is the engine's one
  quadratic (`"[a](b".repeat(n)`: every failed inline-link attempt re-scans to end
  of subject). commonmark.js@0.31.2 has no cap and shares the quadratic, so the
  differential oracle never exercises the bound; the boundary (32 parses, 33 stays
  literal) is pinned in `inline-pass.test.ts`.
- **The reference map is keyed through a real `Map`** — link labels are
  attacker-controlled, so this is the prototype-pollution guard.
- **Parse is near-total.** CommonMark has no syntax errors — every string is a
  valid document. The `E` channel carries **only hardening-guard failures**, so
  there is no "malformed markdown" to report. `MarkdownDocument.diagnostics` is
  real plumbing for warnings with few producers yet — expected, not an omission.

## Schema construction cost

~15.8µs per node (measured, closed, accepted): a ~50k-node document pays roughly
a second, and `MakeOptions.disableChecks` does not help — the cost is
`struct.make` field processing. What is NOT accepted is paying it repeatedly:
`make` re-runs construction on every element of a **class-typed** children field,
so the `children` of `Table`, `TableRow` and `List` point at the real one-member
category unions (`TableContent`/`RowContent`/`ListContent`), which pass
already-constructed instances through **by identity** (pinned in `node.test.ts`;
the pathological "tables" case dropped 7.4s → 2.8s). See `RowContent`'s doc
comment. `stringify` is 0.16µs/node and `Mdast.toMdast` 0.06µs/node;
`Mdast.fromMdastResult` pays ~12.6µs/node because it **is** the checked admission
boundary. Hot-path consumers keep trees in package types or project out via
`toMdast`.

---

**Related context:** [CLAUDE.deviations.md](./CLAUDE.deviations.md) for the node
shape the engine produces; [CLAUDE.testing.md](./CLAUDE.testing.md) for the
corpora that hold it.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the package overview.*

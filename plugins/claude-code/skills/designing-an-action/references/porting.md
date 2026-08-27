# Porting an existing action

The mechanics specific to rebuilding or porting an action onto `@effected` rather than starting one from nothing: freezing what "parity" means, tracking what you don't yet know, and treating the legacy codebase as evidence rather than as a dependency. This is the one place in the suite that discusses a legacy codebase at all — and only the one being ported, never this kit's own history.

## Freeze the parity contract numerically

State the interface you are matching as a count plus a frozen artifact: the number of inputs, the number of outputs, a byte-compatible metadata file. A number and a frozen file let every later reviewer cross-check names mechanically instead of trusting prose. For a greenfield build with no legacy interface, freeze the inventory you just designed instead — the point is that every later phase and every later review compares against one fixed artifact, not a moving description.

## Track every uncertainty as a known unknown with a verification obligation

An uncertainty is not a design decision waiting to be made — it's a fact waiting to be checked, and it becomes a numbered entry with a specific verification obligation against the evidence source the claim actually has:

- A claim about an installed package's API is settled by its shipped type declarations, cited precisely.
- A claim about the action's own metadata is settled by the frozen metadata file.
- A claim about runner behavior is settled by upstream documentation, source, or a live probe.
- A claim about what the legacy code actually did is settled by the legacy code itself, treated as a behavioral oracle.

No upstream ask and no design commitment happens until the unknown is checked against its real source. Expect most known unknowns to dissolve on verification — the ones that survive checking are the real, narrow asks worth raising.

## Persist an API dossier before any implementation work starts

Before writing a skeleton against a package you're porting onto, produce a signature-level dossier: read the installed type declarations and real call sites, and record a verdict per known unknown (verified, refuted, or partial) with a precise citation for each. Persist this as a file rather than carrying it in one session's context — an implementer working on one piece of the build cannot see the research that produced another piece's contract, and a persisted dossier is what stops the same API surface from being re-derived, or hallucinated, more than once. If no way exists to delegate this research to a separate pass, do the same research inline and persist the same file anyway — the delivery mechanism is optional, the persisted artifact is not.

## The legacy implementation is an oracle, never a dependency

A ported action's previous implementation earns exactly one role: a behavioral reference consulted while writing a new implementation's tests. Stash it verbatim, exclude it from every tool that would otherwise lint, type-check, or bundle it, and never import from it. Derive each step's requirement channel from what the legacy oracle's code path actually touches — never from intuition about what a step "should" need. When two implementation strategies for a step are both still live candidates, declare the union of both their requirements in the contract, so a later choice between them doesn't require reopening it. A requirement channel that's too narrow is a breaking change the moment the real implementation needs the missing service; one that's too wide costs only what it honestly costs — every caller keeps providing services it may not need yet. The narrow failure is the expensive one, so widen the contract rather than guess tightly — but treat that as a real cost to weigh, not a free default.

## Migrating test infrastructure: doubles before the runner conversion

When filling in a ported step also means moving its test suite onto new test-runtime infrastructure, port that step's test doubles *before* converting the harness itself. Converting the test runner first changes ambient time-and-scheduling behavior across the whole suite in one move, so any code still holding an old assumption about real time fails in a way that names nothing useful — a timeout with no informative message, at the point furthest from its cause. The suite mid-conversion is the safety net the whole port depends on staying intact; changing the net and the thing it catches in the same step defeats the net.

# The two carve-outs from buy-in

The design summary is **never** waived. What bends is step 4 — *who* you wait
for, and how heavy the summary has to be.

## You are a delegated subagent — emit the summary, then proceed

If you are running as a headless subagent, **you have no user to wait on.** A
delegating parent dispatched you with instructions and is not watching the
channel; "present the summary and wait for buy-in" would deadlock, and the usual
failure is an agent that resolves the deadlock by quietly skipping the summary
altogether — losing the audit *and* the buy-in.

So: **emit the design summary, treat the parent's instructions as the buy-in, and
proceed.** The summary is not wasted — it goes in your report, where it is exactly
what lets the parent (and the reviewer on the PR) check the pillars were walked.
What you still owe splits by the *kind* of surprise the summary turns up:

- A decision that **contradicts** the instructions — a scope change, a design you
  were steered away from, a risk you cannot resolve — is a **stop**: do not
  proceed on your own authority; report back and ask.
- A decision that **exceeds** the instructions **without contradicting** them —
  the instructed thing, done correctly, carries a consequence nobody named — is
  **proceed AND flag**, not stop. Making an instructed `workspaceRoot` field
  *required* is the correct design and *also* breaks decode for previously
  serialized values: you were told to add the field, not to avoid the break, so
  proceeding is right — but the break MUST land prominently in your report, never
  silently. Do the correct thing and surface what it cost.
- Evidence of a **concurrent writer in your assigned files** is a **stop**, and it
  is neither of the two above — a *state* problem, not a design one. The
  signatures: an edit you did not make appears between your read and your write;
  a declaration you did not author (caught as `noRedeclare`); an Edit answered
  "file changed since read" with your intended change *already applied*. That
  last one reads like a harness quirk and is not — it is the collision signature.
  Stop writing immediately and report to your coordinator, because the reconcile
  cost grows with every further edit, and `git status` will NOT show you the
  other writer (uncommitted trees look identical whoever wrote them). An agent
  that stops early reconciles cleanly; one that keeps writing reconciles by hand.

Put any genuinely unresolved item in the Open risks row rather than deciding it
silently.

An interactive session has a real user: wait for them.

## Small pure-tier bugfix — a one-line summary is the whole recipe

A bounded fix to an **existing pure-tier engine** (a perf fix, an off-by-one, a
bad span offset) does not need the brownfield gap table. It has no service, no
layer, no observability posture, and its testability is already settled by the
existing suite; the table's rows would all read "n/a — unchanged".

Qualifying is narrow. **All four** must hold: pure-tier; the fix is behaviour-
preserving except for the bug itself; **no public API change**; and no new error
case. Miss any one and you run the full brownfield audit — a bugfix that changes a
signature or adds an error *is* a design change wearing a bugfix's clothes.

When it qualifies, the summary collapses to one line, and you still emit it:

```text
## Fix: <bug> — pure-tier, no API change, no new error. Test: <the test that now fails>.
```

That last clause is the load-bearing one. The test that reproduces the bug *is*
the design review for a fix this size: if you cannot name it, you do not
understand the bug yet, and the fast path is not available to you.

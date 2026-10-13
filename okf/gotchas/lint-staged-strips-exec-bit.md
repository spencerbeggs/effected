---
type: Gotcha
title: lint-staged normalizes every committed shell script back to 644
description: A shell script's executable bit flipping from 755 to 644 in a commit diff is the lint-staged shell-script handler working as designed, not mode drift or accidental damage.
status: stable
resource: ../../lib/configs/lint-staged.config.ts
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
  - ci
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 50fdd6b4e8fe27f5
---

# lint-staged normalizes every committed shell script back to 644

## What a reader sees

A diff on a commit that touched a `.sh` file shows a mode change from
`100755` to `100644` — the file's executable bit was cleared — even though
the author `chmod +x`'d the script and ran it successfully before
committing. Every shell script tracked in this repository is, in fact,
committed at `100644`.

## What they wrongly conclude

That the executable bit was accidentally lost — by a careless `git add`, a
tool that mishandled file modes, or a merge — and needs to be restored and
re-committed, or flagged as an unreviewed regression in a pull request.

## What is actually true

`lib/configs/lint-staged.config.ts` configures the silk preset's shell-script
handler to run `chmod -x` on every staged `.sh` file as part of the
pre-commit pipeline, with `.claude/scripts/` as the sole excepted directory.
This is deliberate: every shell script in this repository — plugin hooks,
the bats runner, and the rest — is invoked as `bash <script>` rather than
executed directly, so nothing at runtime needs the executable bit at all.
Writing an executable script during development is fine, and running it
locally with `./script.sh` works exactly as expected before the commit;
lint-staged simply normalizes the committed mode back to 644 every time,
which is expected behavior on every single commit that touches a `.sh`
file, not something that happened only once.

## The check

Never "fix" a 755-to-644 mode flip in a diff, and never flag it in review
or file an issue about it. If a script genuinely needs to run standalone
again locally, `chmod +x` it again — the next commit will simply normalize
it back to 644, and that repeated flip is the steady-state behavior, not a
bug converging toward a wrong state.

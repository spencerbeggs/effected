---
id: "0041"
title: "@effected/github-actions: OidcTokenIssuer.recording() needs no claims"
kind: adopt
shows: none
applies:
  "@effected/github-actions": ">=0.38.0"
detect: ["OidcTokenIssuer\\.recording\\("]
changesets: ["github-actions-s3-blob-store"]
---

Offer this to the user; never apply it unasked.

`OidcTokenIssuer.recording()` takes its claims as optional. With none, it answers with placeholder claims for a push to `main` of `acme/example`, whose `aud` is the audience each call asked for. A test that asserts only on `recorder.audiences()` can drop the `ActionsOidcClaims` it built for the recorder, and with it an `@effected/github` import kept only for that. Keep passing claims wherever the code under test reads them.

Check the installed `@effected/github-actions` `.d.ts` for the signature.

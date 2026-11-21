---
id: "0037"
title: "@effected/github: ActionsOidcClaims requires refProtected, refType, baseRef and headRef"
kind: breaking
shows: typed
applies:
  "@effected/github": ">=0.34.0"
detect: ["ActionsOidcClaims\\.make", "new ActionsOidcClaims\\(", "ActionsOidcClaimsFromWire", "ActionsOidc\\.verify"]
closes: ["spencerbeggs/effected#1385"]
changesets: ["actions-oidc-ref-claims"]
---

`ActionsOidcClaims` now carries four more claims of a GitHub Actions OIDC token, and all four are required: `refProtected` (a boolean, from the wire's `ref_protected` string `"true"` or `"false"`), `refType` (`"branch"` or `"tag"`), and `baseRef` and `headRef` (a pull request's refs, empty strings outside one). A token without `ref_protected`, or with any other value in it, now fails `ActionsOidc.verify` as `claims` instead of verifying.

- **Where a hit builds claims by hand**, usually a test double passed to `ActionsOidcClaims.make` (or `new ActionsOidcClaims`), add the four fields: `refProtected: true`, `refType: "branch"`, `baseRef: ""` and `headRef: ""` describe a push to a protected branch. The compiler finds each site.
- **Where a hit decodes a hand-built wire payload through `ActionsOidcClaimsFromWire`**, add `ref_protected`, `ref_type`, `base_ref` and `head_ref` to the payload, `ref_protected` as a string. This one surfaces as a decode failure in a test, not a type error. A payload from `ActionsOidc.testClaims` already carries them.
- **Where a hit calls `ActionsOidc.verify`**, nothing changes for a real runner token, which carries all four claims, but a test that signs a hand-built payload must add them as above. If the service authorizes a privileged action on the run's ref (writing a shared build cache, deploying), consider requiring `claims.refProtected` **in addition to** its existing ref policy, never in place of it: a protected tag and every other protected branch carry `refProtected: true` too, so keep the `claims.ref` allowlist and check `claims.refType === "branch"` where only branches qualify.

Check the installed `@effected/github` `.d.ts` for the field types. Verify with the typecheck and the test suite.

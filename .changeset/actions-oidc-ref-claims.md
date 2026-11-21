---
"@effected/github": minor
---

## Features

* `ActionsOidcClaims` carries `refProtected`, `refType`, `baseRef` and `headRef`, from the token's `ref_protected`, `ref_type`, `base_ref` and `head_ref` claims, so a service verifying an Actions OIDC token through `ActionsOidc.verify` can tell a protected-branch run from every other run
* `refProtected` is a boolean decoded from the wire's `"true"` or `"false"`; any other value, or a missing claim, fails verification as `claims` rather than defaulting
* `refType` is `"branch"` or `"tag"`; `baseRef` and `headRef` are a pull request's refs and empty strings outside pull request events
* `ActionsOidc.testClaims` includes the four claims as a push to a protected `main` carries them

## Breaking Changes

* The four fields are required, so an `ActionsOidcClaims` built by hand, such as a test double passed to `ActionsOidcClaims.make`, must supply them, and a payload decoded through `ActionsOidcClaimsFromWire` must carry their snake_case keys

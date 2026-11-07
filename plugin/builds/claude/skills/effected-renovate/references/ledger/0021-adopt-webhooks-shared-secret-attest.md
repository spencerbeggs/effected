---
id: "0021"
title: "@effected/webhooks: SharedSecret.attest and verifyAttested re-verify archived deliveries, under their own prefix"
kind: adopt
shows: none
applies:
  "@effected/webhooks": ">=0.5.0"
detect: ["attestation\\.v[0-9]"]
closes: ["spencerbeggs/effected#1213"]
---

Offer this to the user; never apply it unasked. It replaces a hand-rolled proof for a shared-secret vendor whose raw deliveries are archived and replayed: the vendor's header is the route secret itself, so the archive cannot keep it.

- **`SharedSecret.attest(request, { context })`** mints the lower-case hex HMAC-SHA256 to archive in place of the secret header.
- **`SharedSecret.verifyAttested(request, { header, attestation, context })`** decides by the live secret when `header` is given and present with a non-empty value. Otherwise it checks the attestation in the `attestation` header, in constant time.
- Both need `Mac.Mac` in `R`. A `context` part that is empty or contains `.` fails with `AttestationContextError`.

**Attestations already archived will not verify.** The signed prefix is `effected-attestation.v1.<count>.<part>.<part>.`, which differs in its tag and in the count from a local scheme such as `intake-attestation.v1.<vendor>.<environment>.`. No `context` value can reproduce another prefix. Tell the user this when offering it, and let them choose:

- keep the old verifier for deliveries archived before the switch, and use the new pair for new ones; or
- re-attest the archive, which needs each delivery's body and the route secret that signed it.

Test a replay of a delivery archived under the old scheme before removing the old verifier. Read the installed `.d.ts` for the exact shapes.

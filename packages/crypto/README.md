# @effected/crypto

HMAC, constant-time comparison and AWS SigV4 request signing over WebCrypto for Effect v4, safe for Workers.

`Fingerprint.of(value)` gives a stable SHA-256 fingerprint of a JSON-shaped value (keys sorted at every depth, array order kept, `undefined` members dropped), and `Fingerprint.decide({ applied, live, desired })` turns three fingerprints into an `Apply`, `Unchanged` or `Drift` decision for reconciling declared config against a remote.

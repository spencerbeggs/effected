# Test fixtures

## `rfc4231.json`

The seven HMAC-SHA-256 and HMAC-SHA-512 test cases of RFC 4231, "Identifiers and Test Vectors for HMAC-SHA-224, HMAC-SHA-256, HMAC-SHA-384, and HMAC-SHA-512", section 4. Machine-extracted from the RFC text, not hand-typed; SHA-224 and SHA-384 are dropped because the package implements neither.

- **Source:** `https://www.rfc-editor.org/rfc/rfc4231.txt` (SHA-256 of the file: `72178527ce93500e730bc8eb182b857e583096d652b64ece0879c52ba1df973b`)
- **Captured:** 2026-10-22
- **Tool:** curl 8.7.1 (macOS), then a throwaway Python 3 script that read sections 4.2 to 4.8. For each test case it joined the wrapped hex lines of `Key`, `Data`, `HMAC-SHA-256` and `HMAC-SHA-512`, skipping page headers and footers. The script is not committed: the RFC is immutable, so the fixture never needs refreshing.
- **Checks:** every extracted key and data length matches the byte count the RFC prints beside it (20, 4, 20, 25, 20, 131 and 131 key bytes). Every MAC is 32 or 64 bytes, except case 5.

Each entry is `{ case, key, data, sha256, sha512 }`, all lower-case hex. Case 5 also carries `truncatedBytes: 16`, because the RFC publishes only the first 128 bits of that MAC (it is the truncation test). A test compares only that prefix.

**What it pins:** that `Hmac.sign` computes RFC 2104 HMAC correctly for both algorithms. That includes a key longer than the hash block size (cases 6 and 7), which HMAC hashes first. The base64, base64url and hex encodings of each MAC are derived in the test from these hex values with Node's `Buffer`, an oracle independent of the `effect/encoding` modules the package uses.

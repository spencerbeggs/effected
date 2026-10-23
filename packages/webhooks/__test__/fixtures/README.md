# Test fixtures

## `vectors.json`

Eight known-answer deliveries, one or more per signed preset. Each one must verify, and each is signed by an oracle independent of this package. Machine-generated, not hand-authored.

- **Producer:** `generate-vectors.ts` beside this file. It calls:
  - `svix@2.8.0` `Webhook.sign`, for three of the Standard Webhooks vectors;
  - `stripe@23.0.0` `Stripe.webhooks.generateTestHeaderString`, for Stripe;
  - Node's `node:crypto` `createHmac` (Node 26.12.1), for the rest.
- **Command:** `node __test__/fixtures/generate-vectors.ts`, from the package root. Node runs the TypeScript directly.
- **Inputs:**
  - The secrets are throwaway test values, defined in the generator.
  - The bodies are small JSON documents, plus one that is not valid UTF-8 (a lone `0xE9`).
  - Every delivery is signed at, and received at, 2026-10-19T12:00:00Z.
- **Shape:** each entry is `{ preset, name, oracle, secret, headers, body, receivedAt }`. `body` is base64, so the non-UTF-8 byte survives JSON. `receivedAt` is epoch milliseconds.

**Why one Standard Webhooks vector uses `node:crypto`, not `svix`:** the non-UTF-8 body. `standardwebhooks`, which `svix` wraps, calls `payload.toString()` on a `Buffer` before signing, which turns `0xE9` into U+FFFD. It can therefore only sign the UTF-8 decoding of a body, never its raw bytes. A sender signs the bytes it sends, so the raw-bytes vector is signed with `node:crypto` over `${id}.${timestamp}.` followed by the bytes.

**What it pins:** that every preset verifies a signature produced by the vendor's own library, or by the vendor's documented algorithm when there is no library to call. This includes the `svix-*` and `webhook-*` header families and a rotation list (an old key, a `v1a` entry, then the match). `vectors.test.ts` asserts two more things:

- the committed file is exactly what the generator produces, so a change in either oracle library shows up as a diff;
- flipping any one body byte turns every vector into `bad_signature`.

**Refreshing:** re-run the command. Expect a diff only if an oracle library changes how it signs, which is exactly what the pin exists to surface.

## `generate-vectors.ts`

The generator above. It is also imported by the tests for its shared test secrets and arrival time, so the suites and the file cannot drift apart.

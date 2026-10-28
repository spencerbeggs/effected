---
type: Interface
title: "@effected/github GraphQL"
description: Typed GraphQL documents over the same client, errors and spans as REST.
status: stable
kind: api
resource: ../../packages/github/src/GraphQL.ts
tags: [bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-10-28T18:21:14Z
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:30.132Z
  - by: human:spencer
    at: 2026-10-13T21:42:59Z
integrity:
  generated:
    body: 2ba15917b8832320
  verified:
    by: human:spencer
    at: 2026-10-13T21:42:59Z
    content: 8c183d6fdb88b092
---

# @effected/github GraphQL

GraphQL is the package's second transport: a `GraphQLDocument`
(`packages/github/src/GraphQL.ts`) carrying a name, the document text and a
response schema, executed through the same client, the same
[error taxonomy](github-errors-and-retry.md) and the same span conventions
as a REST call. There is no separate GraphQL service. Package-wide framing
is in [the `github` module](../modules/github.md).

What differs from [the REST surface](github-rest-client.md) is ownership:
REST routes come from a generated map describing all of GitHub, while every
GraphQL document here is one the kit chose to write — see
[the ownership limitation](../limitations/github-graphql-schema-not-owned.md).

## Typed documents, decoded responses

A document is built from a name, the document text and a response schema;
the variables type is stated separately, with an optional encoder onto the
wire object. The constructor is curried: TypeScript takes explicit type
arguments all-or-nothing, so a single call would force the caller to spell
out the decoded type too, and the encoder exists so the variables type is
genuinely load-bearing rather than structurally interchangeable. The client
encodes the variables, posts the document and decodes the response through
the schema, so a GraphQL result is a domain value rather than an `unknown`
the caller casts, and a decode failure becomes
[the decode kind](github-errors-and-retry.md#four-errors-and-classification-happens-once)
with the schema error carried structurally.

The name is not decoration: it names the span and the error's operation
field, rather than a literal `"graphql"` standing in for every call.

There is no separate GraphQL service. The only thing one could do beyond the
typed document is error shaping — parsing another error's message string
looking for an errors array — and with a typed error carrying that array
structurally there is nothing left for it to do.

## On the wire: `POST /graphql` with a `data` body

`client.graphql` does not call `octokit.graphql`. The transport
(`packages/github/src/internal/octokit.ts`) sends `POST /graphql` through
octokit's core `request`, with the whole body as
`data: { query, variables }` (`variables` omitted when there are none).
octokit's own `graphql` merges a call's variables into its request options
and reads `baseUrl`, `headers`, `request`, `mediaType` and `operationName`
off them as the request itself, so a variable named `baseUrl` sent the
authenticated call, token attached, to that host. Inside `data`, octokit
reads no key as a request option, so every variable name, `baseUrl` and
`query` included, reaches GitHub as a variable. No name is refused, because
variable names are the document's own namespace.

On GitHub Enterprise Server the REST root is `https://<host>/api/v3` and
GraphQL is served at `https://<host>/api/graphql`, so `<base>/graphql` would
miss it. A configured base ending in `/api/v3` is rewritten to `/api/graphql`,
the rewrite `@octokit/graphql` applied, and any other base keeps the route's
own `/graphql` under it. The endpoint is derived from the configured base
alone, so it never names another host.

GitHub answers a GraphQL failure with HTTP 200 and an `errors` array. The
transport throws that array with the response headers, which
`GitHubGraphQLError.fromThrowable` reads structurally, so a failure
classifies the same way it did through `@octokit/graphql`.

## Ownership: the mechanism is ours, the schema may not be

The rule that sorts documents between the kit and its consumers:

- **A document whose subject is a GitHub primitive this package already
  models is owned here** — linked issues, cross-reference timeline probes,
  creating a branch linked to an issue (which has no REST equivalent, and is
  the clearest case for owning a document at all), and enabling or disabling
  auto-merge behind
  [the resource method](github-resources.md#shapes-corrected-against-the-domain-rather-than-against-fixtures).
- **A document that merely happens to be spelled in GraphQL has no place
  here.** A consumer that does over GraphQL what a REST resource method
  already does reached for it only because it happened to hold a node id;
  the resource method is the answer.
- **A document whose subject is a domain no other consumer touches stays
  with that consumer.** Project boards are one repository's domain, not the
  kit's; that consumer constructs its own typed document value, gaining
  typed variables, a decoded response and the structural already-exists
  discriminant in place of a message sniff. The document type is the
  mechanism, owned here; a domain schema is content, owned by whoever has
  the domain.

Where two spellings of one owned document exist, the strict superset wins
and the resource method exposes its extra filter rather than shipping two
documents.

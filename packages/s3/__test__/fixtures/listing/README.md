# ListObjectsV2 listing corpus

Every file here is **hand-authored**. None was captured from a live store: the
suite runs with no network and no credentials, and a captured page would carry a
real account's bucket name, owner id and keys. Nothing was produced by a tool, so
there is no tool version to record and nothing to regenerate. Edit a fixture by
hand, and keep the property it pins.

`__test__/listing.test.ts` reads every file in this directory, first asserting
the count, and serves each one as the body of a `200` answer to `list`. Its table
names the outcome each file must produce. A file with no row fails the suite.

## Shaped like a real store (must succeed)

| File | Shaped after | Pins |
| --- | --- | --- |
| `aws-page.xml` | the ListObjectsV2 response example in the Amazon S3 API Reference: indented, namespaced, with `Owner`, `ChecksumAlgorithm`, `KeyCount` and `&quot;`-escaped ETags | unknown elements are ignored; whitespace between elements is not content; ETags keep their quotes; `StorageClass` is read |
| `r2-truncated.xml` | a Cloudflare R2 page: `IsTruncated` before `NextContinuationToken`, raw `"` in the ETag, no `Owner` | a truncated page reads its token; element order does not matter |
| `minio-prefixes.xml` | a MinIO page listed with `delimiter=/`: `&#34;` ETag, an empty `Prefix`, two `CommonPrefixes` | common prefixes are read and counted against `KeyCount` |
| `keycount-contents-only.xml` | a delimiter page from a store whose `KeyCount` counts `Contents` only: `KeyCount` 1 over one entry and one `CommonPrefixes` | a `KeyCount` that leaves out common prefixes is accepted, so a delimiter listing does not fail on a counting convention; no live store was observed doing this, the fixture covers the convention |
| `escaped-keys.xml` | keys S3 escapes in XML | the five predefined entities, decimal and hex character references (an astral one included), a CDATA section, and leading and trailing spaces in a key all survive exactly |
| `bom-declaration.xml` | a page with a UTF-8 byte order mark before the XML declaration | a BOM is skipped |

## Not a listing (must fail, never read as empty)

| File | Stands in for | Must be |
| --- | --- | --- |
| `error-on-200.xml` | an S3 `InternalError` document answered with status `200` | `S3RequestFailed`, status `200`, with the document's `Code` and `RequestId` |
| `html-proxy-page.html` | an nginx `502` page a proxy answered with status `200`; not well-formed XML | `S3MalformedResponse`, with the decoder's error as `cause` |
| `xhtml-page.html` | a well-formed XHTML maintenance page | `S3MalformedResponse` naming the root `<html>` |
| `wrong-root.xml` | a `ListAllMyBucketsResult`, the answer to a request sent to the service root | `S3MalformedResponse` naming the root |
| `empty.xml` | an empty `200` body | `S3MalformedResponse`, `an empty body` |
| `whitespace-only.xml` | a body of blank lines | `S3MalformedResponse` |
| `two-roots.xml` | two concatenated pages | `S3MalformedResponse` |
| `unclosed.xml` | a page cut off mid-entry | `S3MalformedResponse` |
| `doctype-entity.xml` | an external-entity (XXE) attempt | `S3MalformedResponse`: core's decoder refuses the entity and reads nothing |
| `out-of-range-charref.xml` | a character reference past `U+10FFFF` | `S3MalformedResponse`, never a `RangeError` |
| `control-char-key.xml` | a raw `U+0001` in a key, which XML 1.0 cannot carry | `S3MalformedResponse`: the listing fails loudly rather than skipping the key |

## A listing whose meaning is broken (must fail)

Each of these is a `ListBucketResult` that a lenient reader would turn into fewer
keys or a stopped listing.

| File | Breach |
| --- | --- |
| `truncated-no-token.xml` | `IsTruncated` true with no `NextContinuationToken`: the consumer's second bug, a silently partial replay |
| `truncated-empty-token.xml` | the same with an empty token |
| `missing-istruncated.xml` | no `IsTruncated` at all |
| `bad-istruncated.xml` | `IsTruncated` is `yes` |
| `contents-without-key.xml` | a `Contents` with no `Key` |
| `empty-key.xml` | a `Contents` with an empty `Key` |
| `duplicate-key.xml` | a `Contents` with two `Key` elements |
| `key-holds-element.xml` | a `Key` holding an element instead of text |
| `fractional-size.xml` | `Size` is `12.5` |
| `negative-size.xml` | `Size` is `-1` |
| `missing-size.xml` | no `Size` |
| `bad-last-modified.xml` | `LastModified` is `1`, which `new Date` would read as the year 2001 |
| `calendar-overflow.xml` | `LastModified` is `2026-02-30T12:00:00Z`, which `DateTime.make` would roll over to 2 March |
| `keycount-mismatch.xml` | `KeyCount` 3 over two entries and no prefixes, matching neither count: a page cut short in transit |
| `prefix-without-prefix.xml` | a `CommonPrefixes` with no `Prefix` |

The nesting-depth case is generated in the test (`<a>` nested 40 deep) rather
than committed, since its only property is its depth.

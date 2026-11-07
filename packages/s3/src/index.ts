/**
 * A minimal S3-compatible object client: conditional put, get, head, delete and a
 * strict ListObjectsV2, signed with `@effected/crypto`'s SigV4 over core
 * `HttpClient`, `Digest` and `Mac`, with no `node:` import, so it runs on Workers.
 *
 * @packageDocumentation
 */

export type {
	S3ClientOptions,
	S3ClientShape,
	S3Credentials,
	S3GetOptions,
	S3ListAllOptions,
	S3ListOptions,
	S3PutOptions,
} from "./S3Client.js";
export { S3Client } from "./S3Client.js";
export type { S3DeleteError, S3Error, S3GetError, S3HeadError, S3ListError, S3PutError } from "./S3Error.js";
export {
	S3InvalidRequest,
	S3InvalidRequestReason,
	S3MalformedResponse,
	S3NotFound,
	S3NotModified,
	S3Operation,
	S3PreconditionFailed,
	S3RequestFailed,
	S3TransportError,
} from "./S3Error.js";
export { S3ListPage, S3ObjectSummary } from "./S3ListPage.js";
export { S3Object, S3ObjectHead, S3PutResult } from "./S3Object.js";

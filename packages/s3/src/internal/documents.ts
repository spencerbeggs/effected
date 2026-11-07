/**
 * Pure readers over a decoded XML tree: a `ListBucketResult` page and an
 * `<Error>` document. Strict on purpose: every element a page's meaning depends on
 * is required and checked, so a short or garbled answer fails rather than reading
 * as fewer keys.
 *
 * @internal
 */
import { Option, Result } from "effect";
import type { Xml } from "effect/encoding";
import { S3ListPage, S3ObjectSummary } from "../S3ListPage.js";
import { parseIsoDateTime } from "./dates.js";

/**
 * What a reader expected and what it found, for `S3MalformedResponse`.
 *
 * @internal
 */
export interface Mismatch {
	readonly expected: string;
	readonly received: string;
}

/**
 * The fields an `<Error>` document carries.
 *
 * @internal
 */
export interface ErrorDocument {
	readonly code?: string;
	readonly message?: string;
	readonly requestId?: string;
}

const isElement = (child: Xml.Element | string): child is Xml.Element => typeof child !== "string";

const childrenNamed = (element: Xml.Element, name: string): ReadonlyArray<Xml.Element> =>
	element.children.filter((child): child is Xml.Element => isElement(child) && child.name === name);

/** The text of a leaf element; `undefined` when it holds an element. */
const leafText = (element: Xml.Element): string | undefined => {
	let text = "";
	for (const child of element.children) {
		if (isElement(child)) return undefined;
		text += child;
	}
	return text;
};

type Field = Result.Result<Option.Option<string>, Mismatch>;

/** At most one `<name>` leaf under `parent`, as its text. */
const optionalLeaf = (parent: Xml.Element, name: string, where: string): Field => {
	const found = childrenNamed(parent, name);
	if (found.length === 0) return Result.succeed(Option.none());
	const [only] = found;
	if (found.length > 1 || only === undefined) {
		return Result.fail({ expected: `one <${name}> in ${where}`, received: `${found.length}` });
	}
	const text = leafText(only);
	return text === undefined
		? Result.fail({ expected: `text in <${name}> in ${where}`, received: "an element" })
		: Result.succeed(Option.some(text));
};

/** Exactly one `<name>` leaf under `parent`, as its text. */
const requiredLeaf = (parent: Xml.Element, name: string, where: string): Result.Result<string, Mismatch> =>
	Result.flatMap(optionalLeaf(parent, name, where), (text) =>
		Option.isSome(text)
			? Result.succeed(text.value)
			: Result.fail({ expected: `a <${name}> in ${where}`, received: "none" }),
	);

const COUNT = /^\d+$/;

const count = (text: string, expected: string): Result.Result<number, Mismatch> => {
	const trimmed = text.trim();
	const value = COUNT.test(trimmed) ? Number(trimmed) : Number.NaN;
	return Number.isSafeInteger(value)
		? Result.succeed(value)
		: Result.fail({ expected, received: JSON.stringify(text) });
};

const summary = (entry: Xml.Element, index: number): Result.Result<S3ObjectSummary, Mismatch> => {
	const where = `<Contents> ${index + 1}`;
	return Result.gen(function* () {
		const key = yield* requiredLeaf(entry, "Key", where);
		if (key === "") return yield* Result.fail({ expected: `a non-empty <Key> in ${where}`, received: '""' });
		const size = yield* count(yield* requiredLeaf(entry, "Size", where), `a byte count in the <Size> of ${where}`);
		const modifiedText = (yield* requiredLeaf(entry, "LastModified", where)).trim();
		const lastModified = parseIsoDateTime(modifiedText);
		if (Option.isNone(lastModified)) {
			return yield* Result.fail({
				expected: `an ISO 8601 <LastModified> in ${where}`,
				received: JSON.stringify(modifiedText),
			});
		}
		const etag = yield* optionalLeaf(entry, "ETag", where);
		const storageClass = yield* optionalLeaf(entry, "StorageClass", where);
		return S3ObjectSummary.make({
			key,
			size,
			lastModified: lastModified.value,
			...(Option.isSome(etag) ? { etag: etag.value } : {}),
			...(Option.isSome(storageClass) ? { storageClass: storageClass.value.trim() } : {}),
		});
	});
};

/**
 * Read a `ListBucketResult` root as one page.
 *
 * @remarks
 * The root must be `ListBucketResult`; the caller routes an `<Error>` root first.
 * `IsTruncated` is required and is `true` or `false`; every `Contents` needs one
 * non-empty `Key`, an integer `Size` and an ISO 8601 `LastModified`; every
 * `CommonPrefixes` needs one `Prefix`; a truncated page needs a non-empty
 * `NextContinuationToken`, and a page that is not truncated has its token ignored;
 * a present `KeyCount` must equal the entries and prefixes read, or the entries
 * alone (a store that does not count prefixes). Unknown elements
 * are ignored. Key and prefix text is kept exactly, whitespace included; the
 * flags and numbers are trimmed.
 *
 * @internal
 */
export const readListPage = (root: Xml.Element): Result.Result<S3ListPage, Mismatch> =>
	Result.gen(function* () {
		if (root.name !== "ListBucketResult") {
			return yield* Result.fail({ expected: "a ListBucketResult document", received: `a root element <${root.name}>` });
		}
		const where = "<ListBucketResult>";
		const truncatedText = (yield* requiredLeaf(root, "IsTruncated", where)).trim();
		if (truncatedText !== "true" && truncatedText !== "false") {
			return yield* Result.fail({
				expected: "<IsTruncated> true or false",
				received: JSON.stringify(truncatedText),
			});
		}
		const isTruncated = truncatedText === "true";
		const keys: Array<S3ObjectSummary> = [];
		for (const [index, entry] of childrenNamed(root, "Contents").entries()) keys.push(yield* summary(entry, index));
		const commonPrefixes: Array<string> = [];
		for (const [index, entry] of childrenNamed(root, "CommonPrefixes").entries()) {
			commonPrefixes.push(yield* requiredLeaf(entry, "Prefix", `<CommonPrefixes> ${index + 1}`));
		}
		const token = yield* optionalLeaf(root, "NextContinuationToken", where);
		if (isTruncated && (Option.isNone(token) || token.value === "")) {
			// Stopping here would silently read part of the listing.
			return yield* Result.fail({
				expected: "a <NextContinuationToken> on a truncated page",
				received: Option.isNone(token) ? "none" : '""',
			});
		}
		const keyCount = yield* optionalLeaf(root, "KeyCount", where);
		if (Option.isSome(keyCount)) {
			const declared = yield* count(keyCount.value, "a count in <KeyCount>");
			// AWS and MinIO count common prefixes in `KeyCount`; a store that counts
			// `Contents` alone is accepted too, so a delimiter listing does not fail on
			// a counting convention. Either way a page that lost entries fails.
			if (declared !== keys.length + commonPrefixes.length && declared !== keys.length) {
				return yield* Result.fail({
					expected: `<KeyCount> ${declared}, counting <Contents> with or without <CommonPrefixes>`,
					received: `${keys.length} <Contents> and ${commonPrefixes.length} <CommonPrefixes>`,
				});
			}
		}
		return S3ListPage.make({
			keys,
			commonPrefixes,
			isTruncated,
			nextContinuationToken: isTruncated ? token : Option.none(),
		});
	});

/**
 * Read an `<Error>` root's `Code`, `Message` and `RequestId`, or `Option.none()`
 * for any other root.
 *
 * @remarks
 * Lenient where {@link readListPage} is strict: it only enriches a failure that is
 * already a failure, so a field that is missing, repeated or not text is left out
 * rather than failing.
 *
 * @internal
 */
export const readErrorDocument = (root: Xml.Element): Option.Option<ErrorDocument> => {
	if (root.name !== "Error") return Option.none();
	const field = (name: string): Option.Option<string> =>
		Result.getOrElse(optionalLeaf(root, name, "<Error>"), () => Option.none<string>()).pipe(
			Option.map((text) => text.trim()),
			Option.filter((text) => text !== ""),
		);
	const code = field("Code");
	const message = field("Message");
	const requestId = field("RequestId");
	return Option.some({
		...(Option.isSome(code) ? { code: code.value } : {}),
		...(Option.isSome(message) ? { message: message.value } : {}),
		...(Option.isSome(requestId) ? { requestId: requestId.value } : {}),
	});
};

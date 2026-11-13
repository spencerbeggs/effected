/**
 * Reads one entry out of a gzipped npm tarball in memory: inflate under a cap,
 * then walk the tar headers. Nothing touches a file system or a child process,
 * so it runs wherever `DecompressionStream` does (Node, Workers).
 *
 * @remarks
 * The archive is untrusted. Every length is bounded before it is used, a
 * malformed archive is a value (`Result.fail`), never a throw, and the
 * inflated size is capped while streaming, so a gzip bomb stops at the cap
 * rather than in memory.
 *
 * @internal
 */

import { Option, Result } from "effect";

/** Inflated bytes read at most: pnpm's `MAX_TARBALL_BYTES` (`crates/cli/src/cli_args/changelog.rs:45`). */
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

/** Why an archive could not be read. */
export type ArchiveFault = "inflate" | "oversize" | "malformed";

const BLOCK = 512;
const decoder = new TextDecoder();

const isGzip = (bytes: Uint8Array): boolean => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

/**
 * Inflate a gzip stream, reading at most `max` bytes out. A body that does not
 * start with the gzip magic is returned as it is: a tar registry serves a plain
 * tar, as pnpm's `extract_entry` accepts.
 *
 * Resolves to the bytes, or to the fault. Never rejects.
 */
export const gunzip = async (
	bytes: Uint8Array,
	max: number,
	signal?: AbortSignal,
): Promise<Result.Result<Uint8Array, ArchiveFault>> => {
	if (!isGzip(bytes)) return bytes.length > max ? Result.fail("oversize") : Result.succeed(bytes);
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	try {
		const source = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
		reader = source.getReader();
		const chunks: Array<Uint8Array> = [];
		let total = 0;
		for (;;) {
			if (signal?.aborted === true) return Result.fail("inflate");
			const { done, value } = await reader.read();
			if (done) break;
			total += value.length;
			if (total > max) {
				await reader.cancel().catch(() => undefined);
				return Result.fail("oversize");
			}
			chunks.push(value);
		}
		const out = new Uint8Array(total);
		let at = 0;
		for (const chunk of chunks) {
			out.set(chunk, at);
			at += chunk.length;
		}
		return Result.succeed(out);
	} catch {
		await reader?.cancel().catch(() => undefined);
		return Result.fail("inflate");
	}
};

/** The text of a header field, up to its first NUL. */
const field = (header: Uint8Array, start: number, length: number): string => {
	const slice = header.subarray(start, start + length);
	const nul = slice.indexOf(0);
	return decoder.decode(nul === -1 ? slice : slice.subarray(0, nul));
};

/** An octal size field, or `undefined` for a form this reader does not take (base-256, junk). */
const octal = (header: Uint8Array, start: number, length: number): number | undefined => {
	const text = field(header, start, length).trim();
	if (text === "") return 0;
	if (!/^[0-7]+$/.test(text)) return undefined;
	const value = Number.parseInt(text, 8);
	return Number.isSafeInteger(value) ? value : undefined;
};

/** The `path` record of a pax extended header, whose records read `<len> <key>=<value>\n`. */
const paxPath = (data: Uint8Array): string | undefined => {
	let at = 0;
	while (at < data.length) {
		const space = data.indexOf(0x20, at);
		if (space === -1) return undefined;
		const length = Number.parseInt(decoder.decode(data.subarray(at, space)), 10);
		if (!Number.isSafeInteger(length) || length <= space - at + 1 || at + length > data.length) return undefined;
		const record = decoder.decode(data.subarray(space + 1, at + length - 1));
		const equals = record.indexOf("=");
		if (equals !== -1 && record.slice(0, equals) === "path") return record.slice(equals + 1);
		at += length;
	}
	return undefined;
};

const isZeroBlock = (tar: Uint8Array, at: number): boolean => {
	for (let i = at; i < at + BLOCK; i++) if (tar[i] !== 0) return false;
	return true;
};

/**
 * The text of the regular file whose path is exactly `path`, or `None` when
 * the archive holds none. The comparison is exact and case-sensitive, as
 * pnpm's: `package/CHANGELOG.md` is not `package/changelog.md`.
 *
 * Fails `malformed` for a truncated entry or a size this reader cannot take.
 * Total: it reads inside the buffer and never throws.
 */
export const tarEntryText = (tar: Uint8Array, path: string): Result.Result<Option.Option<string>, ArchiveFault> => {
	let at = 0;
	let longName: string | undefined;
	let paxName: string | undefined;
	while (at + BLOCK <= tar.length) {
		if (isZeroBlock(tar, at)) return Result.succeed(Option.none());
		const header = tar.subarray(at, at + BLOCK);
		const size = octal(header, 124, 12);
		if (size === undefined) return Result.fail("malformed");
		const dataStart = at + BLOCK;
		if (dataStart + size > tar.length) return Result.fail("malformed");
		const data = tar.subarray(dataStart, dataStart + size);
		const next = dataStart + Math.ceil(size / BLOCK) * BLOCK;
		const type = String.fromCharCode(header[156] ?? 0);
		if (type === "L") {
			longName = field(data, 0, data.length);
		} else if (type === "x") {
			paxName = paxPath(data) ?? paxName;
		} else if (type !== "g") {
			let name = field(header, 0, 100);
			if (field(header, 257, 5) === "ustar") {
				const prefix = field(header, 345, 155);
				if (prefix !== "") name = `${prefix}/${name}`;
			}
			name = paxName ?? longName ?? name;
			longName = undefined;
			paxName = undefined;
			if (name === path && (type === "0" || type === "\0")) return Result.succeed(Option.some(decoder.decode(data)));
		}
		at = next;
	}
	return Result.succeed(Option.none());
};

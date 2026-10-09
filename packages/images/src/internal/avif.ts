import { Result } from "effect";
import { ascii, u32be } from "./bytes.js";
import type { Dimensions, ReadFailure, ReadResult } from "./result.js";
import { dimensions, malformed, truncated } from "./result.js";

/** Boxes the walk may visit before it gives up. Hostile input cannot loop past it. */
export const AVIF_BOX_BUDGET = 1024;

/** Brands scanned in the ftyp box, at most. */
const MAX_BRANDS = 64;

interface Box {
	readonly type: string;
	/** First payload byte. */
	readonly start: number;
	/** One past the last byte. */
	readonly end: number;
}

interface Budget {
	remaining: number;
}

type BoxResult = Result.Result<Box, ReadFailure>;

/** True when an ftyp box at offset 0 names `avif` or `avis` as its major or a compatible brand. */
export const isAvifBrand = (b: Uint8Array): boolean => {
	if (b.length < 12 || ascii(b, 4, 4) !== "ftyp") return false;
	const brand = (o: number) => ascii(b, o, 4);
	if (brand(8) === "avif" || brand(8) === "avis") return true;
	const end = Math.min(u32be(b, 0), b.length);
	for (let o = 16, n = 0; o + 4 <= end && n < MAX_BRANDS; o += 4, n++) {
		if (brand(o) === "avif" || brand(o) === "avis") return true;
	}
	return false;
};

/**
 * Only a top-level box can be cut short by the end of the bytes: below it the parent has already been
 * verified to end inside the buffer, so more bytes could never complete a child that overruns it.
 */
const readBox = (b: Uint8Array, offset: number, parentEnd: number, topLevel: boolean): BoxResult => {
	const short = topLevel ? truncated : malformed;
	if (offset + 8 > b.length) return short("ended inside a box header");
	let size = u32be(b, offset);
	const type = ascii(b, offset + 4, 4);
	let header = 8;
	if (size === 1) {
		if (offset + 16 > b.length) return short("ended inside a largesize header");
		if (u32be(b, offset + 8) !== 0) return malformed(`box ${JSON.stringify(type)} largesize exceeds 32 bits`);
		size = u32be(b, offset + 12);
		header = 16;
	} else if (size === 0) {
		size = parentEnd - offset;
	}
	if (size < header) return malformed(`box ${JSON.stringify(type)} size ${size} is below its header`);
	const end = offset + size;
	if (topLevel && end > b.length) return truncated(`box ${JSON.stringify(type)} runs past the end of the bytes`);
	if (end > parentEnd) return malformed(`box ${JSON.stringify(type)} overruns its parent`);
	return Result.succeed({ type, start: offset + header, end });
};

/** Every child box of [start, end), stopping early on failure. */
const children = (
	b: Uint8Array,
	start: number,
	end: number,
	budget: Budget,
): Result.Result<ReadonlyArray<Box>, ReadFailure> => {
	const out: Array<Box> = [];
	for (let offset = start; offset < end; ) {
		if (--budget.remaining < 0) return malformed("box walk exceeded its budget");
		const box = readBox(b, offset, end, false);
		if (Result.isFailure(box)) return Result.fail(box.failure);
		out.push(box.success);
		offset = box.success.end;
	}
	return Result.succeed(out);
};

/** Find the first child of type `type`; at top level its absence means the bytes ended early. */
const child = (
	b: Uint8Array,
	start: number,
	end: number,
	type: string,
	budget: Budget,
	topLevel: boolean,
): BoxResult => {
	for (let offset = start; offset < end; ) {
		if (--budget.remaining < 0) return malformed("box walk exceeded its budget");
		const box = readBox(b, offset, end, topLevel);
		if (Result.isFailure(box)) return Result.fail(box.failure);
		if (box.success.type === type) return box;
		offset = box.success.end;
	}
	return topLevel ? truncated(`ended before the ${type} box`) : malformed(`no ${type} box`);
};

export const readAvif = (b: Uint8Array): ReadResult => {
	const budget: Budget = { remaining: AVIF_BOX_BUDGET };
	const meta = child(b, 0, b.length, "meta", budget, true);
	if (Result.isFailure(meta)) return Result.fail(meta.failure);
	const metaChildren = meta.success.start + 4; // FullBox version/flags
	if (metaChildren > meta.success.end) return malformed("meta box is too short for its version and flags");
	const iprp = child(b, metaChildren, meta.success.end, "iprp", budget, false);
	if (Result.isFailure(iprp)) return Result.fail(iprp.failure);
	const ipco = child(b, iprp.success.start, iprp.success.end, "ipco", budget, false);
	if (Result.isFailure(ipco)) return Result.fail(ipco.failure);
	const properties = children(b, ipco.success.start, ipco.success.end, budget);
	if (Result.isFailure(properties)) return Result.fail(properties.failure);
	let best: Dimensions | undefined;
	for (const property of properties.success) {
		if (property.type !== "ispe") continue;
		if (property.end - property.start < 12) return malformed("ispe box is too short");
		const width = u32be(b, property.start + 4);
		const height = u32be(b, property.start + 8);
		if (best === undefined || width * height > best.width * best.height) best = { width, height };
	}
	return best === undefined ? malformed("no ispe property") : dimensions(best.width, best.height);
};

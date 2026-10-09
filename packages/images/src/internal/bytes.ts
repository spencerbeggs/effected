// Primitive readers. They do NOT bounds-check: every caller checks the length it needs first.

export const u16be = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];
export const u16le = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
export const u24le = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
export const u32be = (b: Uint8Array, o: number): number =>
	b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
export const u32le = (b: Uint8Array, o: number): number =>
	b[o + 3] * 0x1000000 + ((b[o + 2] << 16) | (b[o + 1] << 8) | b[o]);

export const ascii = (b: Uint8Array, o: number, length: number): string => {
	let out = "";
	for (let i = 0; i < length; i++) out += String.fromCharCode(b[o + i]);
	return out;
};

export const matches = (b: Uint8Array, o: number, signature: ReadonlyArray<number>): boolean =>
	b.length >= o + signature.length && signature.every((byte, i) => b[o + i] === byte);

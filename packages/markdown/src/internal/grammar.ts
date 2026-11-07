// The character-class grammar the spec's escape and entity rules share, as
// regex source strings.
//
// Leaf module: imports nothing. Kept apart from `unescape.ts` because the
// stringifier needs the entity GRAMMAR (to know what text would read as a
// character reference) but never the entity TABLE that decoding loads, and
// the `./stringify` entry point must not reach `entityMap.ts`.

/** The punctuation set a backslash may escape, per the spec. */
export const ESCAPABLE = "[!\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]";

/** One entity, in any of the three spec forms. */
export const ENTITY = "&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});";

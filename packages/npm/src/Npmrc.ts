import { Option, Schema } from "effect";

/** npm's `${VAR}` / `${VAR?}` expression, with backslash escapes (`@npmcli/config`'s `env-replace`). */
const ENV_EXPRESSION = /(?<!\\)(\\*)\$\{([^${}?]+)(\?)?\}/g;

/**
 * npm's env substitution: `${VAR}` is replaced, `${VAR?}` is replaced or
 * emptied, an unset `${VAR}` is left as written, and an odd run of
 * backslashes escapes the expression. Returns the unset variables too.
 */
const substitute = (
	text: string,
	env: Readonly<Record<string, string | undefined>>,
): { readonly value: string; readonly missing: ReadonlyArray<string> } => {
	const missing: Array<string> = [];
	const value = text.replace(ENV_EXPRESSION, (original, escapes: string, name: string, optional?: string) => {
		if (escapes.length % 2 === 1) return original.slice((escapes.length + 1) / 2);
		const found = Object.hasOwn(env, name) ? env[name] : undefined;
		if (found === undefined && optional !== "?") missing.push(name);
		return escapes.slice(escapes.length / 2) + (found ?? (optional === "?" ? "" : `\${${name}}`));
	});
	return { value, missing };
};

/** An unquoted ini value: stops at an unescaped `;` or `#`, as the `ini` package npm uses does. */
const unquoted = (raw: string): string => {
	let out = "";
	for (let index = 0; index < raw.length; index++) {
		const char = raw[index] as string;
		if (char === "\\" && index + 1 < raw.length && ";#\\".includes(raw[index + 1] as string)) {
			out += raw[index + 1];
			index++;
			continue;
		}
		if (char === ";" || char === "#") break;
		out += char;
	}
	return out.trim();
};

/** An ini value, quoted (`"…"` decoded as JSON where it can be, `'…'` stripped) or not. */
const iniValue = (raw: string): string => {
	const value = raw.trim();
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(value);
			if (typeof parsed === "string") return parsed;
		} catch {
			// Not valid JSON: fall through to stripping the quotes.
		}
		return value.slice(1, -1);
	}
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
	return unquoted(value);
};

/**
 * One setting read from an `.npmrc` text: its key, its value after `${VAR}`
 * expansion, and the variables the value named that the environment did not set.
 *
 * @remarks
 * `unset` lists each `${VAR}` (not `${VAR?}`) the environment lacked, in the
 * key and then the value, in order of appearance. Such an expression is left
 * in `key` or `value` exactly as written, as npm leaves it, so a caller that
 * must not act on a literal `${VAR}` (a credential check, say) tests
 * `unset.length > 0` rather than scanning the text.
 *
 * `array` marks a `key[]=v` line, the form npm uses for list settings such as
 * `ca[]`. Its `key` has the `[]` removed, as `ini` names it.
 *
 * @public
 */
export class NpmrcEntry extends Schema.Class<NpmrcEntry>("@effected/npm/NpmrcEntry")({
	/** The setting key; a `[section]` prefixes it with `section.`. */
	key: Schema.String,
	/** The value after quote decoding and `${VAR}` expansion. */
	value: Schema.String,
	/** Variables the key or the value named that the environment did not set. */
	unset: Schema.Array(Schema.String),
	/** `true` for an array setting (`key[]=v`); `key` is then written without the `[]`. */
	array: Schema.Boolean,
}) {}

/**
 * Parses one `.npmrc` text into its settings, in file order, expanding `${VAR}`
 * from `env`. A pure function: no IO, and no failure — a malformed line is
 * read the way the `ini` package npm uses reads it.
 *
 * @remarks
 * **`${ENV}` expansion** follows npm's `env-replace`, in keys and values:
 *
 * - `${VAR}` becomes the value of `VAR` in `env`;
 * - `${VAR?}` becomes the value of `VAR`, or the empty string when unset;
 * - an unset `${VAR}` is left as written and recorded in `NpmrcEntry.unset`;
 * - an odd run of backslashes before `${` escapes it: half the backslashes
 *   (rounded up) are dropped and the expression is left unexpanded.
 *
 * An `env` entry counts only as an own property, so `${constructor}` never
 * reaches the prototype.
 *
 * **Line rules.** Blank lines and lines starting `;` or `#` are skipped. A
 * `[section]` header prefixes the keys after it with `section.` (npm itself
 * never reads a sectioned key). A key written `key[]=v` is an array setting:
 * an entry with `array: true` and the key without `[]`, one per line, in file
 * order (read the list with {@link npmrcValues}). A key with
 * no `=` has the value `"true"`. A value in double quotes is decoded as JSON
 * where it is valid JSON, a single-quoted one is unquoted, and an unquoted one
 * ends at an unescaped `;` or `#`. A key repeated in the file is returned each
 * time; {@link npmrcValue} takes the last, as npm's merge does. Where a plain
 * `key=v` and `key[]=v` share a name, `ini` folds both into one list; this
 * parser keeps them as separate entries.
 *
 * @example
 * ```ts
 * const entries = parseNpmrc("registry=https://mirror.example/\n//host/:_authToken=${TOKEN}", { TOKEN: "t0k" });
 * npmrcValue(entries, "//host/:_authToken"); // Option.some("t0k")
 * ```
 *
 * @param text - The `.npmrc` text.
 * @param env - The environment `${VAR}` expands from.
 * @public
 */
export const parseNpmrc = (
	text: string,
	env: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<NpmrcEntry> => {
	const entries: Array<NpmrcEntry> = [];
	let section = "";
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
		const header = /^\[([^\]]*)\]$/.exec(line);
		if (header !== null) {
			section = (header[1] as string).trim();
			continue;
		}
		const equals = line.indexOf("=");
		const rawKey = (equals === -1 ? line : line.slice(0, equals)).trim();
		if (rawKey === "") continue;
		const decodedKey = iniValue(rawKey);
		const array = decodedKey.endsWith("[]");
		const named = substitute(array ? decodedKey.slice(0, -2) : decodedKey, env);
		if (named.value === "") continue;
		const fullKey = section === "" ? named.value : `${section}.${named.value}`;
		const rawValue = equals === -1 ? "true" : iniValue(line.slice(equals + 1));
		const { value, missing } = substitute(rawValue, env);
		entries.push(NpmrcEntry.make({ key: fullKey, value, unset: [...named.missing, ...missing], array }));
	}
	return entries;
};

/**
 * The value of `key` in parsed entries, or `Option.none()` when the file does
 * not set it. The last occurrence wins, as in npm's merge. Array entries
 * (`key[]=v`) are not scalar settings and are never answered here: a key set
 * only that way is `Option.none()`; read it with {@link npmrcValues}.
 *
 * @param entries - The result of {@link parseNpmrc}.
 * @param key - The exact setting key.
 * @public
 */
export const npmrcValue = (entries: ReadonlyArray<NpmrcEntry>, key: string): Option.Option<string> => {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as NpmrcEntry;
		if (!entry.array && entry.key === key) return Option.some(entry.value);
	}
	return Option.none();
};

/**
 * The values of the array setting `key` (`key[]=v` lines), in file order, or an
 * empty array when the file has none. A list, not a lookup: an absent array is
 * the empty list.
 *
 * @param entries - The result of {@link parseNpmrc}.
 * @param key - The setting key without `[]`.
 * @public
 */
export const npmrcValues = (entries: ReadonlyArray<NpmrcEntry>, key: string): ReadonlyArray<string> =>
	entries.filter((entry) => entry.array && entry.key === key).map((entry) => entry.value);

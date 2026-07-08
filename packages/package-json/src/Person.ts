/**
 * The `author` / `contributors` field model: a {@link Person} class with
 * structured `name` / `email` / `url`, plus {@link Person.FromString} — the
 * `"Name <email> (url)"` shorthand codec — and {@link Person.FromValue}, the
 * union accepting either the object or the shorthand string. Wired into
 * `Package.author` / `Package.contributors`.
 *
 * @packageDocumentation
 */

import { Schema, SchemaTransformation } from "effect";

/**
 * Schema-generated base class backing {@link Person}. Not meant to be
 * referenced directly — named and exported only so API Extractor can resolve
 * the heritage clause of the class it backs.
 *
 * @public
 */
export const Person_base: Schema.Class<
	Person,
	Schema.Struct<{
		readonly name: typeof Schema.String;
		readonly email: Schema.optionalKey<typeof Schema.String>;
		readonly url: Schema.optionalKey<typeof Schema.String>;
	}>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.Class's own `Inherited = {}` default
	{}
> = Schema.Class<Person>("Person")({
	/** The person's name. */
	name: Schema.String,
	/** The optional email address. */
	email: Schema.optionalKey(Schema.String),
	/** The optional homepage URL. */
	url: Schema.optionalKey(Schema.String),
});

const parsePersonString = (input: string): Person => {
	const emailMatch = input.match(/<([^>]+)>/);
	const urlMatch = input.match(/\(([^)]+)\)/);
	let name = input;
	if (emailMatch !== null) name = name.replace(emailMatch[0], "");
	if (urlMatch !== null) name = name.replace(urlMatch[0], "");
	name = name.trim();
	return Person.make({
		name,
		...(emailMatch !== null ? { email: emailMatch[1] } : {}),
		...(urlMatch !== null ? { url: urlMatch[1] } : {}),
	});
};

/**
 * A structured person object with `name` and optional `email` / `url`.
 *
 * @public
 */
export class Person extends Person_base {
	/**
	 * Schema transformation between the `"Name <email> (url)"` shorthand string
	 * and a {@link Person}.
	 */
	static readonly FromString: Schema.Codec<Person, string> = Schema.String.pipe(
		Schema.decodeTo(
			Schema.instanceOf(Person),
			SchemaTransformation.transform({
				decode: (input: string) => parsePersonString(input),
				encode: (person: Person) => {
					let result = person.name;
					if (person.email !== undefined) result += ` <${person.email}>`;
					if (person.url !== undefined) result += ` (${person.url})`;
					return result;
				},
			}),
		),
	);

	/**
	 * The `author` / `contributors` value: either the shorthand string or the
	 * structured object, always decoded to a {@link Person}.
	 */
	static readonly FromValue: Schema.Union<[typeof Person, Schema.Codec<Person, string>]> = Schema.Union([
		Person,
		Person.FromString,
	]);
}

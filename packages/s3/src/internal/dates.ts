/**
 * Strict readers for the two timestamp forms an S3 answer carries: the ISO 8601
 * `LastModified` of a listing and the IMF-fixdate `Last-Modified` header.
 *
 * @remarks
 * `Date` and `DateTime.make` are lenient in two ways that would let a garbled
 * answer read as a real date: they accept shapes no store writes (`"1"` is the
 * year 2001), and they roll an impossible calendar date over (`2026-02-30` is
 * 2 March). Each reader checks the shape first, then the calendar, and only then
 * parses.
 *
 * @internal
 */
import { DateTime, Option } from "effect";

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):?(\d{2}))$/;

/** IMF-fixdate (RFC 9110 §5.6.7), the form S3, R2 and MinIO send: `Sun, 06 Nov 1994 08:49:37 GMT`. */
const IMF_FIXDATE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2}) GMT$/;

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number =>
	month === 2 ? (isLeapYear(year) ? 29 : 28) : month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;

/** A capture group as a number, `0` when the optional group did not match. */
const field = (match: RegExpExecArray, index: number): number => Number(match[index] ?? "0");

/**
 * Parse an ISO 8601 date-time as ListObjectsV2 writes it
 * (`2009-10-12T17:50:30.000Z`), or `Option.none()` for any other shape or an
 * impossible calendar date.
 *
 * @internal
 */
export const parseIsoDateTime = (text: string): Option.Option<DateTime.Utc> => {
	const match = ISO_DATE_TIME.exec(text);
	if (match === null) return Option.none();
	const year = field(match, 1);
	const month = field(match, 2);
	const day = field(match, 3);
	const valid =
		month >= 1 &&
		month <= 12 &&
		day >= 1 &&
		day <= daysInMonth(year, month) &&
		field(match, 4) <= 23 &&
		field(match, 5) <= 59 &&
		field(match, 6) <= 59 &&
		field(match, 7) <= 23 &&
		field(match, 8) <= 59;
	return valid ? Option.map(DateTime.make(text), DateTime.toUtc) : Option.none();
};

/**
 * Parse an IMF-fixdate HTTP date, or `Option.none()` for any other shape or an
 * impossible calendar date.
 *
 * @remarks
 * The date and time must survive a round trip: formatting the parsed instant
 * reproduces them exactly, so a rolled-over date (`30 Feb`) or an out-of-range
 * field (`25:00:00`) fails. The weekday need only be a weekday name; it is not
 * checked against the date.
 *
 * @internal
 */
export const parseHttpDate = (text: string): Option.Option<DateTime.Utc> => {
	const match = IMF_FIXDATE.exec(text);
	if (match === null) return Option.none();
	return DateTime.make(text).pipe(
		Option.map(DateTime.toUtc),
		Option.filter((parsed) => DateTime.toDateUtc(parsed).toUTCString().slice(5, -4) === match[1]),
	);
};

import { DateValue, NullValue, parsePropertyId } from "obsidian";
import type { App, BasesEntry, BasesPropertyId, Value } from "obsidian";
import { isLocalMidnight, parseDateString } from "./dates";
import type { CalendarEvent } from "./types";

function readTitle(entry: BasesEntry, titleProp: BasesPropertyId | null): string {
	if (titleProp) {
		try {
			const value = entry.getValue(titleProp);
			if (value && value.isTruthy()) {
				const str = value.toString().trim();
				if (str) return str;
			}
		} catch {
			// Fall through to file name
		}
	}
	return entry.file.basename;
}

type ParsedPropertyId = ReturnType<typeof parsePropertyId>;

function readEntryDate(
	entry: BasesEntry,
	propId: BasesPropertyId,
	parsed: ParsedPropertyId,
	frontmatter: Record<string, unknown> | undefined,
): Date | null {
	if (parsed.type === "note" && frontmatter) {
		const fromRaw = parseRawDate(frontmatter[parsed.name]);
		if (fromRaw) return fromRaw;
	}
	return readValueDate(safeGetValue(entry, propId));
}

function safeGetValue(entry: BasesEntry, propId: BasesPropertyId): Value | null {
	try {
		return entry.getValue(propId);
	} catch {
		return null;
	}
}

function parseRawDate(raw: unknown): Date | null {
	if (raw == null) return null;
	if (Array.isArray(raw)) return raw.length > 0 ? parseRawDate(raw[0]) : null;
	if (typeof raw === "string") return parseDateString(raw);
	if (typeof raw === "number") {
		const date = new Date(raw);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	if (raw instanceof Date) {
		if (Number.isNaN(raw.getTime())) return null;
		const midnightUTC =
			raw.getUTCHours() === 0 &&
			raw.getUTCMinutes() === 0 &&
			raw.getUTCSeconds() === 0;
		if (midnightUTC) {
			return new Date(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate());
		}
		return raw;
	}
	return null;
}

function readValueDate(value: Value | null): Date | null {
	if (value === null || value instanceof NullValue) return null;
	if (value instanceof DateValue) return parseDateString(value.toString());
	const str = value.toString().trim();
	return str ? parseDateString(str) : null;
}

interface EventBuildOptions {
	app: App;
	entries: BasesEntry[];
	titleProp: BasesPropertyId | null;
	dateProp: BasesPropertyId;
	endProp: BasesPropertyId;
}

export function buildEvents(opts: EventBuildOptions): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	const dateParsed = parsePropertyId(opts.dateProp);
	const endParsed = parsePropertyId(opts.endProp);
	const needsFrontmatter = dateParsed.type === "note" || endParsed.type === "note";

	for (const entry of opts.entries) {
		const frontmatter = needsFrontmatter
			? opts.app.metadataCache.getFileCache(entry.file)?.frontmatter
			: undefined;

		const start = readEntryDate(entry, opts.dateProp, dateParsed, frontmatter);
		if (!start) continue;

		const rawEnd = readEntryDate(entry, opts.endProp, endParsed, frontmatter);

		const allDay =
			isLocalMidnight(start) && (rawEnd === null || isLocalMidnight(rawEnd));

		let end: Date | null = null;
		if (rawEnd) {
			const usable = allDay
				? rawEnd.getTime() >= start.getTime()
				: rawEnd.getTime() > start.getTime();
			if (usable) end = rawEnd;
		}

		const path = entry.file.path;
		events.push({
			id: path,
			path,
			title: readTitle(entry, opts.titleProp),
			start,
			end,
			rawEnd,
			allDay,
		});
	}

	return events;
}

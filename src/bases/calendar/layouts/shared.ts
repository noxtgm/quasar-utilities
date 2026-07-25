import { Keymap } from "obsidian";
import {
	addDays,
	addMinutes,
	formatTime,
	startOfDay,
	toLocalISODate,
} from "../dates";
import type { CalendarEvent, LayoutContext } from "../types";

const MAX_SPAN_DAYS = 366;
const DRAG_THRESHOLD = 4;
const MS_PER_DAY = 86_400_000;

export function sortEvents(a: CalendarEvent, b: CalendarEvent): number {
	if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
	const diff = a.start.getTime() - b.start.getTime();
	if (diff !== 0) return diff;
	return a.title.localeCompare(b.title);
}

function lastCoveredDay(event: CalendarEvent): Date {
	const first = startOfDay(event.start);
	let lastTime: number;
	if (event.end) {
		lastTime = event.allDay ? event.end.getTime() : event.end.getTime() - 1;
	} else {
		lastTime = event.start.getTime();
	}
	return startOfDay(new Date(Math.max(lastTime, first.getTime())));
}

export function coveredDays(event: CalendarEvent): Date[] {
	const first = startOfDay(event.start);
	const last = lastCoveredDay(event).getTime();
	const days: Date[] = [];
	for (
		let d = first;
		d.getTime() <= last && days.length < MAX_SPAN_DAYS;
		d = addDays(d, 1)
	) {
		days.push(d);
	}
	return days;
}

export function allDayDropEnd(
	event: CalendarEvent,
	start: Date,
	durationMinutes: number,
): Date {
	const spanDays = coveredDays(event).length;
	return addMinutes(addDays(start, spanDays - 1), durationMinutes);
}

export function dayDelta(from: Date, to: Date): number {
	return Math.round(
		(startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY,
	);
}

export function shiftEventStart(
	event: CalendarEvent,
	grabDay: Date,
	targetDay: Date,
): Date {
	return addDays(event.start, dayDelta(grabDay, targetDay));
}

export function eventCoversDay(event: CalendarEvent, day: Date): boolean {
	const d = startOfDay(day).getTime();
	return (
		d >= startOfDay(event.start).getTime() &&
		d <= lastCoveredDay(event).getTime()
	);
}

export function groupByDay(
	events: CalendarEvent[],
): Map<string, CalendarEvent[]> {
	const map = new Map<string, CalendarEvent[]>();
	for (const ev of events) {
		for (const day of coveredDays(ev)) {
			const iso = toLocalISODate(day);
			const list = map.get(iso);
			if (list) list.push(ev);
			else map.set(iso, [ev]);
		}
	}
	return map;
}

export interface DragSpec {
	onMove: (clientX: number, clientY: number) => void;
	onDrop: (clientX: number, clientY: number) => boolean;
	onEnd: () => void;
}

const SETTLE_MS = 700;
let dragGeneration = 0;

export function nextDragGeneration(): number {
	return ++dragGeneration;
}

export function settleAfterDrop(
	doc: Document,
	generation: number,
	committed: boolean,
	restore: (stale: boolean) => void,
): void {
	const run = (): void => restore(generation !== dragGeneration);
	if (!committed) {
		run();
		return;
	}
	(doc.defaultView ?? window).setTimeout(run, SETTLE_MS);
}

export function eventNodes(
	root: HTMLElement | null,
	eventId: string,
): HTMLElement[] {
	if (!root) return [];
	return Array.from(
		root.querySelectorAll<HTMLElement>("[data-event-id]"),
	).filter((el) => el.dataset.eventId === eventId);
}

export function attachChipInteractions(
	chip: HTMLElement,
	event: CalendarEvent,
	ctx: LayoutContext,
	drag: DragSpec,
): void {
	chip.addEventListener("auxclick", (e) => {
		if (e.button !== 1) return;
		e.preventDefault();
		ctx.callbacks.openBackground(event.path);
	});

	const root = chip.closest<HTMLElement>(".obsilities-calendar");

	chip.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		const startX = e.clientX;
		const startY = e.clientY;
		const doc = chip.doc;
		let dragging = false;
		let hidden: HTMLElement[] = [];
		let generation = 0;

		const begin = (): void => {
			dragging = true;
			generation = nextDragGeneration();
			ctx.callbacks.setDragging(true);
			const nodes = eventNodes(root, event.id);
			hidden = nodes.length > 0 ? nodes : [chip];
			for (const el of hidden) el.addClass("is-dragging");
			root?.addClass("is-dragging-active");
		};

		const end = (committed: boolean): void => {
			root?.removeClass("is-dragging-active");
			ctx.callbacks.setDragging(false);
			const nodes = hidden;
			hidden = [];
			settleAfterDrop(doc, generation, committed, (stale) => {
				for (const el of nodes) el.removeClass("is-dragging");
				if (!stale) drag.onEnd();
			});
		};

		const cleanup = (): void => {
			doc.removeEventListener("pointermove", onMove);
			doc.removeEventListener("pointerup", onUp);
			doc.removeEventListener("pointercancel", onCancel);
		};

		const onMove = (move: PointerEvent): void => {
			if (!dragging) {
				if (
					Math.abs(move.clientX - startX) < DRAG_THRESHOLD &&
					Math.abs(move.clientY - startY) < DRAG_THRESHOLD
				) {
					return;
				}
				begin();
			}
			drag.onMove(move.clientX, move.clientY);
		};

		const onUp = (up: PointerEvent): void => {
			cleanup();
			if (dragging) {
				end(drag.onDrop(up.clientX, up.clientY));
			} else {
				ctx.callbacks.open(event.path, !!Keymap.isModEvent(up));
			}
		};

		const onCancel = (): void => {
			cleanup();
			if (dragging) end(false);
		};

		doc.addEventListener("pointermove", onMove);
		doc.addEventListener("pointerup", onUp);
		doc.addEventListener("pointercancel", onCancel);
	});
}

export function buildPreviewChip(
	event: CalendarEvent,
	allDay: boolean,
	isStart = true,
): HTMLElement {
	const chip = createDiv({ cls: "obsilities-calendar-chip is-preview" });
	if (allDay || event.allDay) {
		chip.addClass("is-allday");
	} else if (isStart) {
		chip.createSpan({
			cls: "obsilities-calendar-chip-time",
			text: formatTime(event.start),
		});
	}
	chip.createSpan({
		cls: "obsilities-calendar-chip-title",
		text: event.title,
	});
	return chip;
}

export function renderDaySpanPreview(
	event: CalendarEvent,
	grabDay: Date,
	targetDay: Date,
	allDay: boolean,
	resolveContainer: (iso: string) => HTMLElement | null,
): HTMLElement[] {
	const delta = dayDelta(grabDay, targetDay);
	const chips: HTMLElement[] = [];
	coveredDays(event).forEach((covered, i) => {
		const iso = toLocalISODate(addDays(covered, delta));
		const container = resolveContainer(iso);
		if (!container) return; // Day not in the visible range
		const chip = buildPreviewChip(event, allDay, i === 0);
		container.prepend(chip);
		chips.push(chip);
	});
	return chips;
}

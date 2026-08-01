import {
	addDays,
	addMinutes,
	formatHourLabel,
	formatTime,
	fromLocalISODate,
	minutesSinceMidnight,
	sameDay,
	startOfDay,
	startOfWeek,
	toLocalISODate,
} from "../dates";
import type {
	CalendarEvent,
	CalendarLayoutRenderer,
	LayoutContext,
} from "../types";
import {
	allDayDropEnd,
	attachChipInteractions,
	dayDelta,
	eventCoversDay,
	eventNodes,
	nextDragGeneration,
	renderDaySpanPreview,
	settleAfterDrop,
	shiftEventStart,
	sortEvents,
} from "./shared";
import type { DragSpec } from "./shared";

type TimeGridZone = {
	kind: "timed" | "allday";
	col: HTMLElement;
	day: Date;
};

const HOURS = 24;
const HOUR_HEIGHT = 44; // px per hour, keep in sync with styles.css
const DAY_MINUTES = HOURS * 60;
const SNAP_MINUTES = 15;
const MIN_BLOCK_HEIGHT = 20;
const COMPACT_BLOCK_HEIGHT = 36;
const INITIAL_SCROLL_HOUR = 7;

interface DaySegment {
	event: CalendarEvent;
	startMin: number; // Minutes from this day's midnight [0, DAY_MINUTES)
	endMin: number; // Minutes from this day's midnight (0, DAY_MINUTES]
	continuesBefore: boolean;
	continuesAfter: boolean;
}

interface PlacedSegment {
	segment: DaySegment;
	lane: number;
	lanes: number;
}

function endTimeOf(event: CalendarEvent, defaultMinutes: number): number {
	return event.end
		? event.end.getTime()
		: event.start.getTime() + defaultMinutes * 60000;
}

function durationMinutes(event: CalendarEvent, defaultMinutes: number): number {
	return (endTimeOf(event, defaultMinutes) - event.start.getTime()) / 60000;
}

function segmentsForDay(
	events: CalendarEvent[],
	day: Date,
	defaultMinutes: number,
): DaySegment[] {
	const dayStart = startOfDay(day).getTime();
	const dayEnd = dayStart + DAY_MINUTES * 60000;
	const segments: DaySegment[] = [];
	for (const event of events) {
		if (event.allDay) continue;
		const start = event.start.getTime();
		const end = endTimeOf(event, defaultMinutes);
		if (end <= dayStart || start >= dayEnd) continue;
		segments.push({
			event,
			startMin: (Math.max(start, dayStart) - dayStart) / 60000,
			endMin: (Math.min(end, dayEnd) - dayStart) / 60000,
			continuesBefore: start < dayStart,
			continuesAfter: end > dayEnd,
		});
	}
	return segments;
}

function spansDays(segment: DaySegment): boolean {
	return segment.continuesBefore || segment.continuesAfter;
}

function laneOrder(a: DaySegment, b: DaySegment): number {
	const spanA = spansDays(a);
	const spanB = spansDays(b);
	if (spanA !== spanB) return spanA ? -1 : 1;
	if (spanA) {
		return (
			a.event.start.getTime() - b.event.start.getTime() ||
			a.event.id.localeCompare(b.event.id)
		);
	}
	return (
		a.startMin - b.startMin ||
		a.endMin - b.endMin ||
		a.event.id.localeCompare(b.event.id)
	);
}

/** Split into groups of transitively overlapping segments */
function clusterSegments(segments: DaySegment[]): DaySegment[][] {
	const sorted = segments
		.slice()
		.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

	const clusters: DaySegment[][] = [];
	let cluster: DaySegment[] = [];
	let clusterMaxEnd = -Infinity;

	for (const segment of sorted) {
		if (cluster.length > 0 && segment.startMin >= clusterMaxEnd) {
			clusters.push(cluster);
			cluster = [];
			clusterMaxEnd = -Infinity;
		}
		cluster.push(segment);
		clusterMaxEnd = Math.max(clusterMaxEnd, segment.endMin);
	}
	if (cluster.length > 0) clusters.push(cluster);

	return clusters;
}

function packSegments(segments: DaySegment[]): PlacedSegment[] {
	const placed: PlacedSegment[] = [];

	for (const cluster of clusterSegments(segments)) {
		const lanes: DaySegment[][] = [];
		for (const segment of cluster.slice().sort(laneOrder)) {
			let target = lanes.find((members) =>
				members.every(
					(other) =>
						other.endMin <= segment.startMin ||
						other.startMin >= segment.endMin,
				),
			);
			if (!target) {
				target = [];
				lanes.push(target);
			}
			target.push(segment);
		}
		for (let i = 0; i < lanes.length; i++) {
			for (const segment of lanes[i] ?? []) {
				placed.push({ segment, lane: i, lanes: lanes.length });
			}
		}
	}

	return placed;
}

export class TimeGridLayout implements CalendarLayoutRenderer {
	private root: HTMLElement;
	private headerEl: HTMLElement;
	private alldayEl: HTMLElement;
	private bodyEl: HTMLElement;
	private previewEls: HTMLElement[] = [];
	private dropTarget: HTMLElement | null = null;
	private initialized = false;

	constructor(
		container: HTMLElement,
		private mode: "week" | "3days" | "day",
	) {
		this.root = container.createDiv({
			cls: `obsilities-calendar-timegrid mod-${mode}`,
		});
		this.headerEl = this.root.createDiv({
			cls: "obsilities-calendar-timegrid-header",
		});
		this.alldayEl = this.root.createDiv({
			cls: "obsilities-calendar-timegrid-allday",
		});
		this.bodyEl = this.root.createDiv({
			cls: "obsilities-calendar-timegrid-body",
		});
	}

	destroy(): void {
		this.root.remove();
	}

	private days(ctx: LayoutContext): Date[] {
		if (this.mode === "day") return [startOfDay(ctx.anchor)];
		if (this.mode === "3days") {
			const start = startOfDay(ctx.anchor);
			return [start, addDays(start, 1), addDays(start, 2)];
		}
		const start = startOfWeek(ctx.anchor, ctx.weekStart);
		const days: Date[] = [];
		for (let i = 0; i < 7; i++) days.push(addDays(start, i));
		return days;
	}

	render(ctx: LayoutContext): void {
		const scrollTop = this.bodyEl.scrollTop;
		const days = this.days(ctx);
		this.renderHeader(days, ctx);
		this.renderAllDay(days, ctx);
		this.renderBody(days, ctx);

		if (!this.initialized) {
			this.bodyEl.scrollTop = INITIAL_SCROLL_HOUR * HOUR_HEIGHT;
			this.initialized = true;
		} else {
			this.bodyEl.scrollTop = scrollTop;
		}
	}

	private renderHeader(days: Date[], ctx: LayoutContext): void {
		this.headerEl.empty();
		this.headerEl.createDiv({
			cls: "obsilities-calendar-timegrid-gutter-label",
		});
		const cols = this.headerEl.createDiv({
			cls: "obsilities-calendar-timegrid-header-cols",
		});
		for (const day of days) {
			const col = cols.createDiv({
				cls: "obsilities-calendar-timegrid-dayhead",
			});
			if (sameDay(day, ctx.today)) col.addClass("is-today");
			col.createDiv({
				cls: "obsilities-calendar-dayhead-weekday",
				text: day.toLocaleDateString(undefined, { weekday: "short" }),
			});
			const number = col.createDiv({
				cls: "obsilities-calendar-dayhead-date",
				text: String(day.getDate()),
			});
			if (this.mode !== "day") {
				number.addEventListener("click", (e) => {
					e.stopPropagation();
					ctx.callbacks.viewDay(day);
				});
			}
		}
	}

	private renderAllDay(days: Date[], ctx: LayoutContext): void {
		this.alldayEl.empty();

		this.alldayEl.createDiv({
			cls: "obsilities-calendar-timegrid-gutter-label",
			text: "All-day",
		});
		const cols = this.alldayEl.createDiv({
			cls: "obsilities-calendar-timegrid-allday-cols",
		});

		for (const day of days) {
			const col = cols.createDiv({
				cls: "obsilities-calendar-allday-col",
				attr: { "data-date": toLocalISODate(day) },
			});
			const dayEvents = ctx.events
				.filter((ev) => ev.allDay && eventCoversDay(ev, day))
				.sort(sortEvents);
			for (const event of dayEvents) {
				this.buildAllDayChip(col, event, ctx, day);
			}
		}
	}

	private renderBody(days: Date[], ctx: LayoutContext): void {
		this.bodyEl.empty();

		const gutter = this.bodyEl.createDiv({
			cls: "obsilities-calendar-timegrid-gutter",
		});
		for (let h = 0; h < HOURS; h++) {
			const slot = gutter.createDiv({
				cls: "obsilities-calendar-hour-label",
			});
			if (h > 0) slot.setText(formatHourLabel(h));
		}

		const cols = this.bodyEl.createDiv({
			cls: "obsilities-calendar-timegrid-cols",
		});
		for (const day of days) {
			this.buildDayColumn(cols, day, ctx);
		}
	}

	private buildDayColumn(
		cols: HTMLElement,
		day: Date,
		ctx: LayoutContext,
	): void {
		const col = cols.createDiv({
			cls: "obsilities-calendar-timegrid-col",
			attr: { "data-date": toLocalISODate(day) },
		});
		if (sameDay(day, ctx.today)) col.addClass("is-today");

		for (let h = 0; h < HOURS; h++) {
			col.createDiv({ cls: "obsilities-calendar-hour-line" });
		}

		const segments = segmentsForDay(
			ctx.events,
			day,
			ctx.defaultDurationMinutes,
		);
		for (const placed of packSegments(segments)) {
			this.buildTimedBlock(col, placed, ctx, day);
		}

		if (sameDay(day, ctx.today)) {
			const now = ctx.today;
			const line = col.createDiv({
				cls: "obsilities-calendar-now-line",
			});
			line.style.top = `${(minutesSinceMidnight(now) / 60) * HOUR_HEIGHT}px`;
		}
	}

	private buildTimedBlock(
		col: HTMLElement,
		placed: PlacedSegment,
		ctx: LayoutContext,
		day: Date,
	): void {
		const { segment, lane, lanes } = placed;
		const { event } = segment;
		const top = (segment.startMin / 60) * HOUR_HEIGHT;
		const height = Math.max(
			MIN_BLOCK_HEIGHT,
			((segment.endMin - segment.startMin) / 60) * HOUR_HEIGHT,
		);

		const block = col.createDiv({
			cls: "obsilities-calendar-event",
			attr: { "data-event-id": event.id },
		});
		if (segment.continuesBefore) block.addClass("is-continued-before");
		if (segment.continuesAfter) block.addClass("is-continued-after");
		if (height < COMPACT_BLOCK_HEIGHT) block.addClass("is-compact");
		block.style.top = `${top}px`;
		block.style.height = `${height}px`;
		block.style.left = `${(lane / lanes) * 100}%`;
		block.style.width = `${(1 / lanes) * 100}%`;

		if (!segment.continuesBefore) {
			block.createSpan({
				cls: "obsilities-calendar-event-time",
				text: formatTime(event.start),
			});
		}
		block.createSpan({
			cls: "obsilities-calendar-event-title",
			text: event.title,
		});

		attachChipInteractions(
			block,
			event,
			ctx,
			this.makeDragSpec(event, ctx, day, !segment.continuesBefore),
		);

		if (!segment.continuesBefore) {
			const topHandle = block.createDiv({
				cls: "obsilities-calendar-event-resize is-top",
			});
			this.registerEdgeDrag(topHandle, event, "start", ctx);
		}
		if (!segment.continuesAfter) {
			const bottomHandle = block.createDiv({
				cls: "obsilities-calendar-event-resize is-bottom",
			});
			this.registerEdgeDrag(bottomHandle, event, "end", ctx);
		}
	}

	private buildAllDayChip(
		col: HTMLElement,
		event: CalendarEvent,
		ctx: LayoutContext,
		day: Date,
	): void {
		const chip = col.createDiv({
			cls: "obsilities-calendar-chip is-allday",
			attr: { "data-event-id": event.id },
		});
		chip.createSpan({
			cls: "obsilities-calendar-chip-title",
			text: event.title,
		});
		attachChipInteractions(
			chip,
			event,
			ctx,
			this.makeDragSpec(event, ctx, day, true),
		);
	}

	private makeDragSpec(
		event: CalendarEvent,
		ctx: LayoutContext,
		grabDay: Date,
		retime: boolean,
	): DragSpec {
		return {
			onMove: (x, y) => {
				const zone = this.zoneAt(x, y);
				if (!zone) return;
				if (zone.kind === "timed") {
					this.setDropTarget(null);
					this.showPreview(
						this.dropStart(event, zone, y, grabDay, retime),
						event,
						ctx,
					);
				} else {
					this.setDropTarget(zone.col);
					this.showAllDayPreview(grabDay, zone.day, event);
				}
			},
			onDrop: (x, y) => {
				const zone = this.zoneAt(x, y);
				if (!zone) return false;
				const allDay = zone.kind === "allday";
				const start = this.dropStart(event, zone, y, grabDay, retime);
				if (
					allDay === event.allDay &&
					start.getTime() === event.start.getTime()
				) {
					return false;
				}
				ctx.callbacks.reschedule(event, start, allDay);
				return true;
			},
			onEnd: () => {
				this.clearPreview();
				this.setDropTarget(null);
			},
		};
	}

	private dropStart(
		event: CalendarEvent,
		zone: TimeGridZone,
		clientY: number,
		grabDay: Date,
		retime: boolean,
	): Date {
		if (zone.kind === "allday" || !retime) {
			return shiftEventStart(event, grabDay, zone.day);
		}
		const dropped = addMinutes(
			startOfDay(zone.day),
			this.pointerMinutes(zone.col, clientY),
		);
		return addDays(dropped, -dayDelta(event.start, grabDay));
	}

	private zoneAt(x: number, y: number): TimeGridZone | null {
		const el = this.root.doc.elementFromPoint(x, y);
		if (!el) return null;
		const timed = el.closest<HTMLElement>(
			".obsilities-calendar-timegrid-col",
		);
		if (timed) {
			const day = fromLocalISODate(timed.dataset.date ?? "");
			if (day) return { kind: "timed", col: timed, day };
		}
		const allday = el.closest<HTMLElement>(
			".obsilities-calendar-allday-col",
		);
		if (allday) {
			const day = fromLocalISODate(allday.dataset.date ?? "");
			if (day) return { kind: "allday", col: allday, day };
		}
		return null;
	}

	private setDropTarget(col: HTMLElement | null): void {
		if (this.dropTarget === col) return;
		this.dropTarget?.removeClass("is-drop-target");
		this.dropTarget = col;
		col?.addClass("is-drop-target");
	}

	private showPreview(
		start: Date,
		event: CalendarEvent,
		ctx: LayoutContext,
	): void {
		this.clearPreview();
		const end = this.droppedEnd(event, start, ctx);
		this.appendSpanSegments(start, end, event.title);
	}

	private droppedEnd(
		event: CalendarEvent,
		start: Date,
		ctx: LayoutContext,
	): Date {
		if (event.allDay) {
			return allDayDropEnd(event, start, ctx.defaultDurationMinutes);
		}
		if (!event.end) return addMinutes(start, ctx.defaultDurationMinutes);
		return addMinutes(
			start,
			durationMinutes(event, ctx.defaultDurationMinutes),
		);
	}

	private showResizePreview(
		event: CalendarEvent,
		start: Date,
		end: Date,
	): void {
		this.clearPreview();
		this.appendSpanSegments(start, end, event.title);
	}

	private appendSpanSegments(start: Date, end: Date, title: string): void {
		const endMs = end.getTime();
		let day = startOfDay(start);
		for (let guard = 0; day.getTime() < endMs && guard < 366; guard++) {
			const dayStart = day.getTime();
			const dayEnd = dayStart + DAY_MINUTES * 60000;
			const col = this.timedColForDay(toLocalISODate(day));
			day = addDays(day, 1);
			if (!col) continue; // Day not in view

			const topMin =
				(Math.max(start.getTime(), dayStart) - dayStart) / 60000;
			const botMin = (Math.min(endMs, dayEnd) - dayStart) / 60000;
			if (botMin <= topMin) continue;
			const continuesBefore = start.getTime() < dayStart;
			this.appendPreviewSegment(col, {
				topMin,
				botMin,
				timeLabel: continuesBefore ? null : formatTime(start),
				title,
				continuesBefore,
				continuesAfter: endMs > dayEnd,
			});
		}
	}

	private appendPreviewSegment(
		col: HTMLElement,
		seg: {
			topMin: number;
			botMin: number;
			timeLabel: string | null;
			title: string;
			continuesBefore: boolean;
			continuesAfter: boolean;
		},
	): void {
		const el = createDiv({ cls: "obsilities-calendar-event is-preview" });
		if (seg.continuesBefore) el.addClass("is-continued-before");
		if (seg.continuesAfter) el.addClass("is-continued-after");

		const top = (seg.topMin / 60) * HOUR_HEIGHT;
		const height = Math.max(
			MIN_BLOCK_HEIGHT,
			((seg.botMin - seg.topMin) / 60) * HOUR_HEIGHT,
		);
		if (height < COMPACT_BLOCK_HEIGHT) el.addClass("is-compact");
		el.style.top = `${top}px`;
		el.style.height = `${height}px`;
		el.style.left = "0";
		el.style.width = "100%";

		if (seg.timeLabel !== null) {
			el.createSpan({
				cls: "obsilities-calendar-event-time",
				text: seg.timeLabel,
			});
		}
		el.createSpan({
			cls: "obsilities-calendar-event-title",
			text: seg.title,
		});

		col.appendChild(el);
		this.previewEls.push(el);
	}

	private timedColForDay(iso: string): HTMLElement | null {
		return this.bodyEl.querySelector<HTMLElement>(
			`.obsilities-calendar-timegrid-col[data-date="${iso}"]`,
		);
	}

	private showAllDayPreview(
		grabDay: Date,
		day: Date,
		event: CalendarEvent,
	): void {
		this.clearPreview();
		this.previewEls.push(
			...renderDaySpanPreview(event, grabDay, day, true, (iso) =>
				this.alldayColForDay(iso),
			),
		);
	}

	private alldayColForDay(iso: string): HTMLElement | null {
		return this.alldayEl.querySelector<HTMLElement>(
			`.obsilities-calendar-allday-col[data-date="${iso}"]`,
		);
	}

	private clearPreview(): void {
		for (const el of this.previewEls) el.remove();
		this.previewEls = [];
	}

	private pointerMinutes(col: HTMLElement, clientY: number): number {
		const rect = col.getBoundingClientRect();
		const offset = clientY - rect.top;
		const rawMinutes = (offset / HOUR_HEIGHT) * 60;
		const snapped = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
		return Math.min(Math.max(snapped, 0), HOURS * 60 - SNAP_MINUTES);
	}

	private registerEdgeDrag(
		handle: HTMLElement,
		event: CalendarEvent,
		edge: "start" | "end",
		ctx: LayoutContext,
	): void {
		handle.addEventListener("click", (e) => e.stopPropagation());

		handle.addEventListener("pointerdown", (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();
			const doc = handle.doc;
			const calRoot = handle.closest<HTMLElement>(".obsilities-calendar");
			const generation = nextDragGeneration();
			ctx.callbacks.setDragging(true);
			calRoot?.addClass("is-dragging-active");

			// Only once the pointer actually moves
			let hidden: HTMLElement[] = [];
			const hideSource = (): void => {
				if (hidden.length > 0) return;
				hidden = eventNodes(calRoot, event.id);
				for (const el of hidden) el.addClass("is-dragging");
			};

			const cleanup = (): void => {
				doc.removeEventListener("pointermove", onMove);
				doc.removeEventListener("pointerup", onUp);
				doc.removeEventListener("pointercancel", onCancel);
			};

			const finish = (committed: boolean): void => {
				calRoot?.removeClass("is-dragging-active");
				ctx.callbacks.setDragging(false);
				const nodes = hidden;
				hidden = [];
				settleAfterDrop(doc, generation, committed, (stale) => {
					for (const el of nodes) el.removeClass("is-dragging");
					if (!stale) this.clearPreview();
				});
			};

			const onMove = (move: PointerEvent): void => {
				hideSource();
				const res = this.edgeResizeAt(
					move.clientX,
					move.clientY,
					event,
					edge,
					ctx.defaultDurationMinutes,
				);
				if (res) this.showResizePreview(event, res.start, res.end);
			};
			const onUp = (up: PointerEvent): void => {
				cleanup();
				const res = this.edgeResizeAt(
					up.clientX,
					up.clientY,
					event,
					edge,
					ctx.defaultDurationMinutes,
				);
				if (res) ctx.callbacks.resize(event, res.start, res.end);
				finish(!!res);
			};
			const onCancel = (): void => {
				cleanup();
				finish(false);
			};

			doc.addEventListener("pointermove", onMove);
			doc.addEventListener("pointerup", onUp);
			doc.addEventListener("pointercancel", onCancel);
		});
	}

	private edgeMinutes(col: HTMLElement, clientY: number): number {
		const rect = col.getBoundingClientRect();
		const offset = clientY - rect.top;
		const rawMinutes = (offset / HOUR_HEIGHT) * 60;
		const snapped = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
		return Math.min(Math.max(snapped, 0), DAY_MINUTES);
	}

	private edgeResizeAt(
		clientX: number,
		clientY: number,
		event: CalendarEvent,
		edge: "start" | "end",
		defaultMinutes: number,
	): { start: Date; end: Date } | null {
		const zone = this.zoneAt(clientX, clientY);
		if (!zone || zone.kind !== "timed") return null;
		const minutes = this.edgeMinutes(zone.col, clientY);
		const candidate = addMinutes(startOfDay(zone.day), minutes).getTime();
		const minMs = SNAP_MINUTES * 60000;
		if (edge === "end") {
			const startMs = event.start.getTime();
			return {
				start: new Date(startMs),
				end: new Date(Math.max(startMs + minMs, candidate)),
			};
		}
		const endMs = endTimeOf(event, defaultMinutes);
		return {
			start: new Date(Math.min(endMs - minMs, candidate)),
			end: new Date(endMs),
		};
	}
}

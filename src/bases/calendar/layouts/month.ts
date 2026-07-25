import { setIcon } from "obsidian";
import {
	formatTime,
	fromLocalISODate,
	monthFixedLeading,
	sameDay,
	toLocalISODate,
} from "../dates";
import type {
	CalendarEvent,
	CalendarLayoutRenderer,
	LayoutContext,
} from "../types";
import {
	attachChipInteractions,
	groupByDay,
	renderDaySpanPreview,
	shiftEventStart,
	sortEvents,
} from "./shared";
import type { DragSpec } from "./shared";

const MAX_CHIPS = 4;

export class MonthLayout implements CalendarLayoutRenderer {
	private root: HTMLElement;
	private previewEls: HTMLElement[] = [];
	private dropTarget: HTMLElement | null = null;

	constructor(container: HTMLElement) {
		this.root = container.createDiv({ cls: "obsilities-calendar-month" });
	}

	destroy(): void {
		this.root.remove();
	}

	render(ctx: LayoutContext): void {
		this.root.empty();

		const grid = this.root.createDiv({ cls: "obsilities-calendar-grid" });
		const byDay = groupByDay(ctx.events);
		const monthIndex = ctx.anchor.getMonth();

		for (const day of monthFixedLeading(ctx.anchor, 2)) {
			this.buildDayCell(grid, day, monthIndex, ctx, byDay);
		}
	}

	private buildDayCell(
		grid: HTMLElement,
		day: Date,
		monthIndex: number,
		ctx: LayoutContext,
		byDay: Map<string, CalendarEvent[]>,
	): void {
		const iso = toLocalISODate(day);
		const cell = grid.createDiv({
			cls: "obsilities-calendar-day",
			attr: { "data-date": iso },
		});
		if (day.getMonth() !== monthIndex) cell.addClass("is-outside");
		if (sameDay(day, ctx.today)) cell.addClass("is-today");

		const dayHeader = cell.createDiv({
			cls: "obsilities-calendar-day-header",
		});
		const number = dayHeader.createSpan({
			cls: "obsilities-calendar-day-number",
			text: String(day.getDate()),
		});
		number.addEventListener("click", (e) => {
			e.stopPropagation();
			ctx.callbacks.viewDay(day);
		});
		const addBtn = dayHeader.createDiv({
			cls: "obsilities-calendar-day-add",
			attr: { "aria-label": "New event on this day" },
		});
		setIcon(addBtn, "plus");
		addBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			ctx.callbacks.create(day);
		});

		const body = cell.createDiv({ cls: "obsilities-calendar-day-events" });
		const dayEvents = (byDay.get(iso) ?? []).slice().sort(sortEvents);
		for (const event of dayEvents.slice(0, MAX_CHIPS)) {
			this.buildChip(body, event, ctx, day);
		}
		if (dayEvents.length > MAX_CHIPS) {
			const more = body.createDiv({
				cls: "obsilities-calendar-more",
				text: `+${dayEvents.length - MAX_CHIPS} more`,
			});
			more.addEventListener("click", (e) => {
				e.stopPropagation();
				ctx.callbacks.viewDay(day);
			});
		}
	}

	private buildChip(
		body: HTMLElement,
		event: CalendarEvent,
		ctx: LayoutContext,
		day: Date,
	): void {
		const chip = body.createDiv({
			cls: "obsilities-calendar-chip",
			attr: { "data-event-id": event.id },
		});
		if (event.allDay) chip.addClass("is-allday");
		else if (sameDay(event.start, day)) {
			chip.createSpan({
				cls: "obsilities-calendar-chip-time",
				text: formatTime(event.start),
			});
		}
		chip.createSpan({
			cls: "obsilities-calendar-chip-title",
			text: event.title,
		});

		attachChipInteractions(
			chip,
			event,
			ctx,
			this.makeDragSpec(event, ctx, day),
		);
	}

	private makeDragSpec(
		event: CalendarEvent,
		ctx: LayoutContext,
		grabDay: Date,
	): DragSpec {
		return {
			onMove: (x, y) => {
				const cell = this.cellAt(x, y);
				const day = cell && fromLocalISODate(cell.dataset.date ?? "");
				if (!day) return;
				this.setDropTarget(cell);
				this.showPreview(grabDay, day, event);
			},
			onDrop: (x, y) => {
				const cell = this.cellAt(x, y);
				const day = cell && fromLocalISODate(cell.dataset.date ?? "");
				if (!day) return false;
				const start = shiftEventStart(event, grabDay, day);
				if (start.getTime() === event.start.getTime()) return false;
				ctx.callbacks.reschedule(event, start, event.allDay);
				return true;
			},
			onEnd: () => {
				this.clearPreview();
				this.setDropTarget(null);
			},
		};
	}

	private cellAt(x: number, y: number): HTMLElement | null {
		const el = this.root.doc.elementFromPoint(x, y);
		return el ? el.closest<HTMLElement>(".obsilities-calendar-day") : null;
	}

	private setDropTarget(cell: HTMLElement | null): void {
		if (this.dropTarget === cell) return;
		this.dropTarget?.removeClass("is-drop-target");
		this.dropTarget = cell;
		cell?.addClass("is-drop-target");
	}

	private showPreview(
		grabDay: Date,
		targetDay: Date,
		event: CalendarEvent,
	): void {
		this.clearPreview();
		this.previewEls = renderDaySpanPreview(
			event,
			grabDay,
			targetDay,
			event.allDay,
			(iso) => this.dayBody(iso),
		);
	}

	private dayBody(iso: string): HTMLElement | null {
		return this.root.querySelector<HTMLElement>(
			`.obsilities-calendar-day[data-date="${iso}"] .obsilities-calendar-day-events`,
		);
	}

	private clearPreview(): void {
		for (const el of this.previewEls) el.remove();
		this.previewEls = [];
	}
}

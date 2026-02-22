import { App, PluginSettingTab, Setting } from "obsidian";
import type QuasarUtilitiesPlugin from "./main";

export class QuasarUtilitiesSettingTab extends PluginSettingTab {
	plugin: QuasarUtilitiesPlugin;

	constructor(app: App, plugin: QuasarUtilitiesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Settings").setHeading();

		const settingsList = containerEl.createDiv({
			cls: "quasar-utilities-settings-list",
		});

		new Setting(settingsList)
			.setName("Show settings button (Desktop)")
			.setDesc(
				"Show a button in the workspace header that opens Obsidian settings."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showSettingsButton)
					.onChange(async (value) => {
						this.plugin.settings.showSettingsButton = value;
						await this.plugin.saveSettings();
						this.plugin.refreshSettingsButton();
					})
			);

		new Setting(containerEl).setName("Smart typography").setHeading();

		const st = this.plugin.settings.smartTypography;
		const stList = containerEl.createDiv({
			cls: "quasar-utilities-settings-list",
		});

		new Setting(stList)
			.setName("Curly quotes")
			.setDesc(
				'Double and single quotes will be converted to curly quotes ("" and \'\')'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(st.curlyQuotes)
					.onChange(async (value) => {
						st.curlyQuotes = value;
						await this.plugin.saveSettings();
						this.toggleVisibility(curlyQuotesCharsEl, value);
					})
			);
		const curlyQuotesCharsEl = stList.createDiv({
			cls: "quasar-utilities-st-char-fields",
		});
		this.addQuoteCharSettings(curlyQuotesCharsEl, st);
		this.toggleVisibility(curlyQuotesCharsEl, st.curlyQuotes);

		new Setting(stList)
			.setName("Dashes")
			.setDesc(
				"Two dashes (--) → en-dash (–). En-dash + dash → em-dash (—). Em-dash + dash → three dashes (---)."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(st.emDash)
					.onChange(async (value) => {
						st.emDash = value;
						await this.plugin.saveSettings();
						this.toggleVisibility(skipEnDashEl, value);
					})
			);
		const skipEnDashEl = stList.createDiv({
			cls: "quasar-utilities-st-char-fields",
		});
		new Setting(skipEnDashEl)
			.setName("Skip en-dash")
			.setDesc(
				"When enabled, two dashes are converted to an em-dash instead of an en-dash."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(st.skipEnDash)
					.onChange(async (value) => {
						st.skipEnDash = value;
						await this.plugin.saveSettings();
					})
			);
		this.toggleVisibility(skipEnDashEl, st.emDash);

		new Setting(stList)
			.setName("Ellipsis")
			.setDesc("Three periods (...) will be converted to an ellipsis (…).")
			.addToggle((toggle) =>
				toggle
					.setValue(st.ellipsis)
					.onChange(async (value) => {
						st.ellipsis = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(stList)
			.setName("Guillemets")
			.setDesc("<< and >> will be converted to « and »")
			.addToggle((toggle) =>
				toggle
					.setValue(st.guillemets)
					.onChange(async (value) => {
						st.guillemets = value;
						await this.plugin.saveSettings();
						this.toggleVisibility(guillemetCharsEl, value);
					})
			);
		const guillemetCharsEl = stList.createDiv({
			cls: "quasar-utilities-st-char-fields",
		});
		new Setting(guillemetCharsEl)
			.setName("Open guillemet")
			.addText((text) =>
				text
					.setValue(st.openGuillemet)
					.onChange(async (value) => {
						if (!value) return;
						st.openGuillemet = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(guillemetCharsEl)
			.setName("Close guillemet")
			.addText((text) =>
				text
					.setValue(st.closeGuillemet)
					.onChange(async (value) => {
						if (!value) return;
						st.closeGuillemet = value;
						await this.plugin.saveSettings();
					})
			);
		this.toggleVisibility(guillemetCharsEl, st.guillemets);

		new Setting(stList)
			.setName("Arrows")
			.setDesc("<- and -> will be converted to ← and →")
			.addToggle((toggle) =>
				toggle
					.setValue(st.arrows)
					.onChange(async (value) => {
						st.arrows = value;
						await this.plugin.saveSettings();
						this.toggleVisibility(arrowCharsEl, value);
					})
			);
		const arrowCharsEl = stList.createDiv({
			cls: "quasar-utilities-st-char-fields",
		});
		new Setting(arrowCharsEl)
			.setName("Left arrow")
			.addText((text) =>
				text
					.setValue(st.leftArrow)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.leftArrow = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(arrowCharsEl)
			.setName("Right arrow")
			.addText((text) =>
				text
					.setValue(st.rightArrow)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.rightArrow = value;
						await this.plugin.saveSettings();
					})
			);
		this.toggleVisibility(arrowCharsEl, st.arrows);

		new Setting(stList)
			.setName("Comparisons")
			.setDesc("<=, >=, and /= will be converted to ≤, ≥, and ≠")
			.addToggle((toggle) =>
				toggle
					.setValue(st.comparisons)
					.onChange(async (value) => {
						st.comparisons = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(stList)
			.setName("Fractions")
			.setDesc(
				"1/2, 1/3, 1/4, etc. will be converted to ½, ⅓, ¼, and other fraction symbols."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(st.fractions)
					.onChange(async (value) => {
						st.fractions = value;
						await this.plugin.saveSettings();
					})
			);
	}

	private toggleVisibility(el: HTMLElement, show: boolean): void {
		if (show) el.show();
		else el.hide();
	}

	private addQuoteCharSettings(
		container: HTMLElement,
		st: import("./types").SmartTypographySettings
	): void {
		new Setting(container)
			.setName("Open double quote")
			.addText((text) =>
				text
					.setValue(st.openDouble)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.openDouble = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(container)
			.setName("Close double quote")
			.addText((text) =>
				text
					.setValue(st.closeDouble)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.closeDouble = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(container)
			.setName("Open single quote")
			.addText((text) =>
				text
					.setValue(st.openSingle)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.openSingle = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(container)
			.setName("Close single quote")
			.addText((text) =>
				text
					.setValue(st.closeSingle)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.closeSingle = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

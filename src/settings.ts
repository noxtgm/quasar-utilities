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

		const settingsList = containerEl.createDiv({ cls: "quasar-utilities-settings-list" });

		new Setting(settingsList)
			.setName("Show settings button (Desktop)")
			.setDesc("Show a button in the workspace header that opens Obsidian settings.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showSettingsButton)
					.onChange(async (value) => {
						this.plugin.settings.showSettingsButton = value;
						await this.plugin.saveSettings();
						this.plugin.refreshSettingsButton();
					})
			);
	}
}

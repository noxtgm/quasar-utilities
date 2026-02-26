import { Plugin, Platform, setIcon } from "obsidian";
import type { QuasarUtilitiesSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { QuasarUtilitiesSettingTab } from "./settings";
import {
	buildInputRules,
	createSmartTypographyExtension,
	type SmartTypographyState,
} from "./typography/extension";

export default class QuasarUtilitiesPlugin extends Plugin {
	settings: QuasarUtilitiesSettings = { ...DEFAULT_SETTINGS };
	private settingsButtonEl: HTMLElement | null = null;
	private smartTypographyState: SmartTypographyState = {
		inputRules: [],
		inputRuleMap: {},
	};

	async onload(): Promise<void> {
		await this.loadSettings();

		this.buildSmartTypographyRules();
		this.registerEditorExtension(
			createSmartTypographyExtension({
				getSettings: () => this.settings.smartTypography,
				getInputRuleMap: () => this.smartTypographyState.inputRuleMap,
			})
		);

		this.app.workspace.onLayoutReady(() => {
			this.refreshSettingsButton();
		});

		this.addSettingTab(new QuasarUtilitiesSettingTab(this.app, this));
	}

	onunload(): void {
		this.settingsButtonEl?.remove();
	}

	buildSmartTypographyRules(): void {
		this.smartTypographyState = buildInputRules(
			this.settings.smartTypography
		);
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
	}

	async saveSettings(): Promise<void> {
		this.buildSmartTypographyRules();
		await this.saveData(this.settings);
	}

	refreshSettingsButton(): void {
		this.settingsButtonEl?.remove();
		this.settingsButtonEl = null;
		if (this.settings.showSettingsButton) {
			this.addSettingsButton();
		}
	}

	private openSettings(): void {
		(this.app as { setting?: { open: () => void } }).setting?.open();
	}

	private addSettingsButton(): void {
		if (!Platform.isDesktopApp) return;

		const wrapper = createDiv({
			cls: "quasar-utilities-settings-btn-wrapper",
			attr: {
				"aria-label": "Open settings",
				"data-tooltip-position": "bottom",
			},
			title: "Open settings",
		});
		setIcon(wrapper, "settings");
		wrapper.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.openSettings();
		});
		document.body.appendChild(wrapper);
		this.settingsButtonEl = wrapper;
	}
}

interface WorkspaceWithLeftSplit {
	leftSplit?: { containerEl?: HTMLElement };
}

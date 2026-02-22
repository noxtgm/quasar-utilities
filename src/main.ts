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

		const leftSplit = (this.app.workspace as WorkspaceWithLeftSplit).leftSplit;
		if (!leftSplit?.containerEl) return;

		const tabContainer = leftSplit.containerEl.querySelector(
			".workspace-tab-header-container"
		) as HTMLElement | null;
		if (!tabContainer) return;

		const tabHeader = createDiv({
			cls: "workspace-tab-header quasar-utilities-settings-tab",
			attr: { "aria-label": "Open settings", "data-tooltip-position": "right" },
			title: "Open settings",
		});
		const inner = tabHeader.createDiv({ cls: "workspace-tab-header-inner" });
		const iconEl = inner.createDiv({ cls: "workspace-tab-header-inner-icon" });
		setIcon(iconEl, "settings");

		tabHeader.addEventListener("click", () => this.openSettings());

		const noteCreatorTab = tabContainer.querySelector(".note-creator-tab");
		if (noteCreatorTab?.nextSibling) {
			tabContainer.insertBefore(tabHeader, noteCreatorTab.nextSibling);
		} else {
			tabContainer.appendChild(tabHeader);
		}
		this.settingsButtonEl = tabHeader;
	}
}

interface WorkspaceWithLeftSplit {
	leftSplit?: { containerEl?: HTMLElement };
}

import type { App, TFile } from "obsidian";

// Opens the file in a new tab without moving focus off the current one
export function openFileInBackground(app: App, file: TFile): void {
	const previous = app.workspace.getMostRecentLeaf();
	const leaf = app.workspace.getLeaf("tab");
	void leaf.openFile(file, { active: false });
	if (previous && previous !== leaf) {
		app.workspace.setActiveLeaf(previous, { focus: false });
	}
}

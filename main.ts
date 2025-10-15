import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
	baseDir: string;
	ignorePeriodicNames: boolean;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    mySetting: 'default',
    baseDir: ''
	,ignorePeriodicNames: true
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();
        
		// Listen for newly created files so we can rename them to GUIDs when appropriate.
		// The listener always checks the current `settings.baseDir` so changes take effect immediately.
		this.registerEvent(this.app.vault.on('create', (file) => {
			// Defer to an async helper to keep parentheses simple
			(async () => {
				if (!(file instanceof TFile)) return;
				// Only proceed when a baseDir is configured and normalize it
				const baseDirSetting = this.settings.baseDir || '';
				const baseDir = baseDirSetting.trim().replace(/^\/+/g, '').replace(/\/+$/g, '');
				if (!baseDir) return;
				// Only care about files directly inside the configured folder
				const parts = file.path.split('/');
				const parentPath = parts.slice(0, -1).join('/');
				if (parentPath !== baseDir) return;
				// Only operate on markdown files
				if ((file as TFile).extension !== 'md') return;

				const filename = parts[parts.length - 1];
				const nameNoExt = filename.replace(/\.[^/.]+$/, '');
				const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
				if (guidRegex.test(nameNoExt)) return; // already a guid

				// Delay a short time so other plugins (e.g. Templater) can finish populating the new file.
				setTimeout(async () => {
					// Re-fetch the file by path to ensure it still exists and hasn't been renamed by someone else
					const f = this.app.vault.getAbstractFileByPath(file.path);
					if (!f || !(f instanceof TFile)) return;
					try {
						const content = await this.app.vault.read(f as TFile);
						// If templater tags are present, skip renaming to avoid interfering with templater workflows
						if (/<%[\s\S]*?%>/.test(content)) {
							console.log('Skipping GUID rename because templater-like tags were detected in', f.path);
							return;
						}

						// Determine an original title to check for periodic naming.
						// Prefer the filename (no extension); if the file has a title line we could parse that later.
						const originalTitle = nameNoExt;

						if (this.settings.ignorePeriodicNames) {
							let periodicMatch: string | null = null;
							if (/^Yearly/i.test(originalTitle)) periodicMatch = 'Yearly';
							else if (/^Quarterly/i.test(originalTitle)) periodicMatch = 'Quarterly';
							else if (/^Monthly/i.test(originalTitle)) periodicMatch = 'Monthly';
							else if (/^Weekly/i.test(originalTitle)) periodicMatch = 'Weekly';
							else if (/^Daily/i.test(originalTitle)) periodicMatch = 'Daily';
							else if (/^\d{4}$/.test(originalTitle)) periodicMatch = 'Yearly';
							else if (/^\d{4}-Q[1-4]$/.test(originalTitle)) periodicMatch = 'Quarterly';
							else if (/^\d{4}-\d{2}$/.test(originalTitle)) periodicMatch = 'Monthly';
							else if (/^\d{4}-W\d{2}$/.test(originalTitle)) periodicMatch = 'Weekly';
							else if (/^\d{4}-\d{2}-\d{2}$/.test(originalTitle)) periodicMatch = 'Daily';

							if (periodicMatch) {
								console.log('Skipping GUID rename for periodic note:', originalTitle, 'match=', periodicMatch);
								return;
							}
						}

						// Generate a GUID (prefer crypto.randomUUID when available)
						let guid = '';
						const g = (globalThis as unknown) as { crypto?: { randomUUID?: () => string } };
						if (g.crypto && typeof g.crypto.randomUUID === 'function') {
							guid = g.crypto.randomUUID();
						} else {
							guid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
								const r = Math.random() * 16 | 0;
								const v = c === 'x' ? r : (r & 0x3 | 0x8);
								return v.toString(16);
							});
						}

						const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
						const newPath = (baseDir ? baseDir + '/' : '') + guid + ext;
						try {
							await this.app.fileManager.renameFile(f as TFile, newPath);
							new Notice(`Renamed ${filename} → ${guid}${ext}`);
						} catch (err) {
							console.error('Failed to rename file to GUID:', err);
						}
					} catch (err) {
						console.error('Error reading file before GUID rename:', err);
					}
					}, 1500);
				})();
		}));

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Base directory')
			.setDesc('Path relative to the vault root to use as the base directory (e.g., "Folder/Subfolder"). Leave empty to use the vault root. This is the only place that files will be renamed.')
			.addText(text =>
				text
					.setPlaceholder('e.g. Folder')
					.setValue(this.plugin.settings.baseDir || '')
					.onChange(async (value) => {
						this.plugin.settings.baseDir = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Ignore periodic names')
			.setDesc('When enabled, notes whose title looks like Daily/Weekly/Monthly/etc. will not be renamed to GUIDs.')
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.ignorePeriodicNames)
					.onChange(async (value) => {
						this.plugin.settings.ignorePeriodicNames = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

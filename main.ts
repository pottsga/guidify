import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

// Remember to rename these classes and interfaces!

interface GuidifyPluginSettings {
	baseDirs: string;
}

const DEFAULT_SETTINGS: GuidifyPluginSettings = {
    baseDirs: ''
}
	
export default class GuidifyPlugin extends Plugin {
	settings: GuidifyPluginSettings;

	async onload() {
		await this.loadSettings();
        
		// Listen for newly created files so we can rename them to GUIDs when appropriate.
		// The listener always checks the current `settings.baseDirs` so changes take effect immediately.
		this.registerEvent(this.app.vault.on('create', (file) => {
			(async () => {
				if (!(file instanceof TFile)) return;
				// Parse and normalize all base directories from settings
				const baseDirsSetting = this.settings.baseDirs || '';
				const baseDirs = baseDirsSetting
					.split(',')
					.map(dir => dir.trim().replace(/^\/+/g, '').replace(/\/+$/g, ''))
					.filter(dir => dir.length > 0);
				if (baseDirs.length === 0) {
					new Notice('Guidify: No base directories specified. Please set at least one directory in the plugin settings.');
					return;
				}
				// Only care about files directly inside any of the configured folders
				const parts = file.path.split('/');
				const parentPath = parts.slice(0, -1).join('/');
				if (!baseDirs.includes(parentPath)) return;
				// Only operate on markdown files
				if ((file as TFile).extension !== 'md') return;

				const filename = parts[parts.length - 1];
				const nameNoExt = filename.replace(/\.[^/.]+$/, '');
				const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
				if (guidRegex.test(nameNoExt)) return; // already a guid

				setTimeout(async () => {
					const f = this.app.vault.getAbstractFileByPath(file.path);
					if (!f || !(f instanceof TFile)) return;
					try {
						const content = await this.app.vault.read(f as TFile);
						if (/<%[\s\S]*?%>/.test(content)) {
							console.log('Skipping GUID rename because templater-like tags were detected in', f.path);
							return;
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
						const newPath = (parentPath ? parentPath + '/' : '') + guid + ext;
						try {
							await this.app.fileManager.renameFile(f as TFile, newPath);
							new Notice(`Renamed ${filename} → ${guid}${ext}`);
						} catch (err) {
							console.error('Failed to rename file to GUID:', err);
						}
					} catch (err) {
						console.error('Error reading file before GUID rename:', err);
					}
				}, 100);
			})();
		}));

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GuidifySettingTab(this.app, this));

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

class GuidifySettingTab extends PluginSettingTab {
	plugin: GuidifyPlugin;

	constructor(app: App, plugin: GuidifyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Base directories for GUID renaming')
			.setDesc('Paths relative to the vault root to use as the base directories (e.g., "Folder/Subfolder"). Separate multiple directories with commas. These are the only places that files will be renamed.')
			.addText(text =>
				text
					.setPlaceholder('e.g. Folder1, Folder2')
					.setValue(this.plugin.settings.baseDirs || '')
					.onChange(async (value) => {
						this.plugin.settings.baseDirs = value.trim();
						await this.plugin.saveSettings();
					})
			);
	}
}

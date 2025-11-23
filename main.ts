import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

// Remember to rename these classes and interfaces!

import { GuidifySettings, DEFAULT_SETTINGS } from './settings';

export default class GuidifyPlugin extends Plugin {
	settings: GuidifySettings;

	getIgnoreRegexList(): RegExp[] {
		const raw = this.settings.ignorePatterns || '';
		const regexes: RegExp[] = [];
		raw.split(',').map(p => p.trim()).filter(Boolean).forEach(p => {
			try {
				regexes.push(new RegExp(p));
			} catch (e) {
				console.warn('Invalid ignore regex:', p, e);
			}
		});
		return regexes;
	}

	isIgnoredByPattern(filename: string): boolean {
		const regexList = this.getIgnoreRegexList();
		return regexList.some(re => re.test(filename));
	}

	async onload() {
		await this.loadSettings();
        
		// Listen for newly created files so we can rename them to GUIDs when appropriate.
		// The listener always checks the current `settings.baseDir` so changes take effect immediately.
		this.registerEvent(this.app.vault.on('create', (file) => {
			// Defer to an async helper to keep parentheses simple
			(async () => {
				if (!(file instanceof TFile)) {
					console.log('create: not a file, skipping', file);
					return;
				}
				// Only proceed when a baseDir is configured and normalize it
				const baseDirSetting = this.settings.baseDir || '';
				// Support CSV list of directories
				const baseDirs = baseDirSetting.split(',').map(d => d.trim().replace(/^\/+/g, '').replace(/\/+$/g, '')).filter(Boolean);
				if (baseDirs.length === 0) {
					console.log('create: no baseDirs configured, skipping', file.path);
					return;
				}
				// Only care about files directly inside any configured folder
				const parts = file.path.split('/');
				const parentPath = parts.slice(0, -1).join('/');
				if (!baseDirs.includes(parentPath)) {
					console.log('create: parentPath not in baseDirs, skipping', {path: file.path, parentPath, baseDirs});
					return;
				}
				// Only operate on markdown files
				if ((file as TFile).extension !== 'md') return;
				if ((file as TFile).extension !== 'md') {
					console.log('create: not md file, skipping', file.path);
					return;
				}

				const filename = parts[parts.length - 1];
				const nameNoExt = filename.replace(/\.[^/.]+$/, '');
				const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
				if (guidRegex.test(nameNoExt)) {
					console.log('create: name already a guid, skipping', filename);
					return; // already a guid
				}
				// Ignore files matching any ignore pattern
				if (this.isIgnoredByPattern(filename)) {
					console.log('create: filename matches ignore pattern, skipping', filename);
					return;
				}

				// Delay a short time so other plugins (e.g. Templater) can finish populating the new file.
				setTimeout(async () => {
					console.log('create: proceeding to possibly rename', {path: file.path, filename, parentPath});
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
						// Use parentPath (the matched baseDir) for the new path
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
					}, 1500);
				})();
		}));

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// Add command to rename the active file to a GUID
		this.addCommand({
			id: 'guidify-current-file',
			name: 'GUIDIFY current file',
			checkCallback: (checking) => {
				// Disable if baseDir is empty
				if (!this.settings.baseDir || this.settings.baseDir.trim() === '') return false;
				const file = this.app.workspace.getActiveFile?.() ?? (this.app.workspace.getActiveFile && this.app.workspace.getActiveFile());
				if (!file || !(file instanceof TFile)) return false;
				if (checking) return true;
				this.renameFileToGuid(file);
				return true;
			}
		});
		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async renameFileToGuid(file: TFile) {
		const parts = file.path.split('/');
		const filename = parts[parts.length - 1];
		const parentPath = parts.slice(0, -1).join('/');
		const nameNoExt = filename.replace(/\.[^/.]+$/, '');
		const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (guidRegex.test(nameNoExt)) {
			new Notice('File is already named as a GUID.');
			return;
		}
		try {
			const filename = parts[parts.length - 1];
			if (this.isIgnoredByPattern(filename)) {
				new Notice('File matches ignore pattern; skipping GUID rename.');
				return;
			}
			const content = await this.app.vault.read(file);
			if (/<%[\s\S]*?%>/.test(content)) {
				new Notice('File contains templater-like tags; skipping GUID rename.');
				return;
			}
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
			await this.app.fileManager.renameFile(file, newPath);
			new Notice(`Renamed ${filename} → ${guid}${ext}`);
		} catch (err) {
			console.error('Failed to rename file to GUID:', err);
			new Notice('Failed to rename file to GUID. See console for details.');
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: GuidifyPlugin;

	constructor(app: App, plugin: GuidifyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Base directory')
			.setDesc('Path relative to the vault root to use as the base directory (e.g., "Folder/Subfolder"). Can be a CSV list of folder names. If left empty, GUID renaming is disabled for safety.')
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
            .setName('Ignore patterns')
            .setDesc('CSV of regex patterns to ignore (e.g. ".*template.*,[0-9]{4}-.*"). Files matching any pattern will be ignored for GUID renaming.')
            .addText(text =>
                text
                    .setPlaceholder('e.g. ".*template.*,[0-9]{4}-.*"')
                    .setValue(this.plugin.settings.ignorePatterns || '')
                    .onChange(async (value) => {
                        this.plugin.settings.ignorePatterns = value.trim();
                        await this.plugin.saveSettings();
                    })
            );
	}
}

import { injectable, inject } from 'tsyringe';
import { Transport } from './transport';
import { TOKENS } from '../di/tokens';
import browser from '../utils/browser-polyfill';

export interface ObsidianRESTConfig {
	host: string;
	apiKey: string;
}

const DEFAULT_HOST = 'http://localhost:27123';

/**
 * Typed client for Obsidian REST API.
 * All calls go through the Transport (background script proxies to avoid CORS).
 */
@injectable()
export class ObsidianApiClient {
	constructor(@inject(TOKENS.Transport) private transport: Transport) {}

	async getConfig(): Promise<ObsidianRESTConfig> {
		const result = await browser.storage.sync.get('obsidian_rest_api');
		const config = (result.obsidian_rest_api || {}) as Record<string, string>;
		return {
			host: config.host || DEFAULT_HOST,
			apiKey: config.apiKey || '',
		};
	}

	async saveConfig(config: ObsidianRESTConfig): Promise<void> {
		await browser.storage.sync.set({ obsidian_rest_api: config });
	}

	async fetchNote(notePath: string): Promise<{ content: string; error?: string }> {
		const cfg = await this.getConfig();
		if (!cfg.apiKey) return { content: '', error: 'Obsidian REST API key not configured.' };

		try {
			const res = await this.transport.send('fetchObsidianNote', { ...cfg, notePath });
			if (res.error) return { content: '', error: res.error };
			return { content: res.content || '' };
		} catch (e) {
			return { content: '', error: `Failed to fetch note: ${this.errMsg(e)}` };
		}
	}

	async updateNote(notePath: string, content: string): Promise<{ success: boolean; error?: string }> {
		const cfg = await this.getConfig();
		if (!cfg.apiKey) return { success: false, error: 'Obsidian REST API key not configured.' };

		try {
			const res = await this.transport.send('updateObsidianNote', { ...cfg, notePath, content });
			if (res.error) return { success: false, error: res.error };
			return { success: true };
		} catch (e) {
			return { success: false, error: `Failed to update note: ${this.errMsg(e)}` };
		}
	}

	async deleteNote(notePath: string): Promise<{ success: boolean; error?: string }> {
		const cfg = await this.getConfig();
		if (!cfg.apiKey) return { success: false, error: 'Obsidian REST API key not configured.' };

		try {
			const res = await this.transport.send('deleteObsidianNote', { ...cfg, notePath });
			if (res.error) return { success: false, error: res.error };
			return { success: true };
		} catch (e) {
			return { success: false, error: `Failed to delete note: ${this.errMsg(e)}` };
		}
	}

	async searchTaggedNotes(): Promise<{ notes: { filename: string; tags: string[] }[]; error?: string }> {
		const cfg = await this.getConfig();
		if (!cfg.apiKey) return { notes: [], error: 'Obsidian REST API key not configured.' };

		try {
			const res = await this.transport.send('searchObsidianNotes', cfg);
			if (res.error) return { notes: [], error: res.error };
			return { notes: res.notes || [] };
		} catch (e) {
			return { notes: [], error: `Failed to fetch tagged notes: ${this.errMsg(e)}` };
		}
	}

	async listNotes(): Promise<{ notes: string[]; error?: string }> {
		const cfg = await this.getConfig();
		if (!cfg.apiKey) return { notes: [], error: 'Obsidian REST API key not configured.' };

		try {
			const res = await this.transport.send('listObsidianNotes', cfg);
			if (res.error) return { notes: [], error: res.error };
			return { notes: res.notes || [] };
		} catch (e) {
			return { notes: [], error: `Failed to list notes: ${this.errMsg(e)}` };
		}
	}

	async listDirectories(): Promise<{ directories: string[]; error?: string }> {
		const cfg = await this.getConfig();
		if (!cfg.apiKey) return { directories: [], error: 'Obsidian REST API key not configured.' };

		try {
			const res = await this.transport.send('listObsidianDirectories', cfg);
			if (res.error) return { directories: [], error: res.error };
			return { directories: res.directories || [] };
		} catch (e) {
			return { directories: [], error: `Failed to list directories: ${this.errMsg(e)}` };
		}
	}

	async isAvailable(): Promise<boolean> {
		const cfg = await this.getConfig();
		if (!cfg.apiKey) return false;

		try {
			const res = await this.transport.send('checkObsidianAvailable', cfg);
			return res?.available === true;
		} catch {
			return false;
		}
	}

	private errMsg(e: unknown): string {
		return e instanceof Error ? e.message : String(e);
	}
}

import browser from './browser-polyfill';

export interface ObsidianRESTConfig {
	host: string;
	apiKey: string;
}

const DEFAULT_HOST = 'http://localhost:27123';

// Get REST API config from storage
export async function getRESTConfig(): Promise<ObsidianRESTConfig> {
	const result = await browser.storage.sync.get('obsidian_rest_api');
	const config = (result.obsidian_rest_api || {}) as Record<string, string>;
	return {
		host: config.host || DEFAULT_HOST,
		apiKey: config.apiKey || '',
	};
}

// Save REST API config to storage
export async function saveRESTConfig(config: ObsidianRESTConfig): Promise<void> {
	await browser.storage.sync.set({ obsidian_rest_api: config });
}

// Fetch note content via background script proxy (avoids CORS issues)
export async function fetchNoteContent(
	notePath: string,
	config?: ObsidianRESTConfig
): Promise<{ content: string; error?: string }> {
	const cfg = config || await getRESTConfig();

	if (!cfg.apiKey) {
		return { content: '', error: 'Obsidian REST API key not configured. Install the Local REST API plugin and add your API key in settings.' };
	}

	try {
		const response = await browser.runtime.sendMessage({
			action: 'fetchObsidianNote',
			host: cfg.host,
			apiKey: cfg.apiKey,
			notePath,
		}) as { content?: string; error?: string };

		if (response && response.error) {
			return { content: '', error: response.error };
		}

		return { content: response?.content || '' };
	} catch (error) {
		return { content: '', error: `Failed to fetch note: ${error instanceof Error ? error.message : String(error)}` };
	}
}

// Check if Obsidian REST API is available
export async function isObsidianAvailable(config?: ObsidianRESTConfig): Promise<boolean> {
	const cfg = config || await getRESTConfig();
	if (!cfg.apiKey) return false;

	try {
		const response = await browser.runtime.sendMessage({
			action: 'checkObsidianAvailable',
			host: cfg.host,
			apiKey: cfg.apiKey,
		}) as { available?: boolean };
		return response?.available === true;
	} catch {
		return false;
	}
}

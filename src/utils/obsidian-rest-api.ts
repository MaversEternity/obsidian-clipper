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

// Fetch all notes that have tags via JsonLogic search
export async function fetchAllTaggedNotes(
	config?: ObsidianRESTConfig
): Promise<{ notes: { filename: string; tags: string[] }[]; error?: string }> {
	const cfg = config || await getRESTConfig();

	if (!cfg.apiKey) {
		return { notes: [], error: 'Obsidian REST API key not configured.' };
	}

	try {
		const response = await browser.runtime.sendMessage({
			action: 'searchObsidianNotes',
			host: cfg.host,
			apiKey: cfg.apiKey,
		}) as { notes?: { filename: string; tags: string[] }[]; error?: string };

		if (response && response.error) {
			return { notes: [], error: response.error };
		}

		return { notes: response?.notes || [] };
	} catch (error) {
		return { notes: [], error: `Failed to fetch tagged notes: ${error instanceof Error ? error.message : String(error)}` };
	}
}

// Update (overwrite) a note via REST API
export async function updateNoteContent(
	notePath: string,
	content: string,
	config?: ObsidianRESTConfig
): Promise<{ success: boolean; error?: string }> {
	const cfg = config || await getRESTConfig();

	if (!cfg.apiKey) {
		return { success: false, error: 'Obsidian REST API key not configured.' };
	}

	try {
		const response = await browser.runtime.sendMessage({
			action: 'updateObsidianNote',
			host: cfg.host,
			apiKey: cfg.apiKey,
			notePath,
			content,
		}) as { success?: boolean; error?: string };

		if (response && response.error) {
			return { success: false, error: response.error };
		}

		return { success: true };
	} catch (error) {
		return { success: false, error: `Failed to update note: ${error instanceof Error ? error.message : String(error)}` };
	}
}

// Delete a note via REST API
export async function deleteNote(
	notePath: string,
	config?: ObsidianRESTConfig
): Promise<{ success: boolean; error?: string }> {
	const cfg = config || await getRESTConfig();

	if (!cfg.apiKey) {
		return { success: false, error: 'Obsidian REST API key not configured.' };
	}

	try {
		const response = await browser.runtime.sendMessage({
			action: 'deleteObsidianNote',
			host: cfg.host,
			apiKey: cfg.apiKey,
			notePath,
		}) as { success?: boolean; error?: string };

		if (response && response.error) {
			return { success: false, error: response.error };
		}

		return { success: true };
	} catch (error) {
		return { success: false, error: `Failed to delete note: ${error instanceof Error ? error.message : String(error)}` };
	}
}

// List all note files in vault
export async function fetchVaultNotes(
	config?: ObsidianRESTConfig
): Promise<{ notes: string[]; error?: string }> {
	const cfg = config || await getRESTConfig();

	if (!cfg.apiKey) {
		return { notes: [], error: 'Obsidian REST API key not configured.' };
	}

	try {
		const response = await browser.runtime.sendMessage({
			action: 'listObsidianNotes',
			host: cfg.host,
			apiKey: cfg.apiKey,
		}) as { notes?: string[]; error?: string };

		if (response && response.error) {
			return { notes: [], error: response.error };
		}

		return { notes: response?.notes || [] };
	} catch (error) {
		return { notes: [], error: `Failed to list notes: ${error instanceof Error ? error.message : String(error)}` };
	}
}

// List top-level vault directories
export async function fetchVaultDirectories(
	config?: ObsidianRESTConfig
): Promise<{ directories: string[]; error?: string }> {
	const cfg = config || await getRESTConfig();

	if (!cfg.apiKey) {
		return { directories: [], error: 'Obsidian REST API key not configured.' };
	}

	try {
		const response = await browser.runtime.sendMessage({
			action: 'listObsidianDirectories',
			host: cfg.host,
			apiKey: cfg.apiKey,
		}) as { directories?: string[]; error?: string };

		if (response && response.error) {
			return { directories: [], error: response.error };
		}

		return { directories: response?.directories || [] };
	} catch (error) {
		return { directories: [], error: `Failed to list directories: ${error instanceof Error ? error.message : String(error)}` };
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

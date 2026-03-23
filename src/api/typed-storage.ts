import browser from '../utils/browser-polyfill';

/**
 * Typed storage schema — single source of truth for all storage keys.
 * Add new keys here to get type-safe get/set everywhere.
 */

export interface SyncStorageSchema {
	vaults: string[];
	general_settings: {
		showMoreActionsButton?: boolean;
		betaFeatures?: boolean;
		legacyMode?: boolean;
		silentOpen?: boolean;
		openBehavior?: 'popup' | 'embedded' | boolean;
		saveBehavior?: 'copyToClipboard' | 'addToObsidian' | 'both' | 'draft';
		highlighterEnabled?: boolean;
		highlightBehavior?: string;
		lookupEnabled?: boolean;
		lookupBlacklistTags?: string[];
		lookupBlacklistDomains?: string[];
	};
	obsidian_rest_api: {
		host: string;
		apiKey: string;
	};
	template_list: string[];
	[key: `template_${string}`]: unknown;
}

export interface LocalStorageSchema {
	activeContext: string;
	highlights: Record<string, unknown>;
	debugMode: boolean;
	pdfInterceptEnabled: boolean;
	pendingNotePreview: {
		notePath?: string;
		noteContent?: string;
		currentUrl?: string;
	};
	clipHistory: unknown[];
}

/** Type-safe get from sync storage */
export async function syncGet<K extends keyof SyncStorageSchema>(
	key: K
): Promise<SyncStorageSchema[K] | undefined> {
	const result = await browser.storage.sync.get(key);
	return result[key] as SyncStorageSchema[K] | undefined;
}

/** Type-safe set to sync storage */
export async function syncSet<K extends keyof SyncStorageSchema>(
	key: K,
	value: SyncStorageSchema[K]
): Promise<void> {
	await browser.storage.sync.set({ [key]: value });
}

/** Type-safe get from local storage */
export async function localGet<K extends keyof LocalStorageSchema>(
	key: K
): Promise<LocalStorageSchema[K] | undefined> {
	const result = await browser.storage.local.get(key);
	return result[key] as LocalStorageSchema[K] | undefined;
}

/** Type-safe set to local storage */
export async function localSet<K extends keyof LocalStorageSchema>(
	key: K,
	value: LocalStorageSchema[K]
): Promise<void> {
	await browser.storage.local.set({ [key]: value });
}

/**
 * Typed message definitions for all cross-context communication.
 * Each key is an action name. Request/Response types enforce contracts
 * between content scripts, background, and popup.
 */

import { LookupMatch } from '../lookup-client';

export interface MessageMap {
	// Lookup
	lookupMatch: { request: { text: string }; response: LookupMatch[] };
	refreshLookup: { request: void; response: void };
	refreshCrossSiteMatches: { request: void; response: void };

	// Tab management
	getActiveTab: { request: void; response: { tabId?: number; error?: string } };
	getTabInfo: { request: { tabId: number }; response: { success?: boolean; tab?: { id: number; url: string }; error?: string } };
	ping: { request: void; response: boolean };

	// Content
	getPageContent: { request: Record<string, unknown>; response: Record<string, unknown> };
	contentPicked: { request: { markdown: string }; response: void };
	copyMarkdownToClipboard: { request: void; response: { success: boolean; error?: string } };

	// Highlighter
	toggleContentPicker: { request: { enabled: boolean }; response: void };
	updatePopupHighlighterUI: { request: { isActive: boolean }; response: void };
	linkHighlightsToNote: { request: { noteRef: string }; response: void };
	copyToClipboard: { request: void; response: void };

	// Side panel / popup
	sidePanelOpened: { request: void; response: void };
	sidePanelClosed: { request: void; response: void };
	openOptionsPage: { request: void; response: void };
	openBookViewer: { request: void; response: void };
	triggerQuickClip: { request: void; response: void };

	// Reader
	toggleReaderMode: { request: void; response: void };

	// Iframe
	'toggle-iframe': { request: void; response: void };
	getActiveTabAndToggleIframe: { request: void; response: { success?: boolean; error?: string } };

	// Obsidian API
	sendMessageToTab: { request: { tabId: number; message: Record<string, unknown> }; response: unknown };
	updateObsidianNote: { request: { path: string; content: string }; response: { success: boolean; error?: string } };
	searchObsidianNotes: {
		request: { host: string; apiKey: string };
		response: { notes?: { filename: string; tags: string[] }[]; error?: string };
	};
	fetchObsidianNote: { request: { path: string }; response: { content: string; error?: string } };
	fetchVaultNotes: { request: void; response: { files?: string[]; error?: string } };
}

/** Extract action names */
export type MessageAction = keyof MessageMap;

import browser from './browser-polyfill';

let currentActiveTabId: number | undefined;
let currentWindowId: number | undefined;

export function isExtensionPage(url: string | undefined): boolean {
	if (!url) return false;
	const extOrigin = browser.runtime.getURL('');
	return url.startsWith(extOrigin);
}

export function isBookViewerPage(url: string | undefined): boolean {
	if (!url) return false;
	return url.startsWith(browser.runtime.getURL('book-viewer.html'));
}

export async function updateCurrentActiveTab(windowId: number) {
	const tabs = await browser.tabs.query({ active: true, windowId: windowId });
	if (tabs[0] && tabs[0].id && tabs[0].url) {
		currentActiveTabId = tabs[0].id;
		currentWindowId = windowId;
		browser.runtime.sendMessage({
			action: "activeTabChanged",
			tabId: currentActiveTabId,
			url: tabs[0].url,
			isValidUrl: isValidUrl(tabs[0].url),
			isBlankPage: isBlankPage(tabs[0].url),
			isExtensionPage: isExtensionPage(tabs[0].url),
			isBookViewerPage: isBookViewerPage(tabs[0].url)
		});
	}
}

export function isValidUrl(url: string | undefined): boolean {
	if (!url) return false;
	return url.startsWith('http://') ||
		   url.startsWith('https://') ||
		   url.startsWith('file:///');
}

export function isBlankPage(url: string): boolean {
	return url === 'about:blank' || url === 'chrome://newtab/' || url === 'edge://newtab/';
}
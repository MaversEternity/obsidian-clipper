import * as pdfjsLib from 'pdfjs-dist';
import { PDFPageView, EventBus } from 'pdfjs-dist/web/pdf_viewer.mjs';
import browser from './utils/browser-polyfill';
import * as lookup from './utils/lookup';
import { handleCrossSiteClick, setContentPickerMode } from './utils/highlighter-overlays';
import * as highlighter from './utils/highlighter';
import { loadSettings, generalSettings } from './utils/storage-utils';

// Set worker path to bundled worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('pdf.worker.min.mjs');

// Parse PDF date format (D:YYYYMMDDHHmmSS) to ISO string
function parsePdfDate(pdfDate: string): string {
	if (!pdfDate) return '';
	const match = pdfDate.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
	if (!match) return pdfDate;
	const [, y, m, d, h = '00', min = '00', s = '00'] = match;
	return `${y}-${m}-${d}T${h}:${min}:${s}`;
}

interface PdfMetadata {
	title: string;
	author: string;
	subject: string;
	keywords: string;
	creator: string;
	producer: string;
	creationDate: string;
	modDate: string;
}

interface ViewerState {
	pdf: pdfjsLib.PDFDocumentProxy | null;
	currentPage: number;
	totalPages: number;
	scale: number;
	fileName: string;
	rendering: boolean;
	metadata: PdfMetadata;
}

const state: ViewerState = {
	pdf: null,
	currentPage: 1,
	totalPages: 0,
	scale: 1.5,
	fileName: '',
	rendering: false,
	metadata: { title: '', author: '', subject: '', keywords: '', creator: '', producer: '', creationDate: '', modDate: '' },
};

const viewer = document.getElementById('viewer')!;
const viewerContainer = document.getElementById('viewer-container')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const openFileBtn = document.getElementById('open-file-btn')!;
const prevPageBtn = document.getElementById('prev-page') as HTMLButtonElement;
const nextPageBtn = document.getElementById('next-page') as HTMLButtonElement;
const pageInfo = document.getElementById('page-info')!;
const zoomInBtn = document.getElementById('zoom-in')!;
const zoomOutBtn = document.getElementById('zoom-out')!;
const zoomFitBtn = document.getElementById('zoom-fit')!;
const zoomLevel = document.getElementById('zoom-level')!;
const fileNameEl = document.getElementById('file-name')!;

openFileBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
	const file = (e.target as HTMLInputElement).files?.[0];
	if (!file) return;

	state.fileName = file.name;
	fileNameEl.textContent = file.name;
	document.title = `${file.name} - Book Viewer`;

	const arrayBuffer = await file.arrayBuffer();
	await loadPdf(new Uint8Array(arrayBuffer));
});

// Auto-load PDF from URL param (e.g., ?url=file:///path/to/book.pdf)
async function loadFromUrlParam() {
	const params = new URLSearchParams(window.location.search);
	const pdfUrl = params.get('url');
	if (!pdfUrl) return;

	const fileName = decodeURIComponent(pdfUrl.split('/').pop() || 'document.pdf');
	state.fileName = fileName;
	fileNameEl.textContent = fileName;
	document.title = `${fileName} - Book Viewer`;

	try {
		const response = await fetch(pdfUrl);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const arrayBuffer = await response.arrayBuffer();
		await loadPdf(new Uint8Array(arrayBuffer));
	} catch (err) {
		console.error('Failed to fetch PDF from URL:', err);
		viewer.innerHTML = `<div class="error-message">Failed to load PDF: ${(err as Error).message}</div>`;
	}
}

loadFromUrlParam();

async function loadPdf(data: Uint8Array) {
	try {
		state.pdf = await pdfjsLib.getDocument({
			data,
			cMapUrl: browser.runtime.getURL('cmaps/'),
			cMapPacked: true,
			standardFontDataUrl: browser.runtime.getURL('standard_fonts/'),
			useSystemFonts: false,
		}).promise;

		state.totalPages = state.pdf.numPages;
		state.currentPage = 1;

		// Extract PDF metadata
		const meta = await state.pdf.getMetadata();
		const info = (meta?.info || {}) as Record<string, any>;
		state.metadata = {
			title: info.Title || '',
			author: info.Author || '',
			subject: info.Subject || '',
			keywords: info.Keywords || '',
			creator: info.Creator || '',
			producer: info.Producer || '',
			creationDate: parsePdfDate(info.CreationDate || ''),
			modDate: parsePdfDate(info.ModDate || ''),
		};

		updateControls();
		await renderAllPages();
	} catch (err) {
		console.error('Failed to load PDF:', err);
		viewer.innerHTML = `<div class="error-message">Failed to load PDF: ${(err as Error).message}</div>`;
	}
}

const eventBus = new EventBus();
const pageViews: PDFPageView[] = [];
const renderedPages = new Set<number>();
const RENDER_BUFFER = 2; // render pages within 2 pages of viewport

async function renderAllPages() {
	if (!state.pdf || state.rendering) return;
	state.rendering = true;

	viewer.innerHTML = '';
	pageViews.length = 0;
	renderedPages.clear();

	// Create placeholder divs for all pages (just sized containers)
	for (let pageNum = 1; pageNum <= state.totalPages; pageNum++) {
		const pdfPage = await state.pdf.getPage(pageNum);
		const viewport = pdfPage.getViewport({ scale: state.scale });

		const pageView = new PDFPageView({
			container: viewer as HTMLDivElement,
			id: pageNum,
			scale: state.scale,
			defaultViewport: viewport,
			eventBus,
			textLayerMode: 1, // TextLayerMode.ENABLE
			annotationMode: 0, // AnnotationMode.DISABLE
		});

		pageView.setPdfPage(pdfPage);
		pageViews.push(pageView);

		pageView.div.dataset.pageNumber = String(pageNum);
	}

	state.rendering = false;

	// Render visible pages, fetch tags + set up scroll-based marking
	await renderVisiblePages();
	await loadSettings();
	if (generalSettings.lookupEnabled) {
		await lookup.mark(viewer, handleCrossSiteClick, viewerContainer);
	}
}

async function renderVisiblePages() {
	const containerRect = viewerContainer.getBoundingClientRect();

	for (let i = 0; i < pageViews.length; i++) {
		const pageNum = i + 1;
		const div = pageViews[i].div;
		const rect = div.getBoundingClientRect();

		// Check if page is within buffer zone of viewport
		const isNearViewport =
			rect.bottom > containerRect.top - containerRect.height * RENDER_BUFFER &&
			rect.top < containerRect.bottom + containerRect.height * RENDER_BUFFER;

		if (isNearViewport && !renderedPages.has(pageNum)) {
			renderedPages.add(pageNum);
			await pageViews[i].draw();
		}
	}
}

// Debounced scroll handler for lazy rendering
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

function updateControls() {
	pageInfo.textContent = `${state.totalPages} pages`;
	prevPageBtn.disabled = state.currentPage <= 1;
	nextPageBtn.disabled = state.currentPage >= state.totalPages;
	zoomLevel.textContent = `${Math.round(state.scale * 100)}%`;
}

// Scroll-based page tracking + lazy rendering
viewerContainer.addEventListener('scroll', () => {
	if (!state.pdf) return;

	// Update current page indicator
	const containerRect = viewerContainer.getBoundingClientRect();
	const centerY = containerRect.top + containerRect.height / 2;

	let closestPage = 1;
	let closestDist = Infinity;

	for (const pv of pageViews) {
		const rect = pv.div.getBoundingClientRect();
		const dist = Math.abs(rect.top + rect.height / 2 - centerY);
		if (dist < closestDist) {
			closestDist = dist;
			closestPage = pv.id;
		}
	}

	if (closestPage !== state.currentPage) {
		state.currentPage = closestPage;
		updateControls();
	}

	// Lazy render nearby pages (debounced)
	if (scrollTimeout) clearTimeout(scrollTimeout);
	scrollTimeout = setTimeout(() => renderVisiblePages(), 150);
});

// Navigation
prevPageBtn.addEventListener('click', () => {
	if (state.currentPage > 1) {
		state.currentPage--;
		scrollToPage(state.currentPage);
		updateControls();
	}
});

nextPageBtn.addEventListener('click', () => {
	if (state.currentPage < state.totalPages) {
		state.currentPage++;
		scrollToPage(state.currentPage);
		updateControls();
	}
});

function scrollToPage(pageNum: number) {
	const page = viewer.querySelector(`.page[data-page-number="${pageNum}"]`);
	if (page) {
		page.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
}

// Zoom
zoomInBtn.addEventListener('click', () => setZoom(state.scale + 0.25));
zoomOutBtn.addEventListener('click', () => setZoom(state.scale - 0.25));
zoomFitBtn.addEventListener('click', () => {
	if (!state.pdf) return;
	// Calculate fit-to-width scale
	const containerWidth = viewerContainer.clientWidth - 40; // padding
	state.pdf.getPage(1).then(page => {
		const viewport = page.getViewport({ scale: 1 });
		setZoom(containerWidth / viewport.width);
	});
});

async function setZoom(newScale: number) {
	newScale = Math.max(0.5, Math.min(4, newScale));
	if (newScale === state.scale) return;

	state.scale = newScale;
	zoomLevel.textContent = `${Math.round(state.scale * 100)}%`;

	const scrollRatio = viewerContainer.scrollTop / (viewerContainer.scrollHeight || 1);

	// Update viewport for all pages, only re-draw visible ones
	renderedPages.clear();
	for (const pageView of pageViews) {
		pageView.update({ scale: newScale });
	}

	viewerContainer.scrollTop = scrollRatio * viewerContainer.scrollHeight;
	await renderVisiblePages();
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
	if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
		prevPageBtn.click();
	} else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
		nextPageBtn.click();
	} else if (e.key === '+' || e.key === '=') {
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			zoomInBtn.click();
		}
	} else if (e.key === '-') {
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			zoomOutBtn.click();
		}
	}
});

// Get this tab's ID for message filtering
let thisTabId: number | null = null;
browser.runtime.sendMessage({ action: 'getActiveTab' }).then((resp: any) => {
	if (resp?.tabId) thisTabId = resp.tabId;
});

// Handle messages from side panel and background script
// IMPORTANT: Only handle messages explicitly meant for book-viewer.
// Returning undefined for unrecognized messages lets other listeners (background) handle them.
browser.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (response?: any) => void): true | undefined => {
	// Only handle messages with _targetTabId matching this tab, or book-viewer-specific actions
	const isTargetedToMe = message._targetTabId && message._targetTabId === thisTabId;
	const isBookViewerAction = message.action === 'openPdfFile' || message.action === 'ping' || message.action === 'toggleContentPicker' || message.action === 'toggleReaderMode';

	if (!isTargetedToMe && !isBookViewerAction) {
		return undefined; // Let other listeners handle
	}

	if (message.action === 'openPdfFile' && message.data) {
		state.fileName = message.fileName || 'document.pdf';
		fileNameEl.textContent = state.fileName;
		document.title = `${state.fileName} - Book Viewer`;
		loadPdf(new Uint8Array(message.data));
		return undefined;
	}

	if (message.action === 'ping') {
		sendResponse({ pong: true });
		return undefined;
	}

	if (message.action === 'toggleReaderMode') {
		// Reader mode is not supported in book-viewer — it already IS a reader
		sendResponse({ success: false, error: 'Reader mode is not available for the PDF viewer' });
		return undefined;
	}

	if (message.action === 'toggleContentPicker') {
		setContentPickerMode(message.enabled);
		highlighter.toggleHighlighterMenu(message.enabled);
		sendResponse({ success: true });
		return undefined;
	}

	if (message.action === 'getPageContent') {
		// Get selected text
		let selectedHtml = '';
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
			const range = selection.getRangeAt(0);
			const div = document.createElement('div');
			div.appendChild(range.cloneContents());
			selectedHtml = div.innerHTML;
		}

		// Extract visible text from rendered text layers
		const textLayers = viewer.querySelectorAll('.textLayer');
		let fullText = '';
		textLayers.forEach(layer => {
			const spans = layer.querySelectorAll('span[role="presentation"]');
			spans.forEach(span => {
				fullText += (span.textContent || '') + ' ';
			});
			fullText += '\n\n';
		});

		// Get the original PDF URL if loaded via redirect
		const params = new URLSearchParams(window.location.search);
		const originalUrl = params.get('url') || window.location.href;

		const response = {
			author: state.metadata.author,
			content: `<div>${fullText}</div>`,
			description: state.metadata.subject,
			domain: '',
			extractedContent: {},
			favicon: '',
			fullHtml: document.documentElement.outerHTML,
			highlights: [],
			image: '',
			language: '',
			parseTime: 0,
			published: state.metadata.creationDate,
			schemaOrgData: null,
			selectedHtml,
			site: state.metadata.creator,
			title: state.metadata.title || state.fileName || document.title,
			wordCount: fullText.split(/\s+/).filter(Boolean).length,
			metaTags: [],
			// Book-viewer specific
			currentPage: state.currentPage,
			totalPages: state.totalPages,
			sourceUrl: originalUrl,
		};

		sendResponse(response);
		return undefined;
	}

	if (message.action === 'extractContent') {
		const content = message.selector
			? document.querySelector(message.selector)?.textContent || ''
			: '';
		sendResponse({ content });
		return undefined;
	}

	return undefined;
});

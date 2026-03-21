import * as pdfjsLib from 'pdfjs-dist';
import { PDFPageView, EventBus } from 'pdfjs-dist/web/pdf_viewer.mjs';
import browser from './utils/browser-polyfill';
import Mark from 'mark.js';
import { getFilteredTagEntries } from './utils/cross-site-matcher';
import { handleCrossSiteClick } from './utils/highlighter-overlays';

// Set worker path to bundled worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('pdf.worker.min.mjs');

interface ViewerState {
	pdf: pdfjsLib.PDFDocumentProxy | null;
	currentPage: number;
	totalPages: number;
	scale: number;
	fileName: string;
	rendering: boolean;
}

const state: ViewerState = {
	pdf: null,
	currentPage: 1,
	totalPages: 0,
	scale: 1.5,
	fileName: '',
	rendering: false,
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

	// Render visible pages + apply cross-site matching
	await renderVisiblePages();
	await applyCrossSiteMatches();
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

// Cross-site matching — runs directly since content scripts can't inject into extension pages
let markInstance: Mark | null = null;

async function applyCrossSiteMatches() {
	if (markInstance) {
		markInstance.unmark();
		markInstance = null;
	}

	try {
		const tagEntries = await getFilteredTagEntries();
		if (tagEntries.size === 0) return;

		markInstance = new Mark(viewer);

		for (const [tag, entries] of tagEntries) {
			markInstance.mark(tag, {
				element: 'note-match',
				className: '',
				separateWordSearch: false,
				acrossElements: true,
				caseSensitive: false,
				accuracy: {
					value: 'exactly',
					limiters: [',', '.', '!', '?', ':', ';'],
				},
				exclude: ['.canvasWrapper'],
				filter: (textNode: Text) => {
					const parent = textNode.parentElement;
					if (parent && parent.closest('note-match')) return false;
					return true;
				},
				each: (element: HTMLElement) => {
					if (!element.shadowRoot) {
						const shadow = element.attachShadow({ mode: 'open' });
						shadow.innerHTML = '<style>:host{background:rgba(100,180,255,.2);border-bottom:2px solid rgba(100,180,255,.7);border-radius:2px;cursor:pointer;padding:1px 0}</style><slot></slot>';
					}
					element.addEventListener('click', (e) => {
						e.stopPropagation();
						e.preventDefault();
						const rect = element.getBoundingClientRect();
						handleCrossSiteClick(entries, rect);
					});
				},
			});
		}
	} catch (e) {
		console.warn('Cross-site matching failed in book viewer:', e);
	}
}

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

// Handle message from side panel to open a file
browser.runtime.onMessage.addListener((message: any) => {
	if (message.action === 'openPdfFile' && message.data) {
		state.fileName = message.fileName || 'document.pdf';
		fileNameEl.textContent = state.fileName;
		document.title = `${state.fileName} - Book Viewer`;
		loadPdf(new Uint8Array(message.data));
	}
	return undefined;
});

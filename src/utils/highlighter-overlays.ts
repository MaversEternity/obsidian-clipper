import {
	handleTextSelection,
	highlightElement,
	AnyHighlightData,
	highlights,
	isApplyingHighlights,
	sortHighlights,
	applyHighlights,
	saveHighlights,
	updateHighlights,
	updateHighlighterMenu,
	getHighlightByIndex,
	updateHighlightTags,
} from './highlighter';
import { throttle } from './throttle';
import { getElementByXPath, isDarkColor } from './dom-utils';
import { TagIndexEntry } from './highlight-tag-index';
import { showNotePopup } from './highlight-note-popup';
import { fetchNoteContent } from './obsidian-rest-api';
import browser from './browser-polyfill';

let hoverOverlay: HTMLElement | null = null;
let touchStartX: number = 0;
let touchStartY: number = 0;
let isTouchMoved: boolean = false;
let lastHoverTarget: Element | null = null;
let contentPickerMode: boolean = false;

export function setContentPickerMode(enabled: boolean) {
	contentPickerMode = enabled;
}

export function isContentPickerActive(): boolean {
	return contentPickerMode;
}

const LINE_BY_LINE_OVERLAY_TAGS = ['P'];

// Check if an element should be ignored for highlighting
function isIgnoredElement(element: Element): boolean {
	const tagName = element.tagName.toUpperCase();
	const isDisallowedTag = ![
		'SPAN', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
		'MATH', 'FIGURE', 'UL', 'OL', 'TABLE', 'LI', 'TR', 'TD', 'TH', 'CODE', 'PRE', 'BLOCKQUOTE', 'EM', 'STRONG', 'A'
	].includes(tagName);

	return element.tagName.toLowerCase() === 'html' || 
		element.tagName.toLowerCase() === 'body' || 
		element.classList.contains('obsidian-highlighter-menu') ||
		element.closest('.obsidian-highlighter-menu') !== null ||
		isDisallowedTag;
}

// Handles mouse move events for hover effects
export function handleMouseMove(event: MouseEvent | TouchEvent) {
	let target: Element;
	if (event instanceof MouseEvent) {
		target = event.target as Element;
	} else {
		// Touch event
		const touch = event.changedTouches[0];
		target = document.elementFromPoint(touch.clientX, touch.clientY) as Element;
	}

	if (!isIgnoredElement(target)) {
		createOrUpdateHoverOverlay(target);
	} else {
		removeHoverOverlay();
	}
}

// Handle mouse up events for highlighting
export function handleMouseUp(event: MouseEvent | TouchEvent) {
	let target: Element;
	if (event instanceof MouseEvent) {
		target = event.target as Element;
	} else {
		// Touch event
		if (isTouchMoved) {
			isTouchMoved = false;
			return; // Don't highlight if the touch moved (scrolling)
		}
		const touch = event.changedTouches[0];
		target = document.elementFromPoint(touch.clientX, touch.clientY) as Element;
	}

	const selection = window.getSelection();

	if (contentPickerMode) {
		// In picker mode, send text to popup instead of highlighting
		let text = '';
		if (selection && !selection.isCollapsed) {
			text = selection.toString().trim();
			selection.removeAllRanges();
		} else {
			const block = target.closest('p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, td, th, figcaption, table');
			if (block) {
				text = (block.textContent || '').trim();
			}
		}
		if (text) {
			browser.runtime.sendMessage({ action: 'contentPicked', text });
		}
		return;
	}

	if (selection && !selection.isCollapsed) {
		handleTextSelection(selection);
	} else {
		if (target.classList.contains('obsidian-highlight-overlay')) {
			handleHighlightClick(event);
		} else {
			let elementToProcess: Element | null = target;
			const targetTagName = target.tagName.toUpperCase();

			if (['TD', 'TH', 'TR'].includes(targetTagName)) {
				elementToProcess = target.closest('table');
				if (!elementToProcess) {
					// Clicked table cell/row not in a table, so do nothing.
					return; 
				}
			} else {
				// Original target was not a table cell/row.
				// isIgnoredElement returns true if element is NOT allowed.
				if (isIgnoredElement(target)) {
					// If target is ignored, check its parent.
					if (target.parentElement && !isIgnoredElement(target.parentElement)) {
						elementToProcess = target.parentElement;
					} else {
						// Target is ignored, and parent is also ignored or doesn't exist.
						return;
					}
				}
				// If target was not ignored, elementToProcess remains target.
			}

			if (elementToProcess) {
				highlightElement(elementToProcess);
			}
		}
	}
}

// Add touch start handler
export function handleTouchStart(event: TouchEvent) {
	const touch = event.touches[0];
	touchStartX = touch.clientX;
	touchStartY = touch.clientY;
	isTouchMoved = false;
}

// Add touch move handler
export function handleTouchMove(event: TouchEvent) {
	const touch = event.touches[0];
	const moveThreshold = 10; // pixels

	if (Math.abs(touch.clientX - touchStartX) > moveThreshold ||
		Math.abs(touch.clientY - touchStartY) > moveThreshold) {
		isTouchMoved = true;
	}

	handleMouseMove(event);
}

// Update event listeners for highlight overlays
export function updateHighlightListeners() {
	document.querySelectorAll('.obsidian-highlight-overlay').forEach(highlight => {
		highlight.removeEventListener('click', handleHighlightClick);
		highlight.removeEventListener('touchend', handleHighlightClick);
		highlight.addEventListener('click', handleHighlightClick);
		highlight.addEventListener('touchend', handleHighlightClick);
	});
}

// Find a text node at a given offset within an element
function findTextNodeAtOffset(element: Element, offset: number): { node: Node, offset: number } | null {
	let currentOffset = 0;
	const treeWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	
	let node: Node | null = treeWalker.currentNode;
	while (node) {
		const nodeLength = node.textContent?.length || 0;
		if (currentOffset + nodeLength >= offset) {
			// Ensure offset is within bounds of the node
			const adjustedOffset = Math.min(Math.max(0, offset - currentOffset), nodeLength);
			return { node, offset: adjustedOffset };
		}
		currentOffset += nodeLength;
		node = treeWalker.nextNode();
	}
	
	// If we couldn't find the exact offset, return the first text node with offset 0
	const firstNode = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).firstChild();
	if (firstNode) {
		return { node: firstNode, offset: 0 };
	}
	
	return null;
}

// Calculate the average line height of a set of rectangles
function calculateAverageLineHeight(rects: DOMRectList): number {
	const heights = Array.from(rects).map(rect => rect.height);
	const sum = heights.reduce((a, b) => a + b, 0);
	return sum / heights.length;
}

function processRangeForOverlayRects(
	range: Range,
	content: string,
	existingOverlays: Element[],
	index: number,
	notes: string[] | undefined,
	targetElementForFallback: Element
) {
	const rects = range.getClientRects();

	if (rects.length === 0) {
		const rect = targetElementForFallback.getBoundingClientRect();
		mergeHighlightOverlayRects([rect], content, existingOverlays, false, index, notes);
		return;
	}

	const averageLineHeight = calculateAverageLineHeight(rects);
	const textRects = Array.from(rects).filter(rect => rect.height <= averageLineHeight * 1.5);
	const complexRects = Array.from(rects).filter(rect => rect.height > averageLineHeight * 1.5);

	if (textRects.length > 0) {
		mergeHighlightOverlayRects(textRects, content, existingOverlays, true, index, notes);
	}
	if (complexRects.length > 0) {
		mergeHighlightOverlayRects(complexRects, content, existingOverlays, false, index, notes);
	}
}

// Plan out the overlay rectangles depending on the type of highlight
export function planHighlightOverlayRects(target: Element, highlight: AnyHighlightData, index: number) {
	const existingOverlays = Array.from(document.querySelectorAll(`.obsidian-highlight-overlay[data-highlight-index="${index}"]`));
	const tagName = target.tagName.toUpperCase(); // Get tagName early for P check
	
	if (highlight.type === 'complex' || highlight.type === 'element') {
		if (LINE_BY_LINE_OVERLAY_TAGS.includes(tagName)) { // LINE_BY_LINE_OVERLAY_TAGS is now just ['P']
			const range = document.createRange();
			try {
				range.selectNodeContents(target);
				processRangeForOverlayRects(range, highlight.content, existingOverlays, index, highlight.notes, target);
			} catch (error) {
				console.error('Error creating line-by-line highlight for element:', target, error);
				const rect = target.getBoundingClientRect(); // Fallback
				mergeHighlightOverlayRects([rect], highlight.content, existingOverlays, false, index, highlight.notes);
			} finally {
				range.detach();
			}
		} else {
			// Original logic for other element/complex types (single box)
			const rect = target.getBoundingClientRect();
			mergeHighlightOverlayRects([rect], highlight.content, existingOverlays, false, index, highlight.notes);
		}
	} else if (highlight.type === 'text') {
		const range = document.createRange();
		try {
			const startNodeResult = findTextNodeAtOffset(target, highlight.startOffset);
			const endNodeResult = findTextNodeAtOffset(target, highlight.endOffset);
			
			if (startNodeResult && endNodeResult) {
				try {
					// Try to set start position
					try {
						range.setStart(startNodeResult.node, startNodeResult.offset);
					} catch {
						// Fallback to node start
						range.setStart(startNodeResult.node, 0);
					}
					
					// Try to set end position
					try {
						range.setEnd(endNodeResult.node, endNodeResult.offset);
					} catch {
						// Fallback to node end
						range.setEnd(endNodeResult.node, endNodeResult.node.textContent?.length || 0);
					}
					
					processRangeForOverlayRects(range, highlight.content, existingOverlays, index, highlight.notes, target);

				} catch (error) { // Catch errors from setStart/setEnd or processRange itself
					console.warn('Error setting range or processing rects for text highlight:', error);
					const rect = target.getBoundingClientRect(); // Fallback
					mergeHighlightOverlayRects([rect], highlight.content, existingOverlays, false, index, highlight.notes);
				}
			} else {
				// Fallback to element highlight if start/end nodes not found
				console.warn('Could not find start/end node for text highlight, falling back to element bounds.');
				const rect = target.getBoundingClientRect();
				mergeHighlightOverlayRects([rect], highlight.content, existingOverlays, false, index, highlight.notes);
			}
		} catch (error) { // Outer catch for findTextNodeAtOffset or other unexpected issues
			console.error('Error creating text highlight:', error);
			const rect = target.getBoundingClientRect();
			mergeHighlightOverlayRects([rect], highlight.content, existingOverlays, false, index, highlight.notes);
		} finally {
			range.detach();
		}
	}
}

// Merge a set of rectangles, to avoid adjacent and overlapping highlights where possible
function mergeHighlightOverlayRects(rects: DOMRect[], content: string, existingOverlays: Element[], isText: boolean = false, index: number, notes?: string[]) {
	let mergedRects: DOMRect[] = [];
	let currentRect: DOMRect | null = null;

	for (let i = 0; i < rects.length; i++) {
		const rect = rects[i];
		if (!currentRect) {
			currentRect = new DOMRect(rect.x, rect.y, rect.width, rect.height);
		} else if (Math.abs(rect.y - currentRect.y) < 1 && Math.abs(rect.height - currentRect.height) < 1) {
			// Merge adjacent rects with the same height and y-position
			currentRect.width = rect.right - currentRect.left;
		} else {
			mergedRects.push(currentRect);
			currentRect = new DOMRect(rect.x, rect.y, rect.width, rect.height);
		}
	}
	if (currentRect) {
		mergedRects.push(currentRect);
	}

	for (const rect of mergedRects) {
		const isDuplicate = existingOverlays.some(overlay => {
			const overlayRect = overlay.getBoundingClientRect();
			return (
				Math.abs(rect.left - overlayRect.left) < 1 &&
				Math.abs(rect.top - overlayRect.top) < 1 &&
				Math.abs(rect.width - overlayRect.width) < 1 &&
				Math.abs(rect.height - overlayRect.height) < 1
			);
		});

		if (!isDuplicate) {
			createHighlightOverlayElement(rect, content, isText, index, notes);
		}
	}
}

// Create an overlay element
function createHighlightOverlayElement(rect: DOMRect, content: string, isText: boolean = false, index: number, notes?: string[]) {
	const overlay = document.createElement('div');
	overlay.className = 'obsidian-highlight-overlay';
	overlay.dataset.highlightIndex = index.toString();
	
	overlay.style.position = 'absolute';

	overlay.style.left = `${rect.left + window.scrollX - 2}px`;
	overlay.style.top = `${rect.top + window.scrollY - 2}px`;
	overlay.style.width = `${rect.width + 4}px`;
	overlay.style.height = `${rect.height + 4}px`;
	
	overlay.setAttribute('data-content', content);
	if (notes && notes.length > 0) {
		overlay.setAttribute('data-notes', JSON.stringify(notes));
	}
	
	// Get the background color of the element under the highlight
	const elementAtPoint = document.elementFromPoint(rect.left, rect.top);
	if (elementAtPoint) {
		const bgColor = getEffectiveBackgroundColor(elementAtPoint as HTMLElement);
		if (isDarkColor(bgColor)) {
			overlay.classList.add('obsidian-highlight-overlay-dark');
		}
	}
	
	overlay.addEventListener('click', handleHighlightClick);
	overlay.addEventListener('touchend', handleHighlightClick);
	document.body.appendChild(overlay);
}

// Helper function to get the effective background color
function getEffectiveBackgroundColor(element: HTMLElement): string {
	let currentElement: HTMLElement | null = element;
	while (currentElement) {
		const backgroundColor = window.getComputedStyle(currentElement).backgroundColor;
		if (backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent') {
			return backgroundColor;
		}
		currentElement = currentElement.parentElement;
	}
	// If we've reached here, we haven't found a non-transparent background.
	// Return white as a default.
	return 'rgb(255, 255, 255)';
}

// Update positions of all highlight overlays
function updateHighlightOverlayPositions() {
	highlights.forEach((highlight, index) => {
		const target = getElementByXPath(highlight.xpath);
		if (target) {
			const existingOverlays = document.querySelectorAll(`.obsidian-highlight-overlay[data-highlight-index="${index}"]`);
			if (existingOverlays.length > 0) {
				removeExistingHighlightOverlays(index);
			}
			planHighlightOverlayRects(target, highlight, index);
		}
	});
}

// Remove existing highlight overlays for a specific index
function removeExistingHighlightOverlays(index: number) {
	document.querySelectorAll(`.obsidian-highlight-overlay[data-highlight-index="${index}"]`).forEach(el => el.remove());
}

const throttledUpdateHighlights = throttle(() => {
	if (!isApplyingHighlights) {
		updateHighlightOverlayPositions();
	}
}, 100);

window.addEventListener('resize', throttledUpdateHighlights);
window.addEventListener('scroll', throttledUpdateHighlights);

const observer = new MutationObserver((mutations) => {
	if (!isApplyingHighlights) {
		const shouldUpdate = mutations.some(mutation => 
			(mutation.type === 'childList' && 
			 (mutation.target instanceof Element) && 
			 !mutation.target.id.startsWith('obsidian-highlight')) || 
			(mutation.type === 'attributes' && 
			 (mutation.attributeName === 'style' || mutation.attributeName === 'class') &&
			 (mutation.target instanceof Element) &&
			 !mutation.target.id.startsWith('obsidian-highlight'))
		);
		if (shouldUpdate) {
			throttledUpdateHighlights();
		}
	}
});

observer.observe(document.body, { 
	childList: true, 
	subtree: true, 
	attributes: true,
	attributeFilter: ['style', 'class'],
	characterData: false
});

// Create or update the hover overlay used to indicate which element will be highlighted
function createOrUpdateHoverOverlay(target: Element) {
	// Only update if the target has changed
	if (target === lastHoverTarget) return;
	lastHoverTarget = target;

	let elementForHoverRect: Element | null = target;
	const eventTargetTagName = target.tagName.toUpperCase();

	if (['TD', 'TH', 'TR'].includes(eventTargetTagName)) {
		elementForHoverRect = target.closest('table');
	}

	// Now, elementForHoverRect is either the table, the original target, or null.
	// Check if this elementForHoverRect itself is valid (i.e., not ignored).
	// isIgnoredElement returns true if the element's tag is NOT in the allowed list for hover
	// (or if it's html, body etc.).
	if (elementForHoverRect && !isIgnoredElement(elementForHoverRect)) {
		// This is a valid element to get bounds from.
	} else if (target.parentElement && !isIgnoredElement(target.parentElement) && !['TD', 'TH', 'TR'].includes(eventTargetTagName)) {
		// If the primary elementForHoverRect (table or original target) was not valid (null or ignored),
		// AND the original event target was not a table cell (because for cells, we only care about the table's validity),
		// THEN consider the original event target's parent as the element for the hover rectangle.
		elementForHoverRect = target.parentElement;
	} else {
		// Otherwise (no valid candidate found after checking primary and parent (for non-cells))
		removeHoverOverlay();
		return;
	}

	// If, after all logic, elementForHoverRect is null (e.g. a TD not in a table, or other unhandled cases), remove overlay.
	if (!elementForHoverRect) {
		removeHoverOverlay();
		return;
	}

	if (!hoverOverlay) {
		hoverOverlay = document.createElement('div');
		hoverOverlay.id = 'obsidian-highlight-hover-overlay';
		document.body.appendChild(hoverOverlay);
	}
	
	const rect = elementForHoverRect.getBoundingClientRect();

	hoverOverlay.style.position = 'absolute';
	hoverOverlay.style.left = `${rect.left + window.scrollX - 2}px`;
	hoverOverlay.style.top = `${rect.top + window.scrollY - 2}px`;
	hoverOverlay.style.width = `${rect.width + 4}px`;
	hoverOverlay.style.height = `${rect.height + 4}px`;
	hoverOverlay.style.display = 'block';

	// Remove 'is-hovering' class from all highlight overlays
	document.querySelectorAll('.obsidian-highlight-overlay.is-hovering').forEach(el => {
		el.classList.remove('is-hovering');
	});

	// Remove 'on-highlight' class from hover overlay
	hoverOverlay.classList.remove('on-highlight');

	// Check if the target is a highlight overlay
	if (target.classList.contains('obsidian-highlight-overlay')) {
		const index = target.getAttribute('data-highlight-index');
		if (index) {
			// Add 'is-hovering' class to all highlight overlays with the same index
			document.querySelectorAll(`.obsidian-highlight-overlay[data-highlight-index="${index}"]`).forEach(el => {
				el.classList.add('is-hovering');
			});
			// Add 'on-highlight' class to hover overlay
			hoverOverlay.classList.add('on-highlight');
		}
	}
}

// Modify the removeHoverOverlay function to also remove the 'is-hovering' class
export function removeHoverOverlay() {
	if (hoverOverlay) {
		hoverOverlay.style.display = 'none';
	}
	lastHoverTarget = null;

	// Remove 'is-hovering' class from all highlight overlays
	document.querySelectorAll('.obsidian-highlight-overlay.is-hovering').forEach(el => {
		el.classList.remove('is-hovering');
	});
}

// Close any existing context menu
function closeContextMenu() {
	const existing = document.querySelector('.obsidian-highlight-context-menu');
	if (existing) existing.remove();
}

// Handle click on a cross-site match overlay
function handleCrossSiteOverlayClick(event: Event, entries: TagIndexEntry[]) {
	event.stopPropagation();
	event.preventDefault();

	closeContextMenu();

	const overlay = event.currentTarget as HTMLElement;
	const rect = overlay.getBoundingClientRect();

	const menu = document.createElement('div');
	menu.className = 'obsidian-highlight-context-menu';

	for (const entry of entries) {
		const noteSection = document.createElement('div');
		noteSection.className = 'context-menu-note-section';

		// Tags display
		if (entry.tags.length > 0) {
			const tagsRow = document.createElement('div');
			tagsRow.className = 'context-menu-tags';
			tagsRow.textContent = entry.tags.map(t => `#${t}`).join(' ');
			noteSection.appendChild(tagsRow);
		}

		// Source URL or note path
		if (entry.sourceUrl) {
			const sourceRow = document.createElement('div');
			sourceRow.className = 'context-menu-source';
			sourceRow.textContent = `From: ${new URL(entry.sourceUrl).hostname}`;
			noteSection.appendChild(sourceRow);
		} else if (entry.noteRef) {
			const sourceRow = document.createElement('div');
			sourceRow.className = 'context-menu-source';
			sourceRow.textContent = entry.noteRef.name;
			noteSection.appendChild(sourceRow);
		}

		// View Note button (if noteRef exists)
		if (entry.noteRef) {
			const viewNoteBtn = document.createElement('button');
			viewNoteBtn.className = 'context-menu-btn';
			viewNoteBtn.textContent = 'View in Clipper';
			viewNoteBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				closeContextMenu();
				await openNoteInClipper(entry.noteRef!);
			});
			noteSection.appendChild(viewNoteBtn);

			// Open in Obsidian button
			const openBtn = document.createElement('button');
			openBtn.className = 'context-menu-btn';
			openBtn.textContent = 'Open in Obsidian';
			openBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				closeContextMenu();
				const obsidianUrl = `obsidian://open?vault=${encodeURIComponent(entry.noteRef!.vault)}&file=${encodeURIComponent(entry.noteRef!.path + entry.noteRef!.name)}`;
				window.open(obsidianUrl);
			});
			noteSection.appendChild(openBtn);
		}

		menu.appendChild(noteSection);
	}

	positionContextMenu(menu, rect);
	document.body.appendChild(menu);

	// Close on outside click
	setTimeout(() => {
		document.addEventListener('click', closeContextMenu, { once: true });
	}, 0);
}

// Handle click on a regular highlight overlay — show context menu
async function handleHighlightClick(event: Event) {
	event.stopPropagation();
	event.preventDefault();

	const overlay = event.currentTarget as HTMLElement;

	try {
		if (!overlay || !overlay.dataset) return;

		const index = overlay.dataset.highlightIndex;
		if (index === undefined) return;

		const highlightIndex = parseInt(index);
		if (isNaN(highlightIndex) || highlightIndex < 0 || highlightIndex >= highlights.length) return;

		const highlight = getHighlightByIndex(highlightIndex);
		if (!highlight) return;

		closeContextMenu();

		const rect = overlay.getBoundingClientRect();
		const menu = document.createElement('div');
		menu.className = 'obsidian-highlight-context-menu';

		// Tags section
		const tagsSection = document.createElement('div');
		tagsSection.className = 'context-menu-section';

		const tagsLabel = document.createElement('label');
		tagsLabel.className = 'context-menu-label';
		tagsLabel.textContent = 'Tags';
		tagsSection.appendChild(tagsLabel);

		const tagsInput = document.createElement('input');
		tagsInput.className = 'context-menu-input';
		tagsInput.type = 'text';
		tagsInput.placeholder = 'tag1, tag2, tag3';
		tagsInput.value = (highlight.tags || []).join(', ');
		tagsSection.appendChild(tagsInput);

		const saveTagsBtn = document.createElement('button');
		saveTagsBtn.className = 'context-menu-btn mod-primary';
		saveTagsBtn.textContent = 'Save Tags';
		saveTagsBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const tags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t.length > 0);
			updateHighlightTags(highlight.id, tags);
			closeContextMenu();
		});
		tagsSection.appendChild(saveTagsBtn);
		menu.appendChild(tagsSection);

		// View Note button (if noteRef exists)
		if (highlight.noteRef) {
			const viewNoteBtn = document.createElement('button');
			viewNoteBtn.className = 'context-menu-btn';
			viewNoteBtn.textContent = 'View Note';
			viewNoteBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				closeContextMenu();
				showNotePopup(highlight.noteRef!, rect);
			});
			menu.appendChild(viewNoteBtn);

			const openBtn = document.createElement('button');
			openBtn.className = 'context-menu-btn';
			openBtn.textContent = 'Open in Obsidian';
			openBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				closeContextMenu();
				const obsidianUrl = `obsidian://open?vault=${encodeURIComponent(highlight.noteRef!.vault)}&file=${encodeURIComponent(highlight.noteRef!.path + highlight.noteRef!.name)}`;
				window.open(obsidianUrl);
			});
			menu.appendChild(openBtn);
		}

		// Remove button
		const removeBtn = document.createElement('button');
		removeBtn.className = 'context-menu-btn mod-danger';
		removeBtn.textContent = 'Remove Highlight';
		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			closeContextMenu();
			const newHighlights = highlights.filter((h: AnyHighlightData) => h.id !== highlight.id);
			updateHighlights(newHighlights);
			removeExistingHighlightOverlays(highlightIndex);
			sortHighlights();
			applyHighlights();
			saveHighlights();
			updateHighlighterMenu();
		});
		menu.appendChild(removeBtn);

		positionContextMenu(menu, rect);
		document.body.appendChild(menu);

		// Focus the tags input
		tagsInput.focus();

		// Prevent closing on input clicks
		menu.addEventListener('click', (e) => e.stopPropagation());

		// Handle Enter key in tags input
		tagsInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				saveTagsBtn.click();
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				closeContextMenu();
			}
		});

		// Close on outside click
		setTimeout(() => {
			document.addEventListener('click', closeContextMenu, { once: true });
		}, 0);
	} catch (error) {
		console.error('Error handling highlight click:', error);
	}
}

// Position a context menu near an overlay rect
function positionContextMenu(menu: HTMLElement, anchorRect: DOMRect) {
	menu.style.position = 'fixed';
	menu.style.zIndex = '9999999999';

	// Position below the highlight, centered
	let left = anchorRect.left + anchorRect.width / 2;
	let top = anchorRect.bottom + 8;

	// Adjust if too close to bottom
	if (top + 200 > window.innerHeight) {
		top = anchorRect.top - 8;
		menu.style.transform = 'translate(-50%, -100%)';
	} else {
		menu.style.transform = 'translateX(-50%)';
	}

	// Clamp left
	left = Math.max(150, Math.min(left, window.innerWidth - 150));

	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;
}

// Create a cross-site highlight overlay (supports multiple entries per position)
export function createCrossSiteOverlay(rect: DOMRect, entries: TagIndexEntry | TagIndexEntry[]) {
	const entryArray = Array.isArray(entries) ? entries : [entries];
	const overlay = document.createElement('div');
	overlay.className = 'obsidian-highlight-overlay obsidian-highlight-crosssite';
	overlay.dataset.crossSite = 'true';
	overlay.dataset.highlightId = entryArray[0].highlightId;

	overlay.style.position = 'absolute';
	overlay.style.left = `${rect.left + window.scrollX - 2}px`;
	overlay.style.top = `${rect.top + window.scrollY - 2}px`;
	overlay.style.width = `${rect.width + 4}px`;
	overlay.style.height = `${rect.height + 4}px`;
	overlay.style.display = 'block';
	overlay.style.pointerEvents = 'auto';
	overlay.style.cursor = 'pointer';

	overlay.addEventListener('click', (e) => handleCrossSiteOverlayClick(e, entryArray));
	overlay.addEventListener('touchend', (e) => handleCrossSiteOverlayClick(e, entryArray));

	document.body.appendChild(overlay);
}

// Open a note in the clipper side panel
async function openNoteInClipper(noteRef: import('./highlighter').NoteRef) {
	const notePath = noteRef.path ? `${noteRef.path}/${noteRef.name}.md` : `${noteRef.name}.md`;

	// Fetch note content via background script
	const result = await fetchNoteContent(notePath);
	const noteContent = result.error ? `Error: ${result.error}` : result.content;

	// Store note preview data BEFORE opening iframe so popup.ts can read it on init
	await browser.storage.local.set({
		pendingNotePreview: {
			noteName: noteRef.name,
			noteContent,
			notePath: noteRef.path || '',
		}
	});

	// Ensure the clipper iframe is open
	const containerId = 'obsidian-clipper-container';
	let container = document.getElementById(containerId);

	if (!container) {
		// Open the iframe via background → content script toggle-iframe
		await browser.runtime.sendMessage({ action: 'openEmbeddedForNote' });
	} else {
		// Iframe already open — send message directly
		browser.runtime.sendMessage({
			action: 'showNotePreview',
			noteName: noteRef.name,
			noteContent,
			notePath: noteRef.path || '',
		});
	}
}

// Remove all cross-site overlays
export function removeCrossSiteOverlays() {
	document.querySelectorAll('.obsidian-highlight-crosssite').forEach(el => el.remove());
}

// Remove all existing highlight overlays from the page
export function removeExistingHighlights() {
	const existingHighlights = document.querySelectorAll('.obsidian-highlight-overlay');
	console.log('existingHighlights', existingHighlights.length);
	if (existingHighlights.length > 0) {
		existingHighlights.forEach(el => el.remove());
	}
}
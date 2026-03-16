import { NoteRef } from './highlighter';
import { fetchNoteContent, getRESTConfig, saveRESTConfig } from './obsidian-rest-api';

const POPUP_CLASS = 'obsidian-note-popup';

export function hideNotePopup() {
	const existing = document.querySelector(`.${POPUP_CLASS}`);
	if (existing) existing.remove();
}

export async function showNotePopup(noteRef: NoteRef, anchorRect: DOMRect) {
	hideNotePopup();

	const popup = document.createElement('div');
	popup.className = POPUP_CLASS;

	// Header
	const header = document.createElement('div');
	header.className = 'note-popup-header';

	const title = document.createElement('span');
	title.className = 'note-popup-title';
	title.textContent = noteRef.name;
	header.appendChild(title);

	const closeBtn = document.createElement('button');
	closeBtn.className = 'note-popup-close';
	closeBtn.textContent = '\u00d7';
	closeBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		hideNotePopup();
	});
	header.appendChild(closeBtn);

	popup.appendChild(header);

	// Loading state
	const content = document.createElement('div');
	content.className = 'note-popup-content';
	content.textContent = 'Loading...';
	popup.appendChild(content);

	// Open in Obsidian link
	const footer = document.createElement('div');
	footer.className = 'note-popup-footer';
	const openLink = document.createElement('a');
	openLink.className = 'note-popup-open-link';
	openLink.textContent = 'Open in Obsidian';
	openLink.href = '#';
	openLink.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const obsidianUrl = `obsidian://open?vault=${encodeURIComponent(noteRef.vault)}&file=${encodeURIComponent(noteRef.path + noteRef.name)}`;
		window.open(obsidianUrl);
	});
	footer.appendChild(openLink);
	popup.appendChild(footer);

	// Position popup
	positionPopup(popup, anchorRect);

	// Prevent click propagation
	popup.addEventListener('click', (e) => e.stopPropagation());

	document.body.appendChild(popup);

	// Check if API key is configured
	const config = await getRESTConfig();

	if (!config.apiKey) {
		// Show inline setup form
		content.textContent = '';
		showApiKeySetup(content, noteRef, popup, anchorRect);
		return;
	}

	// Fetch note content
	await loadNoteContent(content, noteRef);

	// Close on outside click
	setTimeout(() => {
		document.addEventListener('click', hideNotePopup, { once: true });
	}, 0);

	// Close on Escape
	addEscListener();
}

function showApiKeySetup(content: HTMLElement, noteRef: NoteRef, popup: HTMLElement, anchorRect: DOMRect) {
	const setupDiv = document.createElement('div');
	setupDiv.className = 'note-popup-setup';

	const instructions = document.createElement('p');
	instructions.className = 'note-popup-setup-text';
	instructions.textContent = 'Enter your Obsidian Local REST API key to preview notes. Find it in Obsidian → Settings → Community plugins → Local REST API.';
	setupDiv.appendChild(instructions);

	const inputRow = document.createElement('div');
	inputRow.className = 'note-popup-setup-row';

	const input = document.createElement('input');
	input.className = 'note-popup-setup-input';
	input.type = 'text';
	input.placeholder = 'Paste API key here';
	inputRow.appendChild(input);

	const saveBtn = document.createElement('button');
	saveBtn.className = 'context-menu-btn mod-primary';
	saveBtn.textContent = 'Save';
	saveBtn.addEventListener('click', async (e) => {
		e.stopPropagation();
		const apiKey = input.value.trim();
		if (!apiKey) return;

		saveBtn.textContent = 'Saving...';
		saveBtn.setAttribute('disabled', 'true');

		await saveRESTConfig({ host: 'http://localhost:27123', apiKey });

		// Now try loading the note
		content.textContent = '';
		content.textContent = 'Loading...';
		await loadNoteContent(content, noteRef);
	});
	inputRow.appendChild(saveBtn);

	setupDiv.appendChild(inputRow);
	content.appendChild(setupDiv);

	// Focus input
	setTimeout(() => input.focus(), 0);

	// Close on outside click
	setTimeout(() => {
		document.addEventListener('click', hideNotePopup, { once: true });
	}, 0);

	addEscListener();
}

async function loadNoteContent(content: HTMLElement, noteRef: NoteRef) {
	const notePath = noteRef.path ? `${noteRef.path}/${noteRef.name}.md` : `${noteRef.name}.md`;
	const result = await fetchNoteContent(notePath);

	content.textContent = '';

	if (result.error) {
		const errorMsg = document.createElement('div');
		errorMsg.className = 'note-popup-error';
		errorMsg.textContent = result.error;
		content.appendChild(errorMsg);
	} else {
		const pre = document.createElement('pre');
		pre.className = 'note-popup-markdown';
		pre.textContent = result.content;
		content.appendChild(pre);
	}
}

function addEscListener() {
	const handleEsc = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			hideNotePopup();
			document.removeEventListener('keydown', handleEsc);
		}
	};
	document.addEventListener('keydown', handleEsc);
}

function positionPopup(popup: HTMLElement, anchorRect: DOMRect) {
	popup.style.position = 'fixed';
	popup.style.zIndex = '9999999999';

	let left = anchorRect.left + anchorRect.width / 2;
	let top = anchorRect.bottom + 12;

	// If too close to bottom, show above
	if (top + 350 > window.innerHeight) {
		top = anchorRect.top - 12;
		popup.classList.add('above');
	}

	// Clamp left
	left = Math.max(200, Math.min(left, window.innerWidth - 200));

	popup.style.left = `${left}px`;
	popup.style.top = `${top}px`;

	if (popup.classList.contains('above')) {
		popup.style.transform = 'translate(-50%, -100%)';
	} else {
		popup.style.transform = 'translateX(-50%)';
	}
}

import { TagIndexEntry } from '../utils/highlight-tag-index';

export class NoteMatch extends HTMLElement {
	private _entries: TagIndexEntry[] = [];

	set entries(value: TagIndexEntry[]) {
		this._entries = value;
	}

	get entries(): TagIndexEntry[] {
		return this._entries;
	}

	connectedCallback() {
		console.debug('[note-match] connectedCallback, tag:', this.textContent);
		this.addEventListener('click', this.handleClick);
	}

	disconnectedCallback() {
		this.removeEventListener('click', this.handleClick);
	}

	private handleClick = (e: Event) => {
		console.debug('[note-match] clicked, entries:', this._entries.length, 'text:', this.textContent);
		e.stopPropagation();
		e.preventDefault();
		this.dispatchEvent(new CustomEvent('note-match-click', {
			bubbles: true,
			composed: true,
			detail: { entries: this._entries },
		}));
	};
}

if (!customElements.get('note-match')) {
	customElements.define('note-match', NoteMatch);
}

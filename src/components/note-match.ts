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
		if (!this.shadowRoot) {
			const shadow = this.attachShadow({ mode: 'open' });
			shadow.innerHTML = `<style>
:host {
	background: rgba(100, 180, 255, 0.2);
	border-bottom: 2px solid rgba(100, 180, 255, 0.7);
	border-radius: 2px;
	cursor: pointer;
	padding: 1px 0;
}
</style><slot></slot>`;
		}
		this.addEventListener('click', this.handleClick);
	}

	disconnectedCallback() {
		this.removeEventListener('click', this.handleClick);
	}

	private handleClick = (e: Event) => {
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

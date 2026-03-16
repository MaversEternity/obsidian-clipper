export class MultitextInput extends HTMLElement {
	private pills: string[] = [];
	private input!: HTMLInputElement;
	private pillContainer!: HTMLElement;

	static get observedAttributes() {
		return ['value', 'data-type', 'data-template-value'];
	}

	connectedCallback() {
		this.className = 'multitext-container';

		this.pillContainer = this;
		this.input = document.createElement('input');
		this.input.type = 'text';
		this.input.className = 'multitext-input';

		this.input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ',') {
				e.preventDefault();
				this.commitInput();
			} else if (e.key === 'Backspace' && this.input.value === '') {
				this.removeLastPill();
			}
		});

		this.input.addEventListener('blur', () => this.commitInput());
		this.addEventListener('click', () => this.input.focus());

		this.appendChild(this.input);
	}

	get value(): string {
		return this.pills.join(', ');
	}

	set value(val: string) {
		this.pills = [];
		this.clearPillElements();
		if (!val) return;

		let items: string[];
		if (val.trim().startsWith('[')) {
			try {
				items = JSON.parse(val);
			} catch {
				items = val.split(/,(?![^\[]*\]\])/).map(s => s.trim());
			}
		} else {
			items = val.split(/,(?![^\[]*\]\])/).map(s => s.trim());
		}

		for (const item of items) {
			if (item) this.addPill(item);
		}
	}

	setValues(items: string[]) {
		this.pills = [];
		this.clearPillElements();
		for (const item of items) {
			if (item.trim()) this.addPill(item.trim());
		}
	}

	private commitInput() {
		const val = this.input.value.trim().replace(/,$/, '');
		if (val) {
			this.addPill(val);
			this.input.value = '';
		}
	}

	private addPill(text: string) {
		this.pills.push(text);

		const pill = document.createElement('span');
		pill.className = 'multitext-pill';
		pill.textContent = text;

		const remove = document.createElement('span');
		remove.className = 'multitext-pill-remove';
		remove.textContent = '×';
		remove.addEventListener('click', (e) => {
			e.stopPropagation();
			const idx = this.pills.indexOf(text);
			if (idx !== -1) this.pills.splice(idx, 1);
			pill.remove();
		});

		pill.appendChild(remove);
		this.insertBefore(pill, this.input);
	}

	private removeLastPill() {
		const pillElements = this.querySelectorAll('.multitext-pill');
		if (pillElements.length > 0) {
			pillElements[pillElements.length - 1].remove();
			this.pills.pop();
		}
	}

	private clearPillElements() {
		this.querySelectorAll('.multitext-pill').forEach(p => p.remove());
	}
}

customElements.define('multitext-input', MultitextInput);

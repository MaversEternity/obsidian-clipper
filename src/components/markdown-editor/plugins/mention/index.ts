import type { Klass, LexicalEditor, LexicalNode } from 'lexical';
import type { Transformer } from '@lexical/markdown';
import { $getSelection, $isRangeSelection, $createTextNode } from 'lexical';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';
import { WikilinkNode, $createWikilinkNode } from '../../nodes/WikilinkNode';
import { getObsidianApi } from '../../../../di/container';

// Import wikilink transformer from transformers
import { WIKILINK_TRANSFORMER } from '../../transformers';

export class EditorPluginMention extends HTMLElement implements EditorPlugin {
	private editor: LexicalEditor | null = null;
	private hostShadow: ShadowRoot | null = null;
	private dropdown: HTMLElement | null = null;
	private notes: string[] = [];
	private filtered: string[] = [];
	private selectedIndex = 0;
	private suggestActive = false;
	private activeTrigger: '[[' | '@' | null = null;
	private removeTextListener: (() => void) | null = null;
	private editorRoot: HTMLElement | null = null;

	getNodes(): Klass<LexicalNode>[] {
		return [WikilinkNode];
	}

	getTransformers(): Transformer[] {
		return [WIKILINK_TRANSFORMER];
	}

	getToolbarButton(): ToolbarButtonDef | null {
		return null; // triggered by [[ typing
	}

	attach(editor: LexicalEditor, hostShadow: ShadowRoot): void {
		this.editor = editor;
		this.hostShadow = hostShadow;
		this.editorRoot = editor.getRootElement();

		if (this.editorRoot) {
			this.editorRoot.addEventListener('keydown', this.onKeydown, true);
		}
		this.removeTextListener = editor.registerTextContentListener(this.onTextChange);
	}

	detach(): void {
		if (this.editorRoot) {
			this.editorRoot.removeEventListener('keydown', this.onKeydown, true);
		}
		this.removeTextListener?.();
		this.closeSuggest();
	}

	private onTextChange = () => {
		if (!this.editor) return;
		this.editor.getEditorState().read(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection)) {
				this.closeSuggest();
				return;
			}
			const anchor = selection.anchor;
			const anchorNode = anchor.getNode();
			const textContent = anchorNode.getTextContent();
			const offset = anchor.offset;
			const before = textContent.slice(0, offset);

			// Try [[ trigger
			const wikiIdx = before.lastIndexOf('[[');
			if (wikiIdx !== -1 && before.indexOf(']]', wikiIdx) === -1) {
				const query = before.slice(wikiIdx + 2);
				if (!query.includes('\n')) {
					this.activeTrigger = '[[';
					this.openSuggest(query);
					return;
				}
			}

			// Try @ trigger — must be at word boundary (start of line or after space)
			const atIdx = before.lastIndexOf('@');
			if (atIdx !== -1 && (atIdx === 0 || /\s/.test(before[atIdx - 1]))) {
				const query = before.slice(atIdx + 1);
				if (!query.includes('\n') && !query.includes(' ')) {
					this.activeTrigger = '@';
					this.openSuggest(query);
					return;
				}
			}

			this.closeSuggest();
		});
	};

	private async openSuggest(query: string) {
		if (this.notes.length === 0) {
			const result = await getObsidianApi().listNotes();
			if (result.error || result.notes.length === 0) {
				this.closeSuggest();
				return;
			}
			this.notes = result.notes;
		}
		const q = query.toLowerCase();
		const currentNote = (document.getElementById('note-name-field') as HTMLInputElement)?.value?.trim() || '';
		this.filtered = this.notes
			.filter(n => {
				const name = n.replace(/\.md$/, '');
				if (name === currentNote || name.endsWith('/' + currentNote)) return false;
				return name.toLowerCase().includes(q);
			})
			.slice(0, 20);
		this.selectedIndex = 0;

		if (this.filtered.length > 0) {
			this.showDropdown();
		} else {
			this.closeSuggest();
		}
	}

	private showDropdown() {
		if (!this.hostShadow) return;
		const container = this.hostShadow.querySelector('.editor-container');
		if (!container) return;

		if (!this.dropdown) {
			this.dropdown = document.createElement('div');
			this.dropdown.className = 'dropdown dropdown-caret';
			container.appendChild(this.dropdown);
		}

		// Position near caret
		const sel = (this.hostShadow as any).getSelection?.() || window.getSelection();
		if (sel && sel.rangeCount > 0) {
			const range = sel.getRangeAt(0);
			const rect = range.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			const editorRoot = this.hostShadow.querySelector('.editor-root') as HTMLElement;
			const scroll = editorRoot?.scrollTop || 0;
			this.dropdown.style.top = (rect.bottom - containerRect.top + scroll + 4) + 'px';
			this.dropdown.style.left = (rect.left - containerRect.left) + 'px';
		}

		this.dropdown.innerHTML = '';
		this.filtered.forEach((note, i) => {
			const item = document.createElement('div');
			item.className = 'item' + (i === this.selectedIndex ? ' is-selected' : '');

			const notePath = note.replace(/\.md$/, '');
			const lastSlash = notePath.lastIndexOf('/');
			const name = lastSlash >= 0 ? notePath.slice(lastSlash + 1) : notePath;
			const folder = lastSlash >= 0 ? notePath.slice(0, lastSlash) : '';

			const nameEl = document.createElement('span');
			nameEl.className = 'name';
			nameEl.textContent = name;
			item.appendChild(nameEl);

			if (folder) {
				const pathEl = document.createElement('span');
				pathEl.className = 'path';
				pathEl.textContent = folder;
				item.appendChild(pathEl);
			}

			item.addEventListener('mousedown', (e) => {
				e.preventDefault();
				this.selectNote(note);
			});
			item.addEventListener('mouseenter', () => {
				this.selectedIndex = i;
				this.updateSelection();
			});

			this.dropdown!.appendChild(item);
		});
		this.suggestActive = true;
	}

	private updateSelection() {
		if (!this.dropdown) return;
		const items = this.dropdown.querySelectorAll('.item');
		items.forEach((item, i) => {
			item.classList.toggle('is-selected', i === this.selectedIndex);
		});
		items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
	}

	private selectNote(note: string) {
		if (!this.editor) return;
		const notePath = note.replace(/\.md$/, '');
		const lastSlash = notePath.lastIndexOf('/');
		const name = lastSlash >= 0 ? notePath.slice(lastSlash + 1) : notePath;
		const alias = lastSlash >= 0 ? name : undefined;

		const trigger = this.activeTrigger;

		this.editor.update(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection)) return;

			const anchor = selection.anchor;
			const anchorNode = anchor.getNode();
			const textContent = anchorNode.getTextContent();
			const offset = anchor.offset;
			const before = textContent.slice(0, offset);

			let triggerIdx: number;
			let triggerLen: number;
			if (trigger === '[[') {
				triggerIdx = before.lastIndexOf('[[');
				triggerLen = 2;
			} else {
				triggerIdx = before.lastIndexOf('@');
				triggerLen = 1;
			}
			if (triggerIdx === -1) return;

			const beforeTrigger = textContent.slice(0, triggerIdx);
			const after = textContent.slice(offset);
			const wikilinkNode = $createWikilinkNode(notePath, alias);

			if (beforeTrigger || after) {
				const beforeNode = $createTextNode(beforeTrigger);
				const afterNode = $createTextNode(after);
				anchorNode.replace(beforeNode);
				beforeNode.insertAfter(wikilinkNode);
				wikilinkNode.insertAfter(afterNode);
				afterNode.select(0, 0);
			} else {
				anchorNode.replace(wikilinkNode);
				wikilinkNode.selectNext();
			}
		});
		this.closeSuggest();
	}

	private onKeydown = (e: KeyboardEvent) => {
		if (!this.suggestActive || !this.dropdown) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			e.stopImmediatePropagation();
			this.selectedIndex = Math.min(this.selectedIndex + 1, this.filtered.length - 1);
			this.updateSelection();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			e.stopImmediatePropagation();
			this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
			this.updateSelection();
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			if (this.filtered.length > 0) {
				e.preventDefault();
				e.stopImmediatePropagation();
				this.selectNote(this.filtered[this.selectedIndex]);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopImmediatePropagation();
			this.closeSuggest();
		}
	};

	private closeSuggest() {
		if (this.dropdown) {
			this.dropdown.remove();
			this.dropdown = null;
		}
		this.suggestActive = false;
		this.activeTrigger = null;
	}
}

if (!customElements.get('editor-plugin-mention')) {
	customElements.define('editor-plugin-mention', EditorPluginMention);
}

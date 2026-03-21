import type { Klass, LexicalEditor, LexicalNode } from 'lexical';
import type { Transformer } from '@lexical/markdown';
import { $getSelection, $isRangeSelection, $createTextNode } from 'lexical';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';
import { WikilinkNode, $createWikilinkNode } from '../../nodes/WikilinkNode';
import { fetchVaultNotes } from '../../../../utils/obsidian-rest-api';

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
			this.editorRoot.addEventListener('keydown', this.onKeydown);
		}
		this.removeTextListener = editor.registerTextContentListener(this.onTextChange);
	}

	detach(): void {
		if (this.editorRoot) {
			this.editorRoot.removeEventListener('keydown', this.onKeydown);
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
			const triggerIdx = before.lastIndexOf('[[');

			if (triggerIdx === -1 || before.indexOf(']]', triggerIdx) !== -1) {
				this.closeSuggest();
				return;
			}
			const query = before.slice(triggerIdx + 2);
			if (query.includes('\n')) {
				this.closeSuggest();
				return;
			}
			this.openSuggest(query);
		});
	};

	private async openSuggest(query: string) {
		if (this.notes.length === 0) {
			const result = await fetchVaultNotes();
			if (result.error || result.notes.length === 0) {
				this.closeSuggest();
				return;
			}
			this.notes = result.notes;
		}
		const q = query.toLowerCase();
		this.filtered = this.notes
			.filter(n => n.replace(/\.md$/, '').toLowerCase().includes(q))
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
		if (!this.dropdown) {
			this.dropdown = document.createElement('div');
			this.dropdown.className = 'dropdown';
			this.hostShadow.querySelector('.editor-container')?.appendChild(this.dropdown);
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

		this.editor.update(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection)) return;

			const anchor = selection.anchor;
			const anchorNode = anchor.getNode();
			const textContent = anchorNode.getTextContent();
			const offset = anchor.offset;
			const before = textContent.slice(0, offset);
			const triggerIdx = before.lastIndexOf('[[');
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
			this.selectedIndex = Math.min(this.selectedIndex + 1, this.filtered.length - 1);
			this.updateSelection();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
			this.updateSelection();
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			if (this.filtered.length > 0) {
				e.preventDefault();
				this.selectNote(this.filtered[this.selectedIndex]);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			this.closeSuggest();
		}
	};

	private closeSuggest() {
		if (this.dropdown) {
			this.dropdown.remove();
			this.dropdown = null;
		}
		this.suggestActive = false;
	}
}

if (!customElements.get('editor-plugin-mention')) {
	customElements.define('editor-plugin-mention', EditorPluginMention);
}

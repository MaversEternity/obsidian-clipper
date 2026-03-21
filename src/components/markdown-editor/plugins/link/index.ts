import type { Klass, LexicalEditor, LexicalNode } from 'lexical';
import type { Transformer } from '@lexical/markdown';
import { $getSelection, $isRangeSelection, $createTextNode } from 'lexical';
import { $createLinkNode } from '@lexical/link';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';
import { EditorPopover } from '../../components/editor-popover';

export class EditorPluginLink extends HTMLElement implements EditorPlugin {
	private editor: LexicalEditor | null = null;
	private hostShadow: ShadowRoot | null = null;

	getNodes(): Klass<LexicalNode>[] {
		return [];
	}

	getTransformers(): Transformer[] {
		return [];
	}

	getToolbarButton(): ToolbarButtonDef | null {
		return {
			action: 'link',
			title: 'Insert link',
			icon: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
			onAction: () => this.showLinkDialog(),
		};
	}

	attach(editor: LexicalEditor, hostShadow: ShadowRoot): void {
		this.editor = editor;
		this.hostShadow = hostShadow;

		const root = editor.getRootElement();
		root?.addEventListener('keydown', (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				this.showLinkDialog();
			}
		});
	}

	detach(): void {
		this.editor = null;
		this.hostShadow = null;
	}

	private async showLinkDialog() {
		if (!this.editor || !this.hostShadow) return;

		let selectedText = '';
		this.editor.getEditorState().read(() => {
			const selection = $getSelection();
			if ($isRangeSelection(selection)) {
				selectedText = selection.getTextContent();
			}
		});

		const popover = new EditorPopover();
		const container = this.hostShadow.querySelector('.editor-container');
		container?.appendChild(popover);

		const result = await popover.show({
			fields: [
				{ name: 'text', placeholder: 'Link text', value: selectedText },
				{ name: 'url', placeholder: 'https://' },
			],
			submitLabel: 'Insert link',
		});

		if (result && result.url) {
			this.insertLink(result.text, result.url);
		}
	}

	private insertLink(text: string, url: string) {
		if (!this.editor) return;

		this.editor.update(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection)) return;

			const linkNode = $createLinkNode(url);
			if (text) {
				linkNode.append($createTextNode(text));
			}

			if (selection.isCollapsed()) {
				selection.insertNodes([linkNode]);
			} else {
				selection.removeText();
				selection.insertNodes([linkNode]);
			}
		});

		this.editor.getRootElement()?.focus();
	}
}

if (!customElements.get('editor-plugin-link')) {
	customElements.define('editor-plugin-link', EditorPluginLink);
}

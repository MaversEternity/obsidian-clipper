import type { Klass, LexicalEditor, LexicalNode } from 'lexical';
import type { Transformer } from '@lexical/markdown';
import { $getSelection, $isRangeSelection, $createTextNode, $isTextNode, $getNearestNodeFromDOMNode, $getNodeByKey, PASTE_COMMAND, COMMAND_PRIORITY_HIGH } from 'lexical';
import { $createLinkNode, $isLinkNode, LinkNode, $toggleLink } from '@lexical/link';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';
import { EditorPopover } from '../../components/editor-popover';

const URL_REGEX = /^(https?:\/\/|www\.)[^\s]+$/;

class LinkFloatingToolbar extends HTMLElement {
	private shadow: ShadowRoot;

	constructor() {
		super();
		this.shadow = this.attachShadow({ mode: 'open' });
	}

	show(url: string, rect: DOMRect, onEdit: () => void, onRemove: () => void) {
		this.shadow.innerHTML = '';

		const style = document.createElement('style');
		style.textContent = `
			:host {
				position: absolute; z-index: 200;
			}
			.link-toolbar {
				display: flex; align-items: center; gap: 4px;
				background: var(--background-primary); border: 1px solid var(--divider-color);
				border-radius: var(--radius-s); box-shadow: var(--shadow-s); padding: 4px 8px;
				white-space: nowrap;
			}
			a {
				color: var(--text-accent); font-size: var(--font-ui-smaller);
				text-decoration: none; max-width: 200px; overflow: hidden;
				text-overflow: ellipsis; display: inline-block;
			}
			a:hover { text-decoration: underline; }
			button {
				display: flex; align-items: center; justify-content: center;
				width: 22px; height: 22px; padding: 0; border: none;
				border-radius: var(--radius-s); background: transparent;
				color: var(--text-muted); cursor: pointer;
			}
			button:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
			.separator { width: 1px; height: 14px; background: var(--divider-color); }
		`;
		this.shadow.appendChild(style);

		const toolbar = document.createElement('div');
		toolbar.className = 'link-toolbar';

		const link = document.createElement('a');
		link.href = url;
		link.target = '_blank';
		link.textContent = url;
		link.title = url;

		const sep = document.createElement('span');
		sep.className = 'separator';

		const editBtn = document.createElement('button');
		editBtn.title = 'Edit link';
		editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
		editBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			onEdit();
		});

		const removeBtn = document.createElement('button');
		removeBtn.title = 'Remove link';
		removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
		removeBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			onRemove();
		});

		toolbar.appendChild(link);
		toolbar.appendChild(sep);
		toolbar.appendChild(editBtn);
		toolbar.appendChild(removeBtn);
		this.shadow.appendChild(toolbar);

		// Position below the link
		this.style.left = `${rect.left}px`;
		this.style.top = `${rect.bottom + 4}px`;
	}

	dismiss() {
		this.remove();
	}
}

if (!customElements.get('link-floating-toolbar')) {
	customElements.define('link-floating-toolbar', LinkFloatingToolbar);
}

export class EditorPluginLink extends HTMLElement implements EditorPlugin {
	private editor: LexicalEditor | null = null;
	private hostShadow: ShadowRoot | null = null;
	private floatingToolbar: LinkFloatingToolbar | null = null;
	private cleanupClickListener: (() => void) | null = null;

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

		// Ctrl/Cmd+K shortcut
		const root = editor.getRootElement();
		root?.addEventListener('keydown', (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				this.showLinkDialog();
			}
		});

		// Paste URL detection
		editor.registerCommand(
			PASTE_COMMAND,
			(event: ClipboardEvent) => {
				const text = event.clipboardData?.getData('text/plain')?.trim();
				if (!text || !URL_REGEX.test(text)) return false;

				event.preventDefault();

				editor.update(() => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection)) return;

					const linkNode = $createLinkNode(text);

					if (selection.isCollapsed()) {
						// No selected text — use URL as link text
						linkNode.append($createTextNode(text));
						selection.insertNodes([linkNode]);
					} else {
						// Wrap selected text in a link
						const selectedText = selection.getTextContent();
						linkNode.append($createTextNode(selectedText));
						selection.removeText();
						selection.insertNodes([linkNode]);
					}
				});

				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);

		// Click on links — show floating toolbar
		const onClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const linkEl = target.closest('a');

			if (!linkEl) {
				this.dismissFloatingToolbar();
				return;
			}

			e.preventDefault();
			this.showFloatingToolbar(linkEl);
		};

		root?.addEventListener('click', onClick);
		this.cleanupClickListener = () => root?.removeEventListener('click', onClick);
	}

	detach(): void {
		this.dismissFloatingToolbar();
		this.cleanupClickListener?.();
		this.editor = null;
		this.hostShadow = null;
	}

	private showFloatingToolbar(linkEl: HTMLElement) {
		if (!this.editor || !this.hostShadow) return;

		this.dismissFloatingToolbar();

		const url = linkEl.getAttribute('href') || '';
		const container = this.hostShadow.querySelector('.editor-container');
		if (!container) return;

		const containerRect = container.getBoundingClientRect();
		const linkRect = linkEl.getBoundingClientRect();

		const relativeRect = new DOMRect(
			linkRect.left - containerRect.left,
			linkRect.top - containerRect.top,
			linkRect.width,
			linkRect.height,
		);

		this.floatingToolbar = new LinkFloatingToolbar();
		container.appendChild(this.floatingToolbar);

		this.floatingToolbar.show(
			url,
			relativeRect,
			() => this.editLink(linkEl, url),
			() => this.removeLink(),
		);
	}

	private dismissFloatingToolbar() {
		this.floatingToolbar?.dismiss();
		this.floatingToolbar = null;
	}

	private async editLink(linkEl: HTMLElement, currentUrl: string) {
		if (!this.editor || !this.hostShadow) return;

		this.dismissFloatingToolbar();

		const currentText = linkEl.textContent || '';

		// Capture the node key before async popover — DOM ref may go stale
		let nodeKey: string | null = null;
		this.editor.update(() => {
			let lexicalNode = $getNearestNodeFromDOMNode(linkEl);
			if (!lexicalNode) return;
			let linkNode = $isLinkNode(lexicalNode) ? lexicalNode : lexicalNode.getParent();
			if (linkNode && $isLinkNode(linkNode)) {
				nodeKey = linkNode.getKey();
			}
		}, { discrete: true });

		if (!nodeKey) return;

		const popover = new EditorPopover();
		const container = this.hostShadow.querySelector('.editor-container');
		container?.appendChild(popover);

		const result = await popover.show({
			title: 'Edit Link',
			fields: [
				{ name: 'text', label: 'Text', placeholder: 'Link text', value: currentText },
				{ name: 'url', label: 'Link', placeholder: 'https://', value: currentUrl, required: true },
			],
			submitLabel: 'Save',
			editor: this.editor || undefined,
			anchor: linkEl,
		});

		const capturedKey = nodeKey;
		if (result && result.url) {
			this.editor.update(() => {
				const linkNode = $getNodeByKey(capturedKey);
				if (!linkNode || !$isLinkNode(linkNode)) return;

				linkNode.setURL(result.url);

				if (result.text && result.text !== currentText) {
					const children = linkNode.getChildren();
					const firstChild = children[0];
					if ($isTextNode(firstChild)) {
						firstChild.setTextContent(result.text);
					}
				}
			});
		}
	}

	private removeLink() {
		if (!this.editor) return;

		this.dismissFloatingToolbar();

		this.editor.update(() => {
			const selection = $getSelection();
			if ($isRangeSelection(selection)) {
				$toggleLink(null);
			}
		});

		this.editor.getRootElement()?.focus();
	}

	private async showLinkDialog() {
		if (!this.editor || !this.hostShadow) return;

		let selectedText = '';
		let existingUrl = '';
		let existingKey: string | null = null;
		let anchorDom: HTMLElement | null = null;

		this.editor.getEditorState().read(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection)) return;
			selectedText = selection.getTextContent();
			// Check if cursor is inside a link
			const node = selection.anchor.getNode();
			const parent = node.getParent();
			const linkNode = $isLinkNode(parent) ? parent : $isLinkNode(node) ? node : null;
			if (linkNode && $isLinkNode(linkNode)) {
				existingUrl = linkNode.getURL();
				selectedText = linkNode.getTextContent();
				existingKey = linkNode.getKey();
				anchorDom = this.editor!.getElementByKey(existingKey!);
			}
		});

		const isEditing = !!existingKey;
		const popover = new EditorPopover();
		const container = this.hostShadow.querySelector('.editor-container');
		container?.appendChild(popover);

		const result = await popover.show({
			title: isEditing ? 'Edit Link' : 'Insert Link',
			fields: [
				{ name: 'text', label: 'Text', placeholder: 'Link text', value: selectedText },
				{ name: 'url', label: 'Link', placeholder: 'https://', value: existingUrl, required: true },
			],
			submitLabel: isEditing ? 'Update' : 'Insert',
			editor: this.editor || undefined,
			anchor: anchorDom || undefined,
		});

		if (result && result.url) {
			if (isEditing && existingKey) {
				this.editor.update(() => {
					const linkNode = $getNodeByKey(existingKey!);
					if (!linkNode || !$isLinkNode(linkNode)) return;
					linkNode.setURL(result.url);
					if (result.text && result.text !== linkNode.getTextContent()) {
						const children = linkNode.getChildren();
						for (const child of children) child.remove();
						linkNode.append($createTextNode(result.text));
					}
				});
			} else {
				this.insertLink(result.text || result.url, result.url);
			}
		}
	}

	private insertLink(text: string, url: string) {
		if (!this.editor) return;

		this.editor.update(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection)) return;

			const linkNode = $createLinkNode(url);
			linkNode.append($createTextNode(text));

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

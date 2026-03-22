import type { Klass, LexicalEditor, LexicalNode } from 'lexical';
import type { TextMatchTransformer, Transformer } from '@lexical/markdown';
import { $getSelection, $isRangeSelection, $isNodeSelection, $getNodeByKey, PASTE_COMMAND, COMMAND_PRIORITY_CRITICAL } from 'lexical';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';
import { ImageNode, $createImageNode, $isImageNode } from '../../nodes/ImageNode';
import { EditorPopover } from '../../components/editor-popover';

const IMAGE_URL_RE = /^https?:\/\/\S+\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?[^\s]*)?$/i;

const IMAGE_TRANSFORMER: TextMatchTransformer = {
	dependencies: [ImageNode],
	export: (node: LexicalNode) => {
		if (node instanceof ImageNode) {
			return `![${node.__alt}](${node.__src})`;
		}
		return null;
	},
	importRegExp: /!\[([^\]]*)\]\(([^)]+)\)/,
	regExp: /!\[([^\]]*)\]\(([^)]+)\)/,
	replace: (textNode, match) => {
		const imageNode = $createImageNode(match[2], match[1]);
		textNode.replace(imageNode);
	},
	trigger: ')',
	type: 'text-match',
};

export class EditorPluginImage extends HTMLElement implements EditorPlugin {
	private editor: LexicalEditor | null = null;
	private hostShadow: ShadowRoot | null = null;

	getNodes(): Klass<LexicalNode>[] {
		return [ImageNode];
	}

	getTransformers(): Transformer[] {
		return [IMAGE_TRANSFORMER];
	}

	getToolbarButton(): ToolbarButtonDef | null {
		return {
			action: 'image',
			title: 'Insert image',
			icon: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
			onAction: () => this.showImageDialog(),
		};
	}

	private cleanupCommands: (() => void) | null = null;

	private cleanupPaste: (() => void) | null = null;

	attach(editor: LexicalEditor, hostShadow: ShadowRoot): void {
		this.editor = editor;
		this.hostShadow = hostShadow;
		this.cleanupCommands = ImageNode.registerCommands(editor);

		// Intercept paste — detect image URLs before link plugin
		this.cleanupPaste = editor.registerCommand(
			PASTE_COMMAND,
			(event: ClipboardEvent) => {
				const text = event.clipboardData?.getData('text/plain')?.trim();
				if (!text || !IMAGE_URL_RE.test(text)) return false;

				event.preventDefault();
				editor.update(() => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection)) return;
					selection.insertNodes([$createImageNode(text, '')]);
				});
				return true;
			},
			COMMAND_PRIORITY_CRITICAL, // Higher than link plugin's COMMAND_PRIORITY_HIGH
		);
	}

	detach(): void {
		this.cleanupCommands?.();
		this.cleanupPaste?.();
		this.cleanupCommands = null;
		this.cleanupPaste = null;
		this.editor = null;
		this.hostShadow = null;
	}

	private async showImageDialog() {
		if (!this.editor || !this.hostShadow) return;

		// Check if an image is currently selected — edit mode
		let existingSrc = '';
		let existingAlt = '';
		let existingKey: string | null = null;
		let anchorDom: HTMLElement | null = null;
		this.editor.getEditorState().read(() => {
			const selection = $getSelection();
			if ($isNodeSelection(selection)) {
				const nodes = selection.getNodes();
				if (nodes.length === 1 && $isImageNode(nodes[0])) {
					const img = nodes[0] as ImageNode;
					existingSrc = img.__src;
					existingAlt = img.__alt;
					existingKey = img.getKey();
					anchorDom = this.editor!.getElementByKey(existingKey);
				}
			}
		});

		const isEditing = !!existingKey;
		const popover = new EditorPopover();
		const container = this.hostShadow.querySelector('.editor-container');
		container?.appendChild(popover);

		const result = await popover.show({
			title: isEditing ? 'Edit Image' : 'Insert Image',
			fields: [
				{ name: 'url', placeholder: 'Image URL (https://...)', value: existingSrc },
				{ name: 'alt', placeholder: 'Alt text', value: existingAlt },
			],
			submitLabel: isEditing ? 'Update' : 'Insert image',
			editor: this.editor || undefined,
			anchor: anchorDom || undefined,
		});

		if (result && result.url) {
			const savedKey = existingKey;
			this.editor.update(() => {
				if (savedKey) {
					const node = $getNodeByKey(savedKey);
					if (node && $isImageNode(node)) {
						const writable = node.getWritable();
						writable.__src = result.url;
						writable.__alt = result.alt || '';
					}
				} else {
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						selection.insertNodes([$createImageNode(result.url, result.alt)]);
					}
				}
			});
		}
	}
}

if (!customElements.get('editor-plugin-image')) {
	customElements.define('editor-plugin-image', EditorPluginImage);
}

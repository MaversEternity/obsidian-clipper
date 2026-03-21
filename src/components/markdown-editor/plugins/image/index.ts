import type { Klass, LexicalEditor, LexicalNode } from 'lexical';
import type { TextMatchTransformer, Transformer } from '@lexical/markdown';
import { $getSelection, $isRangeSelection } from 'lexical';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';
import { ImageNode, $createImageNode } from '../../nodes/ImageNode';
import { EditorPopover } from '../../components/editor-popover';

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

	attach(editor: LexicalEditor, hostShadow: ShadowRoot): void {
		this.editor = editor;
		this.hostShadow = hostShadow;
	}

	detach(): void {
		this.editor = null;
		this.hostShadow = null;
	}

	private async showImageDialog() {
		if (!this.editor || !this.hostShadow) return;

		const popover = new EditorPopover();
		const container = this.hostShadow.querySelector('.editor-container');
		container?.appendChild(popover);

		const result = await popover.show({
			fields: [
				{ name: 'url', placeholder: 'Image URL (https://...)' },
				{ name: 'alt', placeholder: 'Alt text' },
			],
			submitLabel: 'Insert image',
		});

		if (result && result.url) {
			this.editor.update(() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection)) return;
				selection.insertNodes([$createImageNode(result.url, result.alt)]);
			});
			this.editor.getRootElement()?.focus();
		}
	}
}

if (!customElements.get('editor-plugin-image')) {
	customElements.define('editor-plugin-image', EditorPluginImage);
}

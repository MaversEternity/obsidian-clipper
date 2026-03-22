import { type LexicalEditor, type Klass, type LexicalNode, $nodesOfType } from 'lexical';
import type { Transformer, TextMatchTransformer } from '@lexical/markdown';
import { HashtagNode, $createHashtagNode, $isHashtagNode, registerLexicalHashtag } from '@lexical/hashtag';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';

const HASHTAG_TRANSFORMER: TextMatchTransformer = {
	dependencies: [HashtagNode],
	export: (node: LexicalNode) => {
		if ($isHashtagNode(node)) {
			return node.getTextContent();
		}
		return null;
	},
	importRegExp: /(?<=\s|^)(#[a-zA-Z0-9_\-/]+)/,
	regExp: /(?<=\s|^)(#[a-zA-Z0-9_\-/]+)/,
	replace: (textNode, match) => {
		const hashtagNode = $createHashtagNode(match[1]);
		textNode.replace(hashtagNode);
	},
	trigger: ' ',
	type: 'text-match',
};

export class EditorPluginHashtag extends HTMLElement implements EditorPlugin {
	private editor: LexicalEditor | null = null;
	private cleanup: (() => void) | null = null;
	private updateCleanup: (() => void) | null = null;
	private lastTags: string[] = [];

	getNodes(): Klass<LexicalNode>[] {
		return [HashtagNode];
	}

	getTransformers(): Transformer[] {
		return [HASHTAG_TRANSFORMER];
	}

	getToolbarButton(): ToolbarButtonDef | null {
		return null;
	}

	attach(editor: LexicalEditor, _hostShadow: ShadowRoot): void {
		this.editor = editor;
		this.cleanup = registerLexicalHashtag(editor);

		// Watch for hashtag changes and notify
		this.updateCleanup = editor.registerUpdateListener(({ editorState }) => {
			editorState.read(() => {
				const hashtagNodes = $nodesOfType(HashtagNode);
				const tags = hashtagNodes
					.map(n => n.getTextContent().replace(/^#/, ''))
					.filter(t => t.length > 0);

				// Deduplicate
				const unique = [...new Set(tags)];

				// Only fire if changed
				if (unique.join(',') !== this.lastTags.join(',')) {
					this.lastTags = unique;
					this.dispatchEvent(new CustomEvent('hashtags-change', {
						bubbles: true,
						composed: true,
						detail: { tags: unique },
					}));
				}
			});
		});
	}

	detach(): void {
		this.cleanup?.();
		this.updateCleanup?.();
		this.editor = null;
		this.cleanup = null;
		this.updateCleanup = null;
	}

}

if (!customElements.get('editor-plugin-hashtag')) {
	customElements.define('editor-plugin-hashtag', EditorPluginHashtag);
}

import type { Klass, LexicalEditor, LexicalNode } from 'lexical';
import type { TextMatchTransformer, Transformer } from '@lexical/markdown';
import { $getSelection, $isRangeSelection, $createParagraphNode, $getRoot, PASTE_COMMAND, COMMAND_PRIORITY_HIGH } from 'lexical';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';
import { YouTubeNode, $createYouTubeNode, extractYouTubeVideoId } from '../../nodes/YouTubeNode';
import { EditorPopover } from '../../components/editor-popover';

const YOUTUBE_TRANSFORMER: TextMatchTransformer = {
	dependencies: [YouTubeNode],
	export: (node: LexicalNode) => {
		if (node instanceof YouTubeNode) {
			return `https://www.youtube.com/watch?v=${node.__videoId}`;
		}
		return null;
	},
	importRegExp: /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
	regExp: /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
	replace: (textNode, match) => {
		textNode.replace($createYouTubeNode(match[1]));
	},
	trigger: ' ',
	type: 'text-match',
};

export class EditorPluginYouTube extends HTMLElement implements EditorPlugin {
	private editor: LexicalEditor | null = null;
	private hostShadow: ShadowRoot | null = null;
	private removePasteListener: (() => void) | null = null;

	getNodes(): Klass<LexicalNode>[] {
		return [YouTubeNode];
	}

	getTransformers(): Transformer[] {
		return [YOUTUBE_TRANSFORMER];
	}

	getToolbarButton(): ToolbarButtonDef | null {
		return {
			action: 'youtube',
			title: 'Insert YouTube video',
			icon: '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>',
			onAction: () => this.showYouTubeDialog(),
		};
	}

	attach(editor: LexicalEditor, hostShadow: ShadowRoot): void {
		this.editor = editor;
		this.hostShadow = hostShadow;

		// Handle paste: auto-convert YouTube URLs
		this.removePasteListener = editor.registerCommand(
			PASTE_COMMAND,
			(event: ClipboardEvent) => {
				const text = event.clipboardData?.getData('text/plain')?.trim();
				if (!text) return false;

				const videoId = extractYouTubeVideoId(text);
				if (!videoId) return false; // Not a YouTube URL, let default paste handle it

				event.preventDefault();
				editor.update(() => {
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						const node = $createYouTubeNode(videoId);
						selection.insertNodes([node]);
					}
				});
				return true; // Handled
			},
			COMMAND_PRIORITY_HIGH,
		);
	}

	detach(): void {
		this.removePasteListener?.();
		this.editor = null;
		this.hostShadow = null;
	}

	private async showYouTubeDialog() {
		if (!this.editor || !this.hostShadow) return;

		const popover = new EditorPopover();
		const container = this.hostShadow.querySelector('.editor-container');
		container?.appendChild(popover);

		const result = await popover.show({
			fields: [
				{ name: 'url', placeholder: 'YouTube URL (https://youtube.com/watch?v=...)' },
			],
			submitLabel: 'Insert video',
		});

		console.debug('[youtube-plugin] popover result:', result);

		if (result && result.url) {
			const videoId = extractYouTubeVideoId(result.url);
			console.debug('[youtube-plugin] videoId:', videoId, 'from url:', result.url);
			if (!videoId) return;

			this.editor.update(() => {
				const selection = $getSelection();
				console.debug('[youtube-plugin] selection:', selection);
				if ($isRangeSelection(selection)) {
					selection.insertNodes([$createYouTubeNode(videoId)]);
				} else {
					// Fallback: append to root
					const root = $getRoot();
					const paragraph = $createParagraphNode();
					paragraph.append($createYouTubeNode(videoId));
					root.append(paragraph);
				}
			});
			this.editor.getRootElement()?.focus();
		}
	}
}

if (!customElements.get('editor-plugin-youtube')) {
	customElements.define('editor-plugin-youtube', EditorPluginYouTube);
}

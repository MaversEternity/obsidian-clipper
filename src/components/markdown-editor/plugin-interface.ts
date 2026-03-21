import type { Klass, LexicalNode, LexicalEditor } from 'lexical';
import type { Transformer } from '@lexical/markdown';

export interface ToolbarButtonDef {
	action: string;
	title: string;
	icon: string; // SVG inner content
	onAction: (editor: LexicalEditor) => void;
}

export interface EditorPlugin extends HTMLElement {
	getNodes(): Klass<LexicalNode>[];
	getTransformers(): Transformer[];
	getToolbarButton(): ToolbarButtonDef | null;
	attach(editor: LexicalEditor, hostShadow: ShadowRoot): void;
	detach(): void;
}

export function isEditorPlugin(el: Element): el is EditorPlugin {
	return 'getNodes' in el && 'attach' in el;
}

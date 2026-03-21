import type { EditorThemeClasses } from 'lexical';

export const obsidianTheme: EditorThemeClasses = {
	paragraph: 'cm-line',
	heading: {
		h1: 'cm-header cm-header-1',
		h2: 'cm-header cm-header-2',
		h3: 'cm-header cm-header-3',
		h4: 'cm-header cm-header-4',
		h5: 'cm-header cm-header-5',
		h6: 'cm-header cm-header-6',
	},
	text: {
		bold: 'cm-strong',
		italic: 'cm-em',
		underline: 'cm-underline',
		strikethrough: 'cm-strikethrough',
		code: 'cm-inline-code',
	},
	link: 'cm-link cm-underline',
	list: {
		ul: 'cm-list',
		ol: 'cm-list',
		listitem: 'cm-list-item',
		nested: { listitem: 'cm-list-item-nested' },
		checklist: 'cm-checklist',
		listitemChecked: 'cm-list-item-checked',
		listitemUnchecked: 'cm-list-item-unchecked',
	},
	quote: 'cm-quote',
	code: 'cm-codeblock',
};

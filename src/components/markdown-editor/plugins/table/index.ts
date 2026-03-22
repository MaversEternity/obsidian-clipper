import { type LexicalEditor, type Klass, type LexicalNode, $createParagraphNode, $createTextNode } from 'lexical';
import type { Transformer, ElementTransformer } from '@lexical/markdown';
import {
	TableNode, TableRowNode, TableCellNode,
	$createTableNode, $createTableRowNode, $createTableCellNode,
	$isTableNode, $isTableRowNode, $isTableCellNode,
	INSERT_TABLE_COMMAND, registerTablePlugin,
	TableCellHeaderStates,
} from '@lexical/table';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';
import { EditorPopover } from '../../components/editor-popover';

// Markdown table transformer
const TABLE_TRANSFORMER: ElementTransformer = {
	dependencies: [TableNode, TableRowNode, TableCellNode],
	export: (node: LexicalNode) => {
		if (!$isTableNode(node)) return null;

		const rows = node.getChildren();
		if (rows.length === 0) return null;

		const lines: string[] = [];
		let isFirstRow = true;

		for (const row of rows) {
			if (!$isTableRowNode(row)) continue;
			const cells = row.getChildren();
			const cellTexts = cells.map(cell => {
				if (!$isTableCellNode(cell)) return '';
				// Get text content from cell's paragraph children
				return cell.getTextContent().replace(/\|/g, '\\|').trim();
			});
			lines.push('| ' + cellTexts.join(' | ') + ' |');

			if (isFirstRow) {
				// Add separator row
				lines.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |');
				isFirstRow = false;
			}
		}

		return lines.join('\n');
	},
	regExp: /^\|(.+)\|[ \t]*$/,
	replace: (parentNode, _children, match, isImport) => {
		if (!isImport) return false;
		// This handles line-by-line import — collect all table lines
		// The markdown import calls this for each matching line
		return false; // Let the full import handle it
	},
	type: 'element',
};

// Full markdown table import — handles the complete table block
function importMarkdownTable(markdown: string): { node: TableNode; consumed: number } | null {
	const lines = markdown.split('\n');
	const tableLines: string[] = [];

	for (const line of lines) {
		if (/^\|(.+)\|[ \t]*$/.test(line.trim())) {
			tableLines.push(line.trim());
		} else if (tableLines.length > 0) {
			break;
		}
	}

	if (tableLines.length < 2) return null; // Need at least header + separator

	// Filter out separator row
	const dataLines = tableLines.filter(line => !/^\|[\s\-:|]+\|$/.test(line));
	if (dataLines.length === 0) return null;

	const tableNode = $createTableNode();

	dataLines.forEach((line, rowIndex) => {
		const cells = line.split('|').slice(1, -1).map(c => c.trim());
		const rowNode = $createTableRowNode();

		cells.forEach(cellText => {
			const headerState = rowIndex === 0
				? TableCellHeaderStates.ROW
				: TableCellHeaderStates.NO_STATUS;
			const cellNode = $createTableCellNode(headerState);
			const paragraph = $createParagraphNode();
			paragraph.append($createTextNode(cellText.replace(/\\\|/g, '|')));
			cellNode.append(paragraph);
			rowNode.append(cellNode);
		});

		tableNode.append(rowNode);
	});

	return { node: tableNode, consumed: tableLines.length };
}

export class EditorPluginTable extends HTMLElement implements EditorPlugin {
	private editor: LexicalEditor | null = null;
	private hostShadow: ShadowRoot | null = null;
	private cleanups: (() => void)[] = [];

	getNodes(): Klass<LexicalNode>[] {
		return [TableNode, TableRowNode, TableCellNode];
	}

	getTransformers(): Transformer[] {
		return [TABLE_TRANSFORMER];
	}

	getToolbarButton(): ToolbarButtonDef | null {
		return {
			action: 'table',
			title: 'Insert table',
			icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
			onAction: () => this.showTableDialog(),
		};
	}

	attach(editor: LexicalEditor, hostShadow: ShadowRoot): void {
		this.editor = editor;
		this.hostShadow = hostShadow;

		// Register table plugin for selection handling
		this.cleanups.push(registerTablePlugin(editor));
	}

	detach(): void {
		this.cleanups.forEach(fn => fn());
		this.cleanups = [];
		this.editor = null;
		this.hostShadow = null;
	}

	private async showTableDialog() {
		if (!this.editor || !this.hostShadow) return;

		const popover = new EditorPopover();
		this.hostShadow.appendChild(popover);

		const result = await popover.show({
			title: 'Insert Table',
			fields: [
				{ name: 'rows', label: 'Rows', placeholder: '3', type: 'number' },
				{ name: 'cols', label: 'Columns', placeholder: '3', type: 'number' },
			],
			submitLabel: 'Insert',
		});

		if (!result) return;

		const rows = Math.max(1, Math.min(20, parseInt(result.rows) || 3));
		const cols = Math.max(1, Math.min(10, parseInt(result.cols) || 3));

		this.editor.dispatchCommand(INSERT_TABLE_COMMAND, {
			rows: String(rows),
			columns: String(cols),
			includeHeaders: { rows: true, columns: false },
		});
	}
}

if (!customElements.get('editor-plugin-table')) {
	customElements.define('editor-plugin-table', EditorPluginTable);
}

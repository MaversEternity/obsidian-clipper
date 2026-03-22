import {
	type LexicalEditor, type Klass, type LexicalNode,
	$createParagraphNode, $createTextNode,
} from 'lexical';
import type { Transformer, ElementTransformer } from '@lexical/markdown';
import {
	TableNode, TableRowNode, TableCellNode,
	$createTableNode, $createTableRowNode, $createTableCellNode,
	$isTableNode, $isTableRowNode, $isTableCellNode,
	INSERT_TABLE_COMMAND, registerTablePlugin,
	TableCellHeaderStates,
	$insertTableRowAtSelection, $insertTableColumnAtSelection,
} from '@lexical/table';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';
import { EditorPopover } from '../../components/editor-popover';

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
				return cell.getTextContent().replace(/\|/g, '\\|').trim();
			});
			lines.push('| ' + cellTexts.join(' | ') + ' |');

			if (isFirstRow) {
				lines.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |');
				isFirstRow = false;
			}
		}

		return lines.join('\n');
	},
	regExp: /^\|(.+)\|[ \t]*$/,
	replace: (_parentNode, _children, _match, isImport) => {
		if (!isImport) return false;
		return false;
	},
	type: 'element',
};

export class EditorPluginTable extends HTMLElement implements EditorPlugin {
	private editor: LexicalEditor | null = null;
	private hostShadow: ShadowRoot | null = null;
	private cleanups: (() => void)[] = [];
	private addRowBtn: HTMLButtonElement | null = null;
	private addColBtn: HTMLButtonElement | null = null;
	private activeTable: HTMLElement | null = null;
	private hideTimeout: ReturnType<typeof setTimeout> | null = null;

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

		this.cleanups.push(registerTablePlugin(editor));

		// Create persistent helper buttons (appended to editor-container)
		const container = hostShadow.querySelector('.editor-container')!;

		this.addRowBtn = document.createElement('button') as HTMLButtonElement;
		this.addRowBtn.className = 'table-helper-btn table-add-row';
		this.addRowBtn.type = 'button';
		this.addRowBtn.title = 'Add row';
		this.addRowBtn.textContent = '+';
		this.addRowBtn.style.display = 'none';
		this.addRowBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.addRow();
		});
		this.addRowBtn.addEventListener('mouseenter', () => this.cancelHide());
		this.addRowBtn.addEventListener('mouseleave', () => this.scheduleHide());
		container.appendChild(this.addRowBtn);

		this.addColBtn = document.createElement('button') as HTMLButtonElement;
		this.addColBtn.className = 'table-helper-btn table-add-col';
		this.addColBtn.type = 'button';
		this.addColBtn.title = 'Add column';
		this.addColBtn.textContent = '+';
		this.addColBtn.style.display = 'none';
		this.addColBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.addCol();
		});
		this.addColBtn.addEventListener('mouseenter', () => this.cancelHide());
		this.addColBtn.addEventListener('mouseleave', () => this.scheduleHide());
		container.appendChild(this.addColBtn);

		// Listen for mouse events on editor root
		const root = editor.getRootElement();
		if (root) {
			const onMouseOver = (e: MouseEvent) => {
				const table = (e.target as HTMLElement).closest('table');
				if (table && root.contains(table)) {
					this.cancelHide();
					if (table !== this.activeTable) {
						this.activeTable = table as HTMLElement;
						this.positionHelpers();
					}
				}
			};
			const onMouseOut = (e: MouseEvent) => {
				const related = e.relatedTarget as HTMLElement | null;
				if (!related || (!related.closest('table') && !related.classList?.contains('table-helper-btn'))) {
					this.scheduleHide();
				}
			};
			root.addEventListener('mouseover', onMouseOver);
			root.addEventListener('mouseout', onMouseOut);
			this.cleanups.push(() => {
				root.removeEventListener('mouseover', onMouseOver);
				root.removeEventListener('mouseout', onMouseOut);
			});
		}
	}

	detach(): void {
		this.cleanups.forEach(fn => fn());
		this.cleanups = [];
		this.addRowBtn?.remove();
		this.addColBtn?.remove();
		this.addRowBtn = null;
		this.addColBtn = null;
		this.activeTable = null;
		this.editor = null;
		this.hostShadow = null;
	}

	private positionHelpers() {
		if (!this.addRowBtn || !this.addColBtn || !this.activeTable || !this.hostShadow) return;
		const container = this.hostShadow.querySelector('.editor-container')!;
		const editorRoot = this.hostShadow.querySelector('.editor-root') as HTMLElement;
		const tableRect = this.activeTable.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		const scrollTop = editorRoot?.scrollTop || 0;

		const top = tableRect.top - containerRect.top + scrollTop;
		const left = tableRect.left - containerRect.left;

		this.addRowBtn.style.display = 'flex';
		this.addRowBtn.style.top = (top + tableRect.height) + 'px';
		this.addRowBtn.style.left = left + 'px';
		this.addRowBtn.style.width = tableRect.width + 'px';

		this.addColBtn.style.display = 'flex';
		this.addColBtn.style.top = top + 'px';
		this.addColBtn.style.left = (left + tableRect.width) + 'px';
		this.addColBtn.style.height = tableRect.height + 'px';
	}

	private hideHelpers() {
		if (this.addRowBtn) this.addRowBtn.style.display = 'none';
		if (this.addColBtn) this.addColBtn.style.display = 'none';
		this.activeTable = null;
	}

	private scheduleHide() {
		this.cancelHide();
		this.hideTimeout = setTimeout(() => this.hideHelpers(), 200);
	}

	private cancelHide() {
		if (this.hideTimeout) {
			clearTimeout(this.hideTimeout);
			this.hideTimeout = null;
		}
	}

	private addRow() {
		if (!this.activeTable) return;
		this.editor?.update(() => {
			const tableNode = this.getTableNodeFromDom(this.activeTable!);
			if (!tableNode) return;
			const lastRow = tableNode.getLastChild();
			if (!$isTableRowNode(lastRow)) return;
			const lastCell = lastRow.getLastChild();
			if (!$isTableCellNode(lastCell)) return;
			lastCell.selectEnd();
			$insertTableRowAtSelection(true);
		});
		setTimeout(() => this.positionHelpers(), 50);
	}

	private addCol() {
		if (!this.activeTable) return;
		this.editor?.update(() => {
			const tableNode = this.getTableNodeFromDom(this.activeTable!);
			if (!tableNode) return;
			const firstRow = tableNode.getFirstChild();
			if (!$isTableRowNode(firstRow)) return;
			const lastCell = firstRow.getLastChild();
			if (!$isTableCellNode(lastCell)) return;
			lastCell.selectEnd();
			$insertTableColumnAtSelection(true);
		});
		setTimeout(() => this.positionHelpers(), 50);
	}

	private getTableNodeFromDom(tableDom: HTMLElement): TableNode | null {
		if (!this.editor) return null;
		let result: TableNode | null = null;
		this.editor.getEditorState().read(() => {
			const editorState = this.editor!.getEditorState();
			editorState._nodeMap.forEach((node: LexicalNode) => {
				if ($isTableNode(node)) {
					const dom = this.editor!.getElementByKey(node.getKey());
					if (dom === tableDom) {
						result = node as TableNode;
					}
				}
			});
		});
		return result;
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

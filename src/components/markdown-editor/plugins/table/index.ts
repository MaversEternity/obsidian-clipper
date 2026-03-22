import {
	type LexicalEditor, type Klass, type LexicalNode,
	$createParagraphNode, $createTextNode,
} from 'lexical';
import type { Transformer, MultilineElementTransformer } from '@lexical/markdown';
import type { ElementNode } from 'lexical';
import {
	TableNode, TableRowNode, TableCellNode,
	$createTableNode, $createTableRowNode, $createTableCellNode,
	$isTableNode, $isTableRowNode, $isTableCellNode,
	INSERT_TABLE_COMMAND, registerTablePlugin,
	TableCellHeaderStates,
	$insertTableRowAtSelection, $insertTableColumnAtSelection,
	$moveTableColumn,
} from '@lexical/table';
import type { EditorPlugin, ToolbarButtonDef } from '../../plugin-interface';
import { EditorPopover } from '../../components/editor-popover';

// --- Markdown transformer ---

const TABLE_LINE_RE = /^\|(.+)\|[ \t]*$/;
const SEPARATOR_RE = /^\|[\s\-:|]+\|$/;

const TABLE_TRANSFORMER: MultilineElementTransformer = {
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
	regExpStart: TABLE_LINE_RE,
	handleImportAfterStartMatch: ({ lines, startLineIndex, rootNode }) => {
		let endIndex = startLineIndex;
		for (let i = startLineIndex + 1; i < lines.length; i++) {
			if (TABLE_LINE_RE.test(lines[i].trim())) { endIndex = i; } else { break; }
		}
		if (endIndex === startLineIndex) return null;
		const allLines = lines.slice(startLineIndex, endIndex + 1);
		const dataLines = allLines.filter(line => !SEPARATOR_RE.test(line.trim()));
		if (dataLines.length === 0) return null;
		const tableNode = $createTableNode();
		dataLines.forEach((line, rowIndex) => {
			const cells = line.split('|').slice(1, -1).map(c => c.trim());
			const rowNode = $createTableRowNode();
			cells.forEach(cellText => {
				const headerState = rowIndex === 0 ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS;
				const cellNode = $createTableCellNode(headerState);
				const paragraph = $createParagraphNode();
				paragraph.append($createTextNode(cellText.replace(/\\\|/g, '|')));
				cellNode.append(paragraph);
				rowNode.append(cellNode);
			});
			tableNode.append(rowNode);
		});
		rootNode.append(tableNode);
		return [true, endIndex] as [boolean, number];
	},
	replace: () => {},
	type: 'multiline-element',
};

// --- Helper HTML (built once, positioned via CSS custom props) ---

function createHelperDOM(): HTMLElement {
	const el = document.createElement('div');
	el.className = 'table-helpers';
	el.innerHTML = `
		<div class="table-add-row" data-action="add-row">+</div>
		<div class="table-add-col" data-action="add-col">+</div>
		<div class="table-row-handle">
			<button class="handle-arrow" data-action="row-up">▲</button>
			<span class="handle-grip" data-action="row-select">⠿</span>
			<button class="handle-arrow" data-action="row-down">▼</button>
		</div>
		<div class="table-col-handle">
			<button class="handle-arrow" data-action="col-left">◀</button>
			<span class="handle-grip" data-action="col-select">⠿</span>
			<button class="handle-arrow" data-action="col-right">▶</button>
		</div>
	`;
	return el;
}

// --- Plugin ---

export class EditorPluginTable extends HTMLElement implements EditorPlugin {
	private editor: LexicalEditor | null = null;
	private hostShadow: ShadowRoot | null = null;
	private cleanups: (() => void)[] = [];
	private helpers: HTMLElement | null = null;
	private activeTable: HTMLElement | null = null;
	private hoveredRowIdx = -1;
	private hoveredColIdx = -1;
	private selectedRowIdx = -1;
	private selectedColIdx = -1;
	private hideTimer: ReturnType<typeof setTimeout> | null = null;

	getNodes(): Klass<LexicalNode>[] { return [TableNode, TableRowNode, TableCellNode]; }
	getTransformers(): Transformer[] { return [TABLE_TRANSFORMER]; }

	getToolbarButton(): ToolbarButtonDef | null {
		return {
			action: 'table', title: 'Insert table',
			icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
			onAction: () => this.showTableDialog(),
		};
	}

	attach(editor: LexicalEditor, hostShadow: ShadowRoot): void {
		this.editor = editor;
		this.hostShadow = hostShadow;
		this.cleanups.push(registerTablePlugin(editor));

		// Create helpers once, append to editor-container
		this.helpers = createHelperDOM();
		const container = hostShadow.querySelector('.editor-container')!;
		container.appendChild(this.helpers);

		// Single delegated click handler for all helper actions
		this.helpers.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const action = (e.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action');
			if (action) this.handleAction(action);
		});

		// Keep helpers visible when hovering them
		this.helpers.addEventListener('mouseenter', () => this.cancelHide());
		this.helpers.addEventListener('mouseleave', () => this.scheduleHide());

		// Delete selected row/col on Backspace/Delete
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Backspace' && e.key !== 'Delete') return;
			if (this.selectedRowIdx >= 0) {
				e.preventDefault();
				this.deleteSelectedRow();
			} else if (this.selectedColIdx >= 0) {
				e.preventDefault();
				this.deleteSelectedCol();
			}
		};
		hostShadow.addEventListener('keydown', onKeyDown as EventListener);
		this.cleanups.push(() => hostShadow.removeEventListener('keydown', onKeyDown as EventListener));

		// Mouse tracking on editor root
		const root = editor.getRootElement();
		if (root) {
			const onMove = (e: MouseEvent) => {
				const target = e.target as HTMLElement;
				const table = target.closest('table');
				if (table && root.contains(table)) {
					this.cancelHide();
					this.activeTable = table as HTMLElement;
					this.updatePosition();
					// Track hovered row/col
					const cell = target.closest('td, th') as HTMLElement;
					if (cell) {
						const row = cell.closest('tr')!;
						this.hoveredRowIdx = Array.from(table.querySelectorAll('tr')).indexOf(row);
						this.hoveredColIdx = Array.from(row.children).indexOf(cell);
						this.updateHandlePositions(cell, row, table as HTMLElement);
					}
				}
			};
			const onLeave = (e: MouseEvent) => {
				const related = e.relatedTarget as HTMLElement | null;
				if (!related || (!related.closest('table') && !related.closest('.table-helpers'))) {
					this.scheduleHide();
				}
			};
			root.addEventListener('mousemove', onMove);
			root.addEventListener('mouseleave', onLeave);
			this.cleanups.push(() => {
				root.removeEventListener('mousemove', onMove);
				root.removeEventListener('mouseleave', onLeave);
			});
		}
	}

	detach(): void {
		this.cleanups.forEach(fn => fn());
		this.cleanups = [];
		this.helpers?.remove();
		this.helpers = null;
		this.activeTable = null;
		this.editor = null;
		this.hostShadow = null;
	}

	// --- Position helpers via CSS custom properties ---

	private updatePosition() {
		if (!this.helpers || !this.activeTable || !this.hostShadow) return;
		const container = this.hostShadow.querySelector('.editor-container')!;
		const cRect = container.getBoundingClientRect();
		const tRect = this.activeTable.getBoundingClientRect();
		const s = this.helpers.style;
		s.setProperty('--t-top', `${tRect.top - cRect.top}px`);
		s.setProperty('--t-left', `${tRect.left - cRect.left}px`);
		s.setProperty('--t-width', `${tRect.width}px`);
		s.setProperty('--t-height', `${tRect.height}px`);
		this.helpers.setAttribute('data-visible', '');
	}

	private updateHandlePositions(cell: HTMLElement, row: HTMLElement, table: HTMLElement) {
		if (!this.helpers || !this.hostShadow) return;
		const tRect = table.getBoundingClientRect();
		const rRect = row.getBoundingClientRect();
		const cellRect = cell.getBoundingClientRect();
		const s = this.helpers.style;

		// Row handle position (relative to table-helpers container)
		s.setProperty('--rh-top', `${rRect.top - tRect.top}px`);
		s.setProperty('--rh-height', `${rRect.height}px`);

		// Col handle position
		s.setProperty('--ch-left', `${cellRect.left - tRect.left}px`);
		s.setProperty('--ch-width', `${cellRect.width}px`);
	}

	private hide() {
		this.helpers?.removeAttribute('data-visible');
		this.clearHighlights();
		this.activeTable = null;
		this.hoveredRowIdx = -1;
		this.hoveredColIdx = -1;
		this.selectedRowIdx = -1;
		this.selectedColIdx = -1;
	}

	private scheduleHide() {
		this.cancelHide();
		this.hideTimer = setTimeout(() => this.hide(), 250);
	}

	private cancelHide() {
		if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
	}

	// --- Actions ---

	private handleAction(action: string) {
		switch (action) {
			case 'add-row': return this.addRow();
			case 'add-col': return this.addCol();
			case 'row-up': return this.moveRow(-1);
			case 'row-down': return this.moveRow(1);
			case 'col-left': return this.moveCol(-1);
			case 'col-right': return this.moveCol(1);
			case 'row-select': return this.selectRow();
			case 'col-select': return this.selectCol();
		}
	}

	private addRow() {
		this.withTable(t => {
			const lastRow = t.getLastChild();
			if (!$isTableRowNode(lastRow)) return;
			const lastCell = lastRow.getLastChild();
			if (!$isTableCellNode(lastCell)) return;
			lastCell.selectEnd();
			$insertTableRowAtSelection(true);
		});
	}

	private addCol() {
		this.withTable(t => {
			const firstRow = t.getFirstChild();
			if (!$isTableRowNode(firstRow)) return;
			const lastCell = firstRow.getLastChild();
			if (!$isTableCellNode(lastCell)) return;
			lastCell.selectEnd();
			$insertTableColumnAtSelection(true);
		});
	}

	private moveRow(direction: -1 | 1) {
		const idx = this.hoveredRowIdx;
		this.withTable(t => {
			const rows = t.getChildren();
			const target = idx + direction;
			if (target < 0 || target >= rows.length) return;
			const row = rows[idx];
			const targetRow = rows[target];
			if (!$isTableRowNode(row) || !$isTableRowNode(targetRow)) return;
			row.remove();
			if (direction < 0) targetRow.insertBefore(row);
			else targetRow.insertAfter(row);
		});
		this.hoveredRowIdx += direction;
	}

	private moveCol(direction: -1 | 1) {
		const idx = this.hoveredColIdx;
		this.withTable(t => {
			const firstRow = t.getFirstChild();
			if (!$isTableRowNode(firstRow)) return;
			const colCount = firstRow.getChildrenSize();
			const target = idx + direction;
			if (target < 0 || target >= colCount) return;
			$moveTableColumn(t, idx, target);
		});
		this.hoveredColIdx += direction;
	}

	private selectRow() {
		if (!this.activeTable) return;
		const wasSelected = this.selectedRowIdx === this.hoveredRowIdx;
		this.clearHighlights();
		if (!wasSelected) {
			this.selectedRowIdx = this.hoveredRowIdx;
			this.activeTable.querySelectorAll('tr')[this.hoveredRowIdx]?.classList.add('table-row-selected');
		}
	}

	private selectCol() {
		if (!this.activeTable) return;
		const wasSelected = this.selectedColIdx === this.hoveredColIdx;
		this.clearHighlights();
		if (!wasSelected) {
			this.selectedColIdx = this.hoveredColIdx;
			Array.from(this.activeTable.querySelectorAll('tr')).forEach(row => {
				row.children[this.hoveredColIdx]?.classList.add('table-col-selected');
			});
		}
	}

	private clearHighlights() {
		this.activeTable?.querySelectorAll('.table-row-selected, .table-col-selected').forEach(el => {
			el.classList.remove('table-row-selected', 'table-col-selected');
		});
		this.selectedRowIdx = -1;
		this.selectedColIdx = -1;
	}

	private deleteSelectedRow() {
		const idx = this.selectedRowIdx;
		this.withTable(t => {
			const rows = t.getChildren();
			if (rows.length <= 1) return; // Don't delete last row
			const row = rows[idx];
			if ($isTableRowNode(row)) row.remove();
		});
		this.clearHighlights();
	}

	private deleteSelectedCol() {
		const idx = this.selectedColIdx;
		this.withTable(t => {
			const firstRow = t.getFirstChild();
			if (!$isTableRowNode(firstRow)) return;
			if (firstRow.getChildrenSize() <= 1) return; // Don't delete last col
			// Remove cell at idx from every row
			for (const row of t.getChildren()) {
				if (!$isTableRowNode(row)) continue;
				const cells = row.getChildren();
				if (cells[idx] && $isTableCellNode(cells[idx])) {
					cells[idx].remove();
				}
			}
		});
		this.clearHighlights();
	}

	private withTable(fn: (t: TableNode) => void) {
		if (!this.activeTable || !this.editor) return;
		const tableNode = this.findTableNode(this.activeTable);
		if (!tableNode) return;
		this.editor.update(() => fn(tableNode));
		setTimeout(() => this.updatePosition(), 30);
	}

	private findTableNode(dom: HTMLElement): TableNode | null {
		if (!this.editor) return null;
		let result: TableNode | null = null;
		this.editor.getEditorState().read(() => {
			this.editor!.getEditorState()._nodeMap.forEach((node: LexicalNode) => {
				if ($isTableNode(node) && this.editor!.getElementByKey(node.getKey()) === dom) {
					result = node as TableNode;
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
			rows: String(rows), columns: String(cols),
			includeHeaders: { rows: true, columns: false },
		});
	}
}

if (!customElements.get('editor-plugin-table')) {
	customElements.define('editor-plugin-table', EditorPluginTable);
}

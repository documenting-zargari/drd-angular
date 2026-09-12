/**
 * Turn a declarative `TableSpec` + the answers for a sample into a flat
 * `RenderTable[]` the component template walks directly.
 *
 * This service owns *all* the span math that the legacy `tables.component.ts`
 * spread across `parseTableElement`, `expandForeachRow`, `mergeStartContinueSpans`
 * and `applySpanFlagsToTemplateRow`. It is pure: no DOM, no HTTP, no Angular
 * lifecycle — just data in, render model out.
 *
 * Row-header merging: a label at depth `d` spans down any run of consecutive
 * body rows that share `labels[0..d]` (the leaf also requires equal
 * `labels.length`). The stored label tree *is* the merge — the old
 * `data-rowspan="start|continue|true"` markers and native `<th rowspan>` are
 * gone, folded into repeated labels by the converter.
 */

import { Injectable } from '@angular/core';
import { resolveText } from './field-eval';
import {
  CellBinding,
  GridRow,
  RenderCell,
  RenderRow,
  RenderTable,
  SpecRow,
  TableDef,
  TableSpec,
  TemplateRow,
  isTemplateRow,
} from './table-spec.model';

export interface RenderOptions {
  editMode?: boolean;
  canEdit?: boolean;
}

interface Scaffold {
  /** full-width label vector for this body row (length = rowHeaderWidth) */
  labels: string[];
  /** originating spec-row index (group id) */
  group: number;
  dataCells: RenderCell[];
  /** placeholder for the addAnswer row */
  addAnswer?: { questionId: number };
}

@Injectable({ providedIn: 'root' })
export class TableSpecRendererService {
  buildRenderModel(
    spec: TableSpec | null,
    answersByQuestion: Map<number, any[]>,
    opts: RenderOptions = {},
  ): RenderTable[] {
    if (!spec) return [];
    const out: RenderTable[] = [];
    for (const section of spec.sections) {
      for (const table of section.tables) {
        out.push(this.renderTable(table, section.heading, answersByQuestion, opts));
      }
    }
    return out;
  }

  private renderTable(
    table: TableDef,
    sectionHeading: string | null,
    answersByQuestion: Map<number, any[]>,
    opts: RenderOptions,
  ): RenderTable {
    const columnHeaderRows: RenderCell[][] = table.columnHeader.map((hrow) =>
      hrow.map((hc) => ({
        kind: 'colHeader' as const,
        text: hc.label ?? '',
        colspan: hc.colspan ?? 1,
        rowspan: hc.rowspan ?? 1,
        hidden: false,
      })),
    );

    const scaffolds = this.buildScaffolds(table, answersByQuestion, opts);
    const rowHeaderCells = this.mergeLabels(scaffolds, table.rowHeaderWidth);

    const bodyRows: RenderRow[] = scaffolds.map((s, i) => {
      if (s.addAnswer) {
        const width =
          table.rowHeaderWidth + table.columns.length || 1;
        return {
          cells: [
            {
              kind: 'addAnswer',
              text: '',
              colspan: width,
              rowspan: 1,
              hidden: false,
              questionId: s.addAnswer.questionId,
            },
          ],
        };
      }
      return { cells: [...rowHeaderCells[i], ...s.dataCells] };
    });

    return {
      sectionHeading,
      caption: table.caption ?? null,
      columnHeaderRows,
      bodyRows,
    };
  }

  // --- body scaffolds --------------------------------------------------------

  private buildScaffolds(
    table: TableDef,
    answersByQuestion: Map<number, any[]>,
    opts: RenderOptions,
  ): Scaffold[] {
    const scaffolds: Scaffold[] = [];
    const editable = !!opts.editMode && !!opts.canEdit;

    table.rows.forEach((row, groupIdx) => {
      if (isTemplateRow(row)) {
        const answers = answersByQuestion.get(row.questionId) ?? [];
        const n = Math.max(1, answers.length);
        for (let i = 0; i < n; i++) {
          scaffolds.push({
            labels: this.padLabels(row.labels, table.rowHeaderWidth),
            group: groupIdx,
            dataCells: table.columns.map((col) =>
              this.dataCell(col.cell, row.questionId, answers[i] ? [answers[i]] : []),
            ),
          });
        }
        if (editable && answers.length >= 1) {
          scaffolds.push({
            labels: this.padLabels(row.labels, table.rowHeaderWidth),
            group: groupIdx,
            dataCells: [],
            addAnswer: { questionId: row.questionId },
          });
        }
      } else {
        const grid = row as GridRow;
        scaffolds.push({
          labels: this.padLabels(grid.labels, table.rowHeaderWidth),
          group: groupIdx,
          dataCells: grid.cells.map((binding) => {
            const answers = binding?.questionId
              ? answersByQuestion.get(binding.questionId) ?? []
              : [];
            return this.dataCell(binding, binding?.questionId, answers);
          }),
        });
      }
    });

    return scaffolds;
  }

  private dataCell(
    binding: CellBinding | null | undefined,
    questionId: number | undefined,
    answers: any[],
  ): RenderCell {
    return {
      kind: 'data',
      text: resolveText(answers, binding ?? null),
      colspan: 1,
      rowspan: 1,
      hidden: false,
      questionId: binding?.questionId ?? questionId,
      field: binding?.field,
      answerKey: answers.length === 1 ? answers[0]?._key : undefined,
    };
  }

  private padLabels(labels: string[], width: number): string[] {
    const out = labels.slice(0, Math.max(width, labels.length));
    return out;
  }

  // --- row-header label merging -------------------------------------------

  private mergeLabels(scaffolds: Scaffold[], width: number): RenderCell[][] {
    const perRow: RenderCell[][] = scaffolds.map(() => []);
    if (width <= 0) return perRow;

    for (let d = 0; d < width; d++) {
      let i = 0;
      while (i < scaffolds.length) {
        const li = scaffolds[i].labels;
        if (scaffolds[i].addAnswer || d >= li.length) {
          i++;
          continue;
        }
        const isLeaf = d === li.length - 1;
        let j = i + 1;
        while (j < scaffolds.length) {
          const lj = scaffolds[j].labels;
          if (scaffolds[j].addAnswer || d >= lj.length) break;
          const prefixEqual = li.slice(0, d + 1).every((x, k) => x === lj[k]);
          if (!prefixEqual) break;
          if (isLeaf && lj.length !== li.length) break;
          j++;
        }
        perRow[i][d] = {
          kind: 'rowHeader',
          text: li[d],
          colspan: isLeaf ? width - d : 1,
          rowspan: j - i,
          hidden: false,
        };
        for (let k = i + 1; k < j; k++) {
          perRow[k][d] = { kind: 'rowHeader', text: '', colspan: 1, rowspan: 1, hidden: true };
        }
        i = j;
      }
    }

    // compact each row's header cells to positional order, dropping hidden
    // placeholders that sit under a leaf's colspan.
    return perRow.map((cells) => {
      const compact: RenderCell[] = [];
      let covered = 0;
      for (let d = 0; d < width; d++) {
        if (covered > 0) {
          covered--;
          continue;
        }
        const cell = cells[d];
        if (!cell) continue;
        compact.push(cell);
        if (!cell.hidden && cell.colspan > 1) covered = cell.colspan - 1;
      }
      return compact;
    });
  }
}

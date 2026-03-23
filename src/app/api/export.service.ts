import { Injectable } from '@angular/core';

export type ExportFormat = 'csv' | 'json';
export type ExportMode = 'list' | 'comparison';

interface ExportFormatter {
  serialize(columns: string[], rows: Record<string, string>[]): string;
  mimeType: string;
  extension: string;
}

@Injectable({
  providedIn: 'root'
})
export class ExportService {

  private formatters: Record<string, ExportFormatter> = {
    csv: {
      mimeType: 'text/csv;charset=utf-8;',
      extension: 'csv',
      serialize(columns: string[], rows: Record<string, string>[]): string {
        const escapeCell = (value: string): string => {
          if (value.includes('"') || value.includes(',') || value.includes('\n')) {
            return '"' + value.replace(/"/g, '""') + '"';
          }
          return value;
        };

        const lines: string[] = [];
        lines.push(columns.map(escapeCell).join(','));
        for (const row of rows) {
          lines.push(columns.map(col => escapeCell(row[col] ?? '')).join(','));
        }
        return lines.join('\n');
      }
    },
    json: {
      mimeType: 'application/json;charset=utf-8;',
      extension: 'json',
      serialize(columns: string[], rows: Record<string, string>[]): string {
        // Keep only the columns that exist, in order
        const filtered = rows.map(row => {
          const obj: Record<string, string> = {};
          for (const col of columns) {
            if (row[col] !== undefined && row[col] !== '') {
              obj[col] = row[col];
            }
          }
          return obj;
        });
        return JSON.stringify(filtered, null, 2);
      }
    }
  };

  /**
   * Export search results in list mode (one row per answer record).
   */
  exportList(
    results: any[],
    hiddenFields: string[],
    format: ExportFormat = 'csv',
    filename?: string
  ): void {
    const { columns, rows } = this.buildListData(results, hiddenFields);
    this.download(columns, rows, format, filename ?? 'search-results');
  }

  /**
   * Export search results in comparison mode (one row per sample, pivoted by question).
   */
  exportComparison(
    results: any[],
    questionColumns: { id: any; displayName: string }[],
    getAnswerValue: (result: any) => string,
    format: ExportFormat = 'csv',
    filename?: string
  ): void {
    const { columns, rows } = this.buildComparisonData(results, questionColumns, getAnswerValue);
    this.download(columns, rows, format, filename ?? 'comparison-results');
  }

  private buildListData(
    results: any[],
    hiddenFields: string[]
  ): { columns: string[]; rows: Record<string, string>[] } {
    const hiddenSet = new Set(hiddenFields);
    const priorityColumns = ['sample'];
    const columnOrder: string[] = [];
    const columnSet = new Set<string>();

    // Pass 1: collect all unique keys across all records, in order of first appearance
    for (const result of results) {
      for (const key of Object.keys(result)) {
        if (!hiddenSet.has(key) && !key.endsWith('_id') && !columnSet.has(key)) {
          columnSet.add(key);
          columnOrder.push(key);
        }
      }
    }

    // Build final column list: priority columns first, then rest in discovery order
    const columns: string[] = [];
    for (const col of priorityColumns) {
      if (columnSet.has(col)) {
        columns.push(col);
      }
    }
    for (const col of columnOrder) {
      if (!columns.includes(col)) {
        columns.push(col);
      }
    }

    // Pass 2: flatten each record into a row
    const rows = results.map(result => {
      const row: Record<string, string> = {};
      for (const col of columns) {
        row[col] = this.flattenValue(result[col], col);
      }
      return row;
    });

    return { columns, rows };
  }

  private buildComparisonData(
    results: any[],
    questionColumns: { id: any; displayName: string }[],
    getAnswerValue: (result: any) => string
  ): { columns: string[]; rows: Record<string, string>[] } {
    // Group results by sample, collecting answer values per question
    const sampleMap = new Map<string, Map<string, string[]>>();

    for (const result of results) {
      const sampleRef = result.sample;
      if (!sampleMap.has(sampleRef)) {
        sampleMap.set(sampleRef, new Map());
      }

      const questionId = String(result.question_id ?? result.category);
      const answer = getAnswerValue(result);
      const answers = sampleMap.get(sampleRef)!;

      if (!answers.has(questionId)) {
        answers.set(questionId, [answer]);
      } else {
        const arr = answers.get(questionId)!;
        if (answer !== '-' && !arr.includes(answer)) {
          arr.push(answer);
        }
      }
    }

    // Build columns: sample + one per question
    const columns = ['sample', ...questionColumns.map(q => q.displayName)];

    // Build rows: one per sample
    const rows: Record<string, string>[] = [];
    const sortedSamples = Array.from(sampleMap.keys()).sort();

    for (const sampleRef of sortedSamples) {
      const row: Record<string, string> = { sample: sampleRef };
      const answers = sampleMap.get(sampleRef)!;

      for (const qCol of questionColumns) {
        const qId = String(qCol.id);
        const vals = answers.get(qId);
        row[qCol.displayName] = vals ? vals.join(', ') : '';
      }

      rows.push(row);
    }

    return { columns, rows };
  }

  /**
   * Flatten a value for CSV/JSON output.
   * Objects are flattened to dot-notation, arrays are joined.
   */
  private flattenValue(value: any, prefix: string): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map(v => this.flattenValue(v, prefix)).join('; ');
    }
    if (typeof value === 'object') {
      // Flatten object to "key: value" pairs
      const parts: string[] = [];
      for (const [k, v] of Object.entries(value)) {
        const flat = this.flattenValue(v, `${prefix}.${k}`);
        if (flat) {
          parts.push(`${k}: ${flat}`);
        }
      }
      return parts.join(', ');
    }
    return String(value);
  }

  private download(
    columns: string[],
    rows: Record<string, string>[],
    format: ExportFormat,
    filename: string
  ): void {
    const formatter = this.formatters[format];
    if (!formatter) {
      console.error(`Unknown export format: ${format}`);
      return;
    }

    const content = formatter.serialize(columns, rows);
    const blob = new Blob(['\uFEFF' + content], { type: formatter.mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.${formatter.extension}`;
    link.click();

    URL.revokeObjectURL(url);
  }
}

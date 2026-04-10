import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ANSWER_VALUE_FIELDS } from './data.service';

export type ExportFormat = 'csv' | 'json';
export type ExportMode = 'list' | 'comparison';

export interface SampleDetails {
  dialect_group_name: string;
  location: string;
  latitude: string;
  longitude: string;
  'Current-L2': string;
  'Recent-L2': string;
  'Old-L2': string;
}

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
   * Fetch data from an observable and immediately download it.
   * Components supply the source observable and handle loading state themselves.
   *
   * Usage:
   *   this.exportLoading = true;
   *   this.exportService.downloadFromSource(this.dataService.exportPhrases(...), format, 'filename')
   *     .pipe(finalize(() => this.exportLoading = false))
   *     .subscribe({ error: () => {} });
   */
  downloadFromSource(
    source$: Observable<any[]>,
    format: ExportFormat,
    filename: string,
    hiddenFields: string[] = ['_id', '_key', '_rev']
  ): Observable<void> {
    return source$.pipe(
      map(data => { this.exportList(data, hiddenFields, [], format, filename); })
    );
  }

  /**
   * Export search results in list mode (one row per answer record).
   */
  exportList(
    results: any[],
    hiddenFields: string[],
    answerFields: string[] = ANSWER_VALUE_FIELDS,
    format: ExportFormat = 'csv',
    filename?: string,
    sampleDetails?: Map<string, SampleDetails>
  ): void {
    const { columns, rows } = this.buildListData(results, hiddenFields, answerFields, sampleDetails);
    this.download(columns, rows, format, filename ?? 'search-results');
  }

  /**
   * Export search results in comparison mode (one row per sample, pivoted by question).
   */
  exportComparison(
    results: any[],
    questionColumns: { id: any; displayName: string; hierarchy?: string[] }[],
    getAnswerValue: (result: any) => string,
    format: ExportFormat = 'csv',
    filename?: string,
    sampleDetails?: Map<string, SampleDetails>
  ): void {
    const { columns, rows } = this.buildComparisonData(results, questionColumns, getAnswerValue, sampleDetails);
    this.download(columns, rows, format, filename ?? 'comparison-results');
  }

  private buildListData(
    results: any[],
    hiddenFields: string[],
    answerFields: string[],
    sampleDetails?: Map<string, SampleDetails>
  ): { columns: string[]; rows: Record<string, string>[] } {
    const hiddenSet = new Set(hiddenFields);
    const priorityColumns = ['sample'];
    const detailColumns = sampleDetails ? ['location', 'latitude', 'longitude', 'dialect_group_name', 'Current-L2', 'Recent-L2', 'Old-L2'] : [];
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

    // Determine which answer field is present in the data (first match wins)
    const answerField = answerFields.find(f => columnSet.has(f))
      ?? columnOrder.find(f => !priorityColumns.includes(f));

    // Build final column list: sample first, then sample details, then attributes, answer field last
    const columns: string[] = [];
    for (const col of priorityColumns) {
      if (columnSet.has(col)) {
        columns.push(col);
      }
    }
    for (const col of detailColumns) {
      columns.push(col);
    }
    for (const col of columnOrder) {
      if (!columns.includes(col) && col !== answerField) {
        columns.push(col);
      }
    }
    if (answerField) {
      columns.push(answerField);
    }

    // Pass 2: flatten each record into a row
    const rows = results.map(result => {
      const row: Record<string, string> = {};
      for (const col of columns) {
        row[col] = this.flattenValue(result[col], col);
      }
      if (sampleDetails) {
        const details = sampleDetails.get(result.sample);
        if (details) {
          for (const col of detailColumns) {
            row[col] = (details as any)[col] ?? '';
          }
        }
      }
      return row;
    });

    return { columns, rows };
  }

  private buildComparisonData(
    results: any[],
    questionColumns: { id: any; displayName: string; hierarchy?: string[] }[],
    getAnswerValue: (result: any) => string,
    sampleDetails?: Map<string, SampleDetails>
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

    // Build unique column headers, disambiguating duplicates with hierarchy
    const columnHeaders = this.buildUniqueColumnHeaders(questionColumns);
    const detailColumns = sampleDetails ? ['location', 'latitude', 'longitude', 'dialect_group_name', 'Current-L2', 'Recent-L2', 'Old-L2'] : [];

    // sample, then sample details, then question columns
    const columns = ['sample', ...detailColumns, ...columnHeaders.map(h => h.header)];

    // Build rows: one per sample
    const rows: Record<string, string>[] = [];
    const sortedSamples = Array.from(sampleMap.keys()).sort();

    for (const sampleRef of sortedSamples) {
      const row: Record<string, string> = { sample: sampleRef };

      if (sampleDetails) {
        const details = sampleDetails.get(sampleRef);
        if (details) {
          for (const col of detailColumns) {
            row[col] = (details as any)[col] ?? '';
          }
        }
      }

      const answers = sampleMap.get(sampleRef)!;
      for (const col of columnHeaders) {
        const vals = answers.get(col.id);
        row[col.header] = vals ? vals.join(', ') : '';
      }

      rows.push(row);
    }

    return { columns, rows };
  }

  /**
   * Build unique column headers from question columns.
   * If multiple columns share the same displayName, prepend hierarchy to disambiguate.
   */
  private buildUniqueColumnHeaders(
    questionColumns: { id: any; displayName: string; hierarchy?: string[] }[]
  ): { id: string; header: string }[] {
    // Check for duplicate display names
    const nameCounts = new Map<string, number>();
    for (const col of questionColumns) {
      nameCounts.set(col.displayName, (nameCounts.get(col.displayName) ?? 0) + 1);
    }

    return questionColumns.map(col => {
      const id = String(col.id);
      let header = col.displayName;

      if ((nameCounts.get(col.displayName) ?? 0) > 1) {
        // Disambiguate using hierarchy
        if (col.hierarchy && col.hierarchy.length > 0) {
          header = col.hierarchy.join(' > ') + ' > ' + col.displayName;
        } else {
          // Fallback: append question ID
          header = `${col.displayName} (${id})`;
        }
      }

      return { id, header };
    });
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

  download(
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

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../api/data.service';
import { SearchStateService } from '../api/search-state.service';
import { SampleSelectionComponent } from '../shared/sample-selection/sample-selection.component';
import { inject } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-tables',
  imports: [CommonModule, FormsModule, SampleSelectionComponent],
  templateUrl: './tables.component.html',
  styleUrl: './tables.component.scss'
})
export class TablesComponent implements OnInit {
  views: any[] = [];
  selectedView: any = null;
  tableData: { mainHeading?: string; sections: any[] } | null = null;
  
  selectedSample: any = null;

  // Answer data properties
  cellMetadata: any[] = [];
  answerData: { [key: string]: any } = {};
  categoryData: { [key: string]: any } = {};
  isLoadingAnswers: boolean = false;
  currentCategoryIds: number[] = []; // Store category IDs for current table

  private searchStateService = inject(SearchStateService);

  constructor(private dataService: DataService) { }

  ngOnInit(): void {
    // Load views - check cache first
    const cachedViews = this.searchStateService.getViewsCache();
    if (cachedViews) {
      this.views = cachedViews.sort((a: any, b: any) => a.parent_id - b.parent_id);
    } else {
      this.dataService.getViews().subscribe({
        next: (views) => {
          this.views = views.sort((a: any, b: any) => a.parent_id - b.parent_id);
          this.searchStateService.setViewsCache(views);
        },
        error: (err: any) => {
          console.error('Error fetching views:', err);
        }
      });
    }

    // Load current sample from global state
    this.selectedSample = this.searchStateService.getCurrentSample();
  }

  selectView(view: any): void {
    this.selectedView = view;
    this.parseTableContent(view.content);
    if (this.selectedSample && this.cellMetadata.length > 0) {
      this.fetchAnswersForTable();
    }
  }

  backToList(): void {
    this.selectedView = null;
    this.tableData = null;
    this.cellMetadata = [];
    this.currentCategoryIds = [];
    this.answerData = {};
  }

  parseTableContent(htmlContent: string): void {
    if (!htmlContent) {
      this.tableData = null;
      this.cellMetadata = [];
      return;
    }

    try {
      // Create a temporary DOM element to parse the HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;

      // Process all elements in sequence, grouping tables by their sections
      const allElements = tempDiv.children;
      const sections: any[] = [];
      const allMetadata: any[] = [];
      
      let mainHeading = '';
      let currentSectionHeading = '';
      let currentSectionTables: any[] = [];
      let currentSectionMetadata: any[] = [];
      
      const flushCurrentSection = () => {
        if (currentSectionTables.length > 0) {
          sections.push({
            type: 'section-group',
            heading: currentSectionHeading,
            tables: currentSectionTables
          });
          
          allMetadata.push({
            type: 'section-group',
            metadata: currentSectionMetadata
          });
          
          currentSectionTables = [];
          currentSectionMetadata = [];
        }
      };
      
      for (let i = 0; i < allElements.length; i++) {
        const element = allElements[i];
        
        if (element.tagName.toLowerCase() === 'h1') {
          mainHeading = element.textContent?.trim() || '';
          
        } else if (element.tagName.toLowerCase() === 'h2') {
          // Flush previous section before starting new one
          flushCurrentSection();
          currentSectionHeading = element.textContent?.trim() || '';
          
        } else if (element.tagName.toLowerCase() === 'table') {
          // Extract table caption if present
          const caption = this.extractTableCaption(element);
          const tableResult = this.parseTableElement(element);
          
          currentSectionTables.push({
            type: 'table',
            caption: caption,
            headers: tableResult.headers,
            headerSpans: tableResult.headerSpans,
            rows: tableResult.rows
          });
          
          currentSectionMetadata.push({
            type: 'table',
            metadata: tableResult.metadata
          });
        }
      }
      
      // Flush any remaining section
      flushCurrentSection();

      this.tableData = { mainHeading, sections };
      this.cellMetadata = allMetadata;
      
      console.log('Parsed sections:', this.tableData);
      console.log('Parsed metadata:', this.cellMetadata);
    } catch (error) {
      console.error('Error parsing table content:', error);
      this.tableData = null;
      this.cellMetadata = [];
    }
  }

  private extractTableCaption(table: Element): string {
    const caption = table.querySelector('caption');
    return caption ? caption.textContent?.trim() || '' : '';
  }

  private parseTableElement(table: Element): { headers: string[], headerSpans: any[], rows: any[], metadata: any[] } {
    const allRows = table.querySelectorAll('tbody tr') || table.querySelectorAll('tr');
    const headers: string[] = [];
    const headerSpans: any[] = [];
    const rows: any[] = [];
    const metadata: any[] = [];
    
    let startIndex = 0;
    let hasHeaders = true;

    // Check if we have proper headers
    if (allRows.length > 0) {
      const firstRow = allRows[0];
      const firstRowCells = firstRow.querySelectorAll('th, td');
      
      // Check if first row contains JSON data (indicating no headers)
      let hasJsonInFirstRow = false;
      firstRowCells.forEach(cell => {
        const cellText = cell.textContent?.trim() || '';
        if (this.containsJsonPattern(cellText) || this.containsForeachPattern(cellText)) {
          hasJsonInFirstRow = true;
        }
      });
      
      hasHeaders = !hasJsonInFirstRow;
      startIndex = hasHeaders ? 1 : 0;
    }

    // Extract headers if they exist, including colspan/rowspan
    if (hasHeaders && allRows.length > 0) {
      const headerRows = table.querySelectorAll('thead tr') || [allRows[0]];
      
      // Process all header rows to handle complex headers
      for (let headerRowIndex = 0; headerRowIndex < headerRows.length; headerRowIndex++) {
        const headerRow = headerRows[headerRowIndex];
        const headerCells = headerRow.querySelectorAll('th, td');
        
        headerCells.forEach(cell => {
          const cellText = cell.textContent?.trim() || '';
          const colspan = parseInt(cell.getAttribute('colspan') || '1');
          const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
          
          headers.push(cellText);
          headerSpans.push({ colspan, rowspan });
        });
      }
      
      // Adjust start index if we have multiple header rows
      if (table.querySelector('thead')) {
        startIndex = 0; // tbody rows start from 0
      } else {
        startIndex = headerRows.length;
      }
    }

    // Process data rows
    for (let i = startIndex; i < allRows.length; i++) {
      const row = allRows[i];
      const cells = row.querySelectorAll('td, th');
      const rowData: any[] = [];
      const rowMetadata: any[] = [];
      const rowSpans: any[] = [];
      
      cells.forEach(cell => {
        const cellText = cell.textContent?.trim() || '';
        const cellResult = this.parseCellContent(cellText);
        const colspan = parseInt(cell.getAttribute('colspan') || '1');
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
        const isHeader = cell.tagName.toLowerCase() === 'th';
        
        rowData.push(cellResult.data);
        rowMetadata.push(cellResult.metadata);
        rowSpans.push({ colspan, rowspan, isHeader });
      });
      
      if (rowData.length > 0) {
        rows.push({ type: 'data', cells: rowData, spans: rowSpans });
        metadata.push({ type: 'data', cells: rowMetadata });
      }
    }

    return { headers, headerSpans, rows, metadata };
  }

  private parseCellContent(cellText: string): { data: any, metadata: any } {
    // Check for [foreach] pattern
    if (this.containsForeachPattern(cellText)) {
      return this.parseForeachCell(cellText);
    }
    
    // Check for simple JSON pattern
    if (this.containsJsonPattern(cellText)) {
      const jsonData = this.extractJsonFromCell(cellText);
      if (jsonData.id && jsonData.field) {
        return {
          data: '', // Will be filled by answers
          metadata: { type: 'simple', id: jsonData.id, field: jsonData.field }
        };
      }
    }
    
    // Regular cell content
    return {
      data: cellText,
      metadata: { type: 'static' }
    };
  }

  private containsForeachPattern(text: string): boolean {
    return text.includes('[foreach]') && text.includes('[endforeach]');
  }

  private containsJsonPattern(text: string): boolean {
    return /\{[^}]*id[^}]*:[^}]*field[^}]*:[^}]*\}/i.test(text);
  }

  private parseForeachCell(cellText: string): { data: any, metadata: any } {
    // Extract content between [foreach] and [endforeach]
    const foreachMatch = cellText.match(/\[foreach\](.*?)\[endforeach\]/s);
    if (!foreachMatch) {
      // Remove any remaining [foreach] or [endforeach] tags
      const cleanedText = cellText.replace(/\[foreach\]|\[endforeach\]/g, '').trim();
      return { data: cleanedText, metadata: { type: 'static' } };
    }

    const foreachContent = foreachMatch[1].trim();
    
    // Parse the nested table structure
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = foreachContent;
    
    const nestedTable = tempDiv.querySelector('table');
    if (nestedTable) {
      const nestedResult = this.parseTableElement(nestedTable);
      return {
        data: {
          type: 'nested',
          headers: nestedResult.headers,
          rows: nestedResult.rows
        },
        metadata: {
          type: 'foreach',
          nestedMetadata: nestedResult.metadata
        }
      };
    }
    
    // If no table found, return cleaned content without tags
    return { data: foreachContent, metadata: { type: 'static' } };
  }

  private extractJsonFromCell(cellText: string): { id: string, field: string } {
    let cellId = '';
    let cellField = '';
    
    try {
      // Look for JSON-like pattern in cell content
      const jsonMatch = cellText.match(/\{[^}]*id[^}]*:[^}]*,?[^}]*field[^}]*:[^}]*\}/i);
      if (jsonMatch) {
        // Try to parse as JSON
        const jsonStr = jsonMatch[0].replace(/(\w+):/g, '"$1":'); // Add quotes around keys
        const parsed = JSON.parse(jsonStr);
        
        cellId = String(parsed.id || '');
        cellField = String(parsed.field || '');
      }
    } catch (error) {
      // If JSON parsing fails, try regex extraction
      const idMatch = cellText.match(/id\s*:\s*([^,}\s]+)/i);
      const fieldMatch = cellText.match(/field\s*:\s*([^,}\s]+)/i);
      
      if (idMatch) cellId = idMatch[1].trim();
      if (fieldMatch) cellField = fieldMatch[1].trim();
    }
    
    return { id: cellId, field: cellField };
  }

  // Sample selection event handlers
  onSampleSelected(sample: any): void {
    this.selectedSample = sample;
    
    // If we have a selected view, refresh answers with new sample
    if (this.selectedView && this.cellMetadata.length > 0) {
      this.fetchAnswersForTable();
    }
  }

  onSampleCleared(): void {
    this.selectedSample = null;
    this.answerData = {};
    this.categoryData = {};
    this.isLoadingAnswers = false;
  }

  isNestedTable(cell: any): boolean {
    return cell && typeof cell === 'object' && cell.type === 'nested';
  }

  getViewTitle(view: any): string {
    if (!view.content) {
      return 'Untitled';
    }
    
    // Extract H1 title from content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = view.content;
    const h1Element = tempDiv.querySelector('h1');
    
    if (h1Element) {
      return h1Element.textContent?.trim() || 'Untitled';
    }
    
    return 'Untitled';
  }


  fetchAnswersForTable(): void {
    if (!this.selectedSample || this.cellMetadata.length === 0) {
      return;
    }

    // Collect unique category IDs from all cells (including nested)
    const categoryIds: number[] = [];
    this.collectCategoryIds(this.cellMetadata, categoryIds);

    if (categoryIds.length === 0) {
      console.warn('No valid category IDs found in table cells');
      return;
    }

    // Store category IDs for potential reuse
    this.currentCategoryIds = categoryIds;

    this.fetchAnswersWithCurrentIds();
  }

  private collectCategoryIds(metadata: any[], categoryIds: number[]): void {
    metadata.forEach(section => {
      if (section.type === 'section-group' && section.metadata) {
        section.metadata.forEach((tableMetadata: any) => {
          if (tableMetadata.type === 'table' && tableMetadata.metadata) {
            tableMetadata.metadata.forEach((item: any) => {
              if (item.type === 'data' && item.cells) {
                item.cells.forEach((cell: any) => {
                  if (cell.type === 'simple' && cell.id && !isNaN(Number(cell.id))) {
                    const id = Number(cell.id);
                    if (!categoryIds.includes(id)) {
                      categoryIds.push(id);
                    }
                  } else if (cell.type === 'foreach' && cell.nestedMetadata) {
                    this.collectNestedCategoryIds(cell.nestedMetadata, categoryIds);
                  }
                });
              }
            });
          }
        });
      }
    });
  }

  private collectNestedCategoryIds(nestedMetadata: any[], categoryIds: number[]): void {
    nestedMetadata.forEach(item => {
      if (item.type === 'data' && item.cells) {
        item.cells.forEach((cell: any) => {
          if (cell.type === 'simple' && cell.id && !isNaN(Number(cell.id))) {
            const id = Number(cell.id);
            if (!categoryIds.includes(id)) {
              categoryIds.push(id);
            }
          }
        });
      }
    });
  }

  fetchAnswersWithCurrentIds(): void {
    if (!this.selectedSample || this.currentCategoryIds.length === 0) {
      return;
    }

    this.isLoadingAnswers = true;
    this.answerData = {};
    this.categoryData = {};

    // Use RxJS forkJoin to combine all async operations
    const categoryRequests = this.currentCategoryIds.map(id => 
      this.dataService.getCategoryById(id).pipe(
        tap(category => {
          if (category && !category.has_children) {
            // Categories without children are leaf nodes (research questions)
            this.categoryData[id] = category;
            console.log(`Fetched category ${id}:`, category.name);
          }
        }),
        catchError(err => {
          console.error(`Error fetching category ${id}:`, err);
          return of(null);
        })
      )
    );

    const answerRequest = this.dataService.getAnswers(this.currentCategoryIds, [this.selectedSample.sample_ref]).pipe(
      tap(answers => this.processAnswers(answers)),
      catchError(err => {
        console.error('Error fetching answers:', err);
        return of([]);
      })
    );

    // Combine all requests and wait for completion
    forkJoin([...categoryRequests, answerRequest]).subscribe({
      next: () => {
        console.log('All data fetched, updating table with categoryData:', this.categoryData);
        console.log('About to call updateTableWithAnswers()');
        this.updateTableWithAnswers();
        console.log('updateTableWithAnswers() completed');
        this.isLoadingAnswers = false;
      },
      error: (err) => {
        console.error('Error in forkJoin:', err);
        this.isLoadingAnswers = false;
      }
    });
  }


  processAnswers(answers: any[]): void {
    // Clear previous answer data
    this.answerData = {};

    // Group answers by question_id/category
    const groupedAnswers: { [key: string]: any[] } = {};
    answers.forEach(answer => {
      const key = `${answer.question_id || answer.category}`;
      if (!groupedAnswers[key]) {
        groupedAnswers[key] = [];
      }
      groupedAnswers[key].push(answer);
    });

    // Process grouped answers - concatenate multiple values with commas
    Object.keys(groupedAnswers).forEach(key => {
      const answersForKey = groupedAnswers[key];
      
      if (answersForKey.length === 1) {
        // Single answer - use as is
        this.answerData[key] = answersForKey[0];
      } else {
        // Multiple answers - create combined answer object
        const combinedAnswer = { ...answersForKey[0] }; // Start with first answer as base
        
        // For each field in the answer, concatenate values from all answers
        Object.keys(combinedAnswer).forEach(field => {
          if (field !== 'question_id' && field !== 'category' && field !== 'sample') {
            const values = answersForKey
              .map(answer => answer[field])
              .filter(value => value !== null && value !== undefined && value !== '' && value !== 'null')
              .map(value => String(value).trim())
              .filter(value => value.length > 0);
            
            // Remove duplicates and join with commas
            const uniqueValues = [...new Set(values)];
            combinedAnswer[field] = uniqueValues.join(', ');
          }
        });
        
        this.answerData[key] = combinedAnswer;
      }
    });

    // Table will be updated when both categories and answers are fetched
  }

  updateTableWithAnswers(): void {
    if (!this.tableData || this.cellMetadata.length === 0) {
      return;
    }

    // Update each section with answer data
    const updatedSections = this.tableData.sections.map((section, sectionIndex) => {
      const sectionMetadata = this.cellMetadata[sectionIndex];
      
      if (sectionMetadata.type === 'section-group') {
        const updatedTables = section.tables.map((table: any, tableIndex: number) => {
          const tableMetadata = sectionMetadata.metadata[tableIndex];
          
          if (tableMetadata.type === 'table') {
            const updatedRows = table.rows.map((row: any, rowIndex: number) => {
              const rowMetadata = tableMetadata.metadata[rowIndex];
              
              if (rowMetadata.type === 'data') {
                const updatedCells = row.cells.map((cell: any, cellIndex: number) => {
                  return this.updateCellWithAnswers(cell, rowMetadata.cells[cellIndex]);
                });
                return { ...row, cells: updatedCells };
              }
              return row;
            });
            
            return { ...table, rows: updatedRows };
          }
          
          return table;
        });
        
        return { ...section, tables: updatedTables };
      }
      
      return section;
    });

    this.tableData = { ...this.tableData, sections: updatedSections };
  }

  private updateCellWithAnswers(cell: any, cellMetadata: any): any {
    if (cellMetadata.type === 'simple' && cellMetadata.id && cellMetadata.field) {
      // If field is "question", get data from categoryData
      if (cellMetadata.field === 'question') {
        console.log(`Cell with question identified for ID ${cellMetadata.id}, field: ${cellMetadata.field}`);
        console.log('Available categoryData:', this.categoryData);
        const category = this.categoryData[cellMetadata.id];
        console.log(`Category for ID ${cellMetadata.id}:`, category);
        if (category && category.name !== undefined && !category.has_children) {
          const value = category.name;
          
          // Hide null values (both JSON null and string "null")
          if (value === null || value === 'null') {
            return '';
          }
          
          return String(value);
        } else {
          return '-'; // Default value when no category found
        }
      } else {
        // For other fields, get data from answerData
        const answer = this.answerData[cellMetadata.id];
        if (answer && answer[cellMetadata.field] !== undefined) {
          const value = answer[cellMetadata.field];
          
          // Hide null values (both JSON null and string "null")
          if (value === null || value === 'null') {
            return '';
          }
          
          return String(value);
        } else {
          return '-'; // Default value when no answer found
        }
      }
    } else if (cellMetadata.type === 'foreach' && cell.type === 'nested') {
      // Update nested table cells
      const updatedNestedRows = cell.rows.map((nestedRow: any, nestedRowIndex: number) => {
        const nestedMetadata = cellMetadata.nestedMetadata[nestedRowIndex];
        const updatedNestedCells = nestedRow.cells.map((nestedCell: any, nestedCellIndex: number) => {
          return this.updateCellWithAnswers(nestedCell, nestedMetadata.cells[nestedCellIndex]);
        });
        return { ...nestedRow, cells: updatedNestedCells };
      });
      
      return {
        ...cell,
        rows: updatedNestedRows
      };
    }
    
    // Return original cell content for static cells
    return cell;
  }

}

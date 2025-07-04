import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../api/data.service';
import { SearchStateService } from '../api/search-state.service';
import { SampleSelectionComponent } from '../shared/sample-selection/sample-selection.component';
import { inject } from '@angular/core';

@Component({
  selector: 'app-tables',
  imports: [CommonModule, FormsModule, SampleSelectionComponent],
  templateUrl: './tables.component.html',
  styleUrl: './tables.component.scss'
})
export class TablesComponent implements OnInit {
  views: any[] = [];
  selectedView: any = null;
  tableData: { sections: any[] } | null = null;
  
  selectedSample: any = null;

  // Answer data properties
  cellMetadata: any[] = [];
  answerData: { [key: string]: any } = {};
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
        error: (err) => {
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

      // Process all elements in sequence, grouping h2 + table combinations
      const allElements = tempDiv.children;
      const sections: any[] = [];
      const allMetadata: any[] = [];
      
      let currentHeading = '';
      
      for (let i = 0; i < allElements.length; i++) {
        const element = allElements[i];
        
        if (element.tagName.toLowerCase() === 'h2') {
          currentHeading = element.textContent?.trim() || '';
          
        } else if (element.tagName.toLowerCase() === 'table') {
          const tableResult = this.parseTableElement(element);
          
          sections.push({
            type: 'table-section',
            heading: currentHeading,
            headers: tableResult.headers,
            rows: tableResult.rows
          });
          
          allMetadata.push({
            type: 'table-section',
            metadata: tableResult.metadata
          });
          
          currentHeading = ''; // Reset after using
        }
      }

      this.tableData = { sections };
      this.cellMetadata = allMetadata;
      
      console.log('Parsed sections:', this.tableData);
      console.log('Parsed metadata:', this.cellMetadata);
    } catch (error) {
      console.error('Error parsing table content:', error);
      this.tableData = null;
      this.cellMetadata = [];
    }
  }

  private parseTableElement(table: Element): { headers: string[], rows: any[], metadata: any[] } {
    const allRows = table.querySelectorAll('tbody tr') || table.querySelectorAll('tr');
    const headers: string[] = [];
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

    // Extract headers if they exist
    if (hasHeaders && allRows.length > 0) {
      const headerRow = table.querySelector('thead tr') || allRows[0];
      if (headerRow) {
        const headerCells = headerRow.querySelectorAll('th, td');
        headerCells.forEach(cell => {
          headers.push(cell.textContent?.trim() || '');
        });
      }
    }

    // Process data rows
    for (let i = startIndex; i < allRows.length; i++) {
      const row = allRows[i];
      const cells = row.querySelectorAll('td, th');
      const rowData: any[] = [];
      const rowMetadata: any[] = [];
      
      cells.forEach(cell => {
        const cellText = cell.textContent?.trim() || '';
        const cellResult = this.parseCellContent(cellText);
        
        rowData.push(cellResult.data);
        rowMetadata.push(cellResult.metadata);
      });
      
      if (rowData.length > 0) {
        rows.push({ type: 'data', cells: rowData });
        metadata.push({ type: 'data', cells: rowMetadata });
      }
    }

    return { headers, rows, metadata };
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
    this.isLoadingAnswers = false;
  }

  isNestedTable(cell: any): boolean {
    return cell && typeof cell === 'object' && cell.type === 'nested';
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
      if (section.type === 'table-section' && section.metadata) {
        section.metadata.forEach((item: any) => {
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

    // Fetch answers using the stored category IDs and current sample
    this.dataService.getAnswers(this.currentCategoryIds, [this.selectedSample.sample_ref]).subscribe({
      next: (answers) => {
        this.processAnswers(answers);
        this.isLoadingAnswers = false;
      },
      error: (err) => {
        console.error('Error fetching answers:', err);
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

    // Update table data with answer values
    this.updateTableWithAnswers();
  }

  updateTableWithAnswers(): void {
    if (!this.tableData || this.cellMetadata.length === 0) {
      return;
    }

    // Update each section with answer data
    const updatedSections = this.tableData.sections.map((section, sectionIndex) => {
      const sectionMetadata = this.cellMetadata[sectionIndex];
      
      if (sectionMetadata.type === 'table-section') {
        const updatedRows = section.rows.map((row: any, rowIndex: number) => {
          const rowMetadata = sectionMetadata.metadata[rowIndex];
          
          if (rowMetadata.type === 'data') {
            const updatedCells = row.cells.map((cell: any, cellIndex: number) => {
              return this.updateCellWithAnswers(cell, rowMetadata.cells[cellIndex]);
            });
            return { ...row, cells: updatedCells };
          }
          return row;
        });
        
        return { ...section, rows: updatedRows };
      }
      
      return section;
    });

    this.tableData = { sections: updatedSections };
  }

  private updateCellWithAnswers(cell: any, cellMetadata: any): any {
    if (cellMetadata.type === 'simple' && cellMetadata.id && cellMetadata.field) {
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

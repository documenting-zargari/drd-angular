import { environment } from '../../environments/environment';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService, SearchCriterion, SearchContext } from '../api/data.service';
import { SearchStateService } from '../api/search-state.service';
import { SampleSelectionComponent } from '../shared/sample-selection/sample-selection.component';
import { SearchValueDialogComponent } from '../shared/search-value-dialog.component';
import { PhraseTranscriptionModalComponent } from '../shared/phrase-transcription-modal/phrase-transcription-modal.component';
import { inject } from '@angular/core';
import { forkJoin, of, Subscription } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-tables',
  imports: [CommonModule, FormsModule, SampleSelectionComponent, SearchValueDialogComponent, PhraseTranscriptionModalComponent],
  templateUrl: './tables.component.html',
  styleUrl: './tables.component.scss'
})
export class TablesComponent implements OnInit, OnDestroy {
  categories: any[] = [];
  filteredCategories: any[] = [];
  expandedCategories: Set<number> = new Set();
  loadingCategories: Set<number> = new Set();
  selectedView: any = null;
  selectedCategory: any = null; // Store the category that was clicked to load this table
  tableData: { mainHeading?: string; sections: any[] } | null = null;

  selectedSample: any = null;
  searchTerm: string = '';
  private viewCategories: any[] = []; // All categories with a view (path)

  // Answer data properties
  cellMetadata: any[] = [];
  answerData: { [key: string]: any } = {};
  categoryData: { [key: string]: any } = {};
  isLoadingAnswers: boolean = false;
  currentCategoryIds: number[] = []; // Store category IDs for current table

  // Modal properties
  showModal: boolean = false;
  modalAnswer: any = null;
  modalTitle: string = '';
  
  // Table not found modal
  showTableNotFoundModal: boolean = false;

  // Search mode properties
  searchMode: boolean = false;
  searchContext: SearchContext = { 
    selectedQuestions: [],
    selectedSamples: [],
    searches: [], 
    searchResults: [],
    searchStatus: '',
    searchString: '',
    isLoading: false,
    searchType: 'none',
    lastSearchMethod: null,
    currentSample: null 
  };
  
  // Search value modal properties  
  showSearchModal: boolean = false;
  searchModalQuestionId: number = 0;
  searchModalQuestionName: string = '';
  searchModalFieldName: string = '';
  searchModalHierarchy: string[] = [];
  
  // Subscription management
  private subscriptions: Subscription[] = [];

  private searchStateService = inject(SearchStateService);

  constructor(private dataService: DataService, private router: Router) { }

  ngOnInit(): void {
    // Initialize search context and mode from current state
    const currentContext = this.searchStateService.getSearchContext();
    this.searchContext = currentContext;
    this.selectedSample = currentContext.currentSample;
    
    // If we have search criteria, automatically enter search mode and restore table view
    if (currentContext.searches.length > 0) {
      this.searchMode = true;
      
      // Restore the view context that was active when the search was executed
      if (currentContext.selectedView) {
        this.selectedView = currentContext.selectedView;
        this.selectedCategory = currentContext.selectedCategory;
        
        // Reload the table data for this view
        this.parseTableContent(this.selectedView.content);
        if (this.cellMetadata.length > 0) {
          this.fetchAnswersForTable();
        }
      }
    }
    
    // Subscribe to unified search context for future changes
    this.subscriptions.push(
      this.searchStateService.searchContext$.subscribe(context => {
        this.searchContext = context;
        this.selectedSample = context.currentSample;
        
        // Update search mode based on criteria presence
        if (context.searches.length > 0 && !this.searchMode) {
          this.searchMode = true;
        } else if (context.searches.length === 0 && this.searchMode) {
          this.searchMode = false;
        }
      })
    );
    
    // Load categories - get top-level categories first
    this.dataService.getCategories().subscribe({
      next: (categories) => {
        this.categories = this.initializeCategoriesHierarchy(categories);
        this.filteredCategories = this.categories;
      },
      error: (err: any) => {
        console.error('Error fetching categories:', err);
      }
    });

    // Load all categories that have views (for search)
    this.dataService.getViewCategories().subscribe({
      next: (categories) => {
        this.viewCategories = categories;
      },
      error: (err: any) => {
        console.error('Error fetching view categories:', err);
      }
    });

    // Load current sample from global state (legacy compatibility)
    this.selectedSample = this.searchStateService.getCurrentSample();

    // Reset to list view when "Tables" menu item is clicked
    this.subscriptions.push(
      this.dataService.tablesReset$.subscribe(() => {
        this.backToHierarchy();
      })
    );
  }
  
  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  // Category hierarchy navigation methods
  expandCategory(category: any): void {
    if (this.expandedCategories.has(category.id)) {
      this.expandedCategories.delete(category.id);
      this.collapseCategory(category);
    } else {
      this.expandedCategories.add(category.id);
      if (!category.children || category.children.length === 0) {
        this.loadChildCategories(category);
      }
    }
  }

  private collapseCategory(category: any): void {
    if (category.children) {
      category.children.forEach((child: any) => {
        if (this.expandedCategories.has(child.id)) {
          this.expandedCategories.delete(child.id);
          this.collapseCategory(child);
        }
      });
    }
  }

  private loadChildCategories(category: any): void {
    if (this.loadingCategories.has(category.id)) {
      return;
    }
    
    this.loadingCategories.add(category.id);
    
    if (category.has_children) {
      this.dataService.getChildCategories(category.id).subscribe({
        next: (children) => {
          category.children = this.initializeCategoriesHierarchy(children);
          this.loadingCategories.delete(category.id);
        },
        error: (error) => {
          console.error('Error loading child categories:', error);
          this.loadingCategories.delete(category.id);
        }
      });
    } else {
      this.loadingCategories.delete(category.id);
    }
  }

  private initializeCategoriesHierarchy(categories: any[]): any[] {
    return categories.map(category => ({
      ...category,
      children: [],
      level: category.level || 0
    }));
  }

  isCategoryExpanded(category: any): boolean {
    return this.expandedCategories.has(category.id);
  }

  isCategoryLoading(category: any): boolean {
    return this.loadingCategories.has(category.id);
  }

  isEndLeaf(category: any): boolean {
    // End leaf is determined by existence of 'path' field
    return category.path && category.path.trim() !== '';
  }

  getFlattenedCategories(categories: any[] = this.filteredCategories, level: number = 0): any[] {
    const result: any[] = [];

    for (const category of categories) {
      category.level = level;
      result.push(category);

      if (this.isCategoryExpanded(category) && category.children && category.children.length > 0) {
        result.push(...this.getFlattenedCategories(category.children, level + 1));
      }
    }

    return result;
  }

  selectCategory(category: any): void {
    if (this.isEndLeaf(category)) {
      // Store the selected category for breadcrumb display
      this.selectedCategory = category;
      // This is an end leaf with a path - load the corresponding view/table
      this.loadTableFromPath(category.path);
    }
  }

  private loadTableFromPath(path: string): void {
    // Find the view with matching path/filename from the Views endpoint
    this.dataService.getViews().subscribe({
      next: (views) => {
        // Convert category path format to view filename format
        // "browse/adjectivederivation/prefixes.php" -> "browse-adjectivederivation-prefixes.php"
        const expectedFilename = path.replace(/\//g, '-');
        
        // Find matching view
        const matchingView = views.find((view: any) => view.filename === expectedFilename);
        
        if (matchingView) {
          this.selectedView = matchingView;
          this.parseTableContent(matchingView.content);
          // Always try to fetch answers if we have metadata, regardless of sample selection
          // If no sample is selected, the table will show structure with empty data cells
          if (this.cellMetadata.length > 0) {
            this.fetchAnswersForTable();
          }
        } else {
          // Show modal instead of console error and alert
          this.showTableNotFoundModal = true;
          console.error('No matching view found for path:', path);
          console.error('Expected filename:', expectedFilename);
        }
      },
      error: (err: any) => {
        console.error('Error fetching views:', err);
      }
    });
  }

  backToHierarchy(): void {
    this.selectedView = null;
    this.selectedCategory = null;
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
      // Preprocess HTML to mark tables with foreach-row patterns
      // This must be done BEFORE DOM parsing because the browser's HTML parser
      // will "foster parent" text nodes (like [foreach]) out of <table> elements
      const preprocessedHtml = this.markForeachRowTables(htmlContent);

      // Create a temporary DOM element to parse the HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = preprocessedHtml;

      // Process all elements in sequence, grouping tables by their sections
      const allElements = tempDiv.children;
      const sections: any[] = [];
      const allMetadata: any[] = [];
      
      let mainHeading = '';
      let currentSectionHeading = '';
      let currentSubsectionHeading = '';
      let currentSectionTables: any[] = [];
      let currentSectionMetadata: any[] = [];
      
      const flushCurrentSection = () => {
        if (currentSectionTables.length > 0) {
          // Build full heading including subsection if present
          let fullHeading = currentSectionHeading;
          if (currentSubsectionHeading) {
            fullHeading = currentSubsectionHeading; // Use H3 as the section heading if present
          }
          
          sections.push({
            type: 'section-group',
            heading: fullHeading,
            h2Heading: currentSectionHeading,
            h3Heading: currentSubsectionHeading,
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
          currentSubsectionHeading = ''; // Reset H3 when we encounter H2
          
        } else if (element.tagName.toLowerCase() === 'h3') {
          // Flush previous subsection before starting new one
          flushCurrentSection();
          currentSubsectionHeading = element.textContent?.trim() || '';
          
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
    } catch (error) {
      console.error('Error parsing table content:', error);
      this.tableData = null;
      this.cellMetadata = [];
    }
  }

  /**
   * Preprocess HTML to mark tables that have [foreach]<tr>...</tr>[endforeach] patterns.
   * This must be done before DOM parsing because the browser's HTML parser
   * will move text nodes like [foreach] outside of <table> elements (foster parenting).
   */
  private markForeachRowTables(html: string): string {
    // Check if the HTML contains the foreach-row pattern anywhere
    const hasForeachRowPattern = /\[foreach\]\s*<tr/i.test(html) && /<\/tr>\s*\[endforeach\]/i.test(html);

    if (!hasForeachRowPattern) {
      return html; // No foreach-row patterns, return unchanged
    }

    // Mark only tables that actually contain the [foreach] pattern
    // We need to check each table individually, not mark all tables globally
    return html.replace(/<table([^>]*)>([\s\S]*?)<\/table>/gi, (match, attrs, content) => {
      // Check if THIS specific table has the foreach-row pattern
      const tableHasForeach = /\[foreach\]\s*<tr/i.test(content) && /<\/tr>\s*\[endforeach\]/i.test(content);
      if (tableHasForeach) {
        return `<table${attrs} data-foreach-row="true">${content}</table>`;
      }
      return match; // Return unchanged if no foreach pattern in this table
    });
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

    // Check if table was marked with foreach-row pattern during preprocessing
    const hasForeachRowPattern = table.hasAttribute('data-foreach-row');

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

    // Track active rowspans from previous rows
    // Key: column index, Value: { rowsRemaining: number, data: any, metadata: any, span: any }
    const activeRowspans: Map<number, { rowsRemaining: number, data: any, metadata: any, span: any }> = new Map();

    // Process data rows
    for (let i = startIndex; i < allRows.length; i++) {
      const row = allRows[i];
      const cells = row.querySelectorAll('td, th');
      const rowData: any[] = [];
      const rowMetadata: any[] = [];
      const rowSpans: any[] = [];
      let rowQuestionId: string | null = null;

      let cellIndex = 0;
      let colIndex = 0;

      // Process cells, accounting for rowspan coverage
      while (cellIndex < cells.length || activeRowspans.has(colIndex)) {
        // Check if this column is covered by a rowspan from a previous row
        if (activeRowspans.has(colIndex)) {
          const spanInfo = activeRowspans.get(colIndex)!;
          // Add a placeholder for the spanned cell
          rowData.push(spanInfo.data);
          rowMetadata.push(spanInfo.metadata);
          rowSpans.push({ ...spanInfo.span, skip: true }); // Mark as skip for rendering

          spanInfo.rowsRemaining--;
          if (spanInfo.rowsRemaining <= 0) {
            activeRowspans.delete(colIndex);
          }
          colIndex++;
          continue;
        }

        if (cellIndex >= cells.length) break;

        const cell = cells[cellIndex];
        const cellContent = cell.innerHTML?.trim() || '';
        const needsHtml = cellContent.includes('[foreach]');
        const cellText = needsHtml ? cellContent : (cell.textContent?.trim() || '');
        const cellResult = this.parseCellContent(cellText);
        const colspan = parseInt(cell.getAttribute('colspan') || '1');
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
        const isHeader = cell.tagName.toLowerCase() === 'th';
        // data-rowspan can be 'true', 'start', or 'continue'
        const dataRowspan = cell.getAttribute('data-rowspan');

        rowData.push(cellResult.data);
        rowMetadata.push(cellResult.metadata);
        rowSpans.push({ colspan, rowspan, isHeader, dataRowspan });

        // If rowspan > 1, track it for subsequent rows
        if (rowspan > 1) {
          activeRowspans.set(colIndex, {
            rowsRemaining: rowspan - 1,
            data: cellResult.data,
            metadata: cellResult.metadata,
            span: { colspan, rowspan, isHeader, dataRowspan }
          });
        }

        // Extract question ID from cell metadata for foreach-row
        if (!rowQuestionId && cellResult.metadata.id) {
          rowQuestionId = cellResult.metadata.id;
        }

        cellIndex++;
        colIndex++;
      }

      if (rowData.length > 0) {
        // If table has foreach-row pattern, mark data rows as foreach-row templates
        if (hasForeachRowPattern && rowQuestionId) {
          rows.push({ type: 'foreach-row', cells: rowData, spans: rowSpans });
          metadata.push({
            type: 'foreach-row',
            questionId: rowQuestionId,
            cells: rowMetadata
          });
        } else {
          rows.push({ type: 'data', cells: rowData, spans: rowSpans });
          metadata.push({ type: 'data', cells: rowMetadata });
        }
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
        const metadata: any = { type: 'simple', id: jsonData.id, field: jsonData.field };
        if (jsonData.tableField) {
          metadata.tableField = jsonData.tableField;
        }
        if (jsonData.rowspan) {
          metadata.rowspan = true;
        }
        return {
          data: '', // Will be filled by answers
          metadata
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

    // Handle divs with metadata for vertical answer display
    const divs = tempDiv.querySelectorAll('div');
    if (divs.length > 0) {
      const firstDiv = divs[0];
      const divText = firstDiv.textContent?.trim() || '';

      if (this.containsJsonPattern(divText)) {
        const jsonData = this.extractJsonFromCell(divText);
        if (jsonData.id && jsonData.field) {
          // Store the div as an HTML template for later substitution
          const metadata: any = {
            type: 'foreach-div',
            id: jsonData.id,
            field: jsonData.field,
            template: '<div></div>'  // Simple div template for wrapping values
          };
          if (jsonData.tableField) {
            metadata.tableField = jsonData.tableField;
          }
          return {
            data: '',  // Will be replaced with HTML content
            metadata
          };
        }
      }
    }

    // If no table found, return cleaned content without tags
    return { data: foreachContent, metadata: { type: 'static' } };
  }

  private extractJsonFromCell(cellText: string): { id: string, field: string, tableField?: string, rowspan?: boolean } {
    let cellId = '';
    let cellField = '';
    let cellTableField = '';
    let cellRowspan = false;

    try {
      // Look for JSON-like pattern in cell content
      const jsonMatch = cellText.match(/\{[^}]*id[^}]*:[^}]*,?[^}]*field[^}]*:[^}]*\}/i);
      if (jsonMatch) {
        // Try to parse as JSON
        const jsonStr = jsonMatch[0].replace(/(\w+):/g, '"$1":'); // Add quotes around keys
        const parsed = JSON.parse(jsonStr);

        cellId = String(parsed.id || '');
        cellField = String(parsed.field || '');
        cellTableField = String(parsed.tableField || '');
        cellRowspan = parsed.rowspan === true;
      }
    } catch (error) {
      // If JSON parsing fails, try regex extraction
      const idMatch = cellText.match(/id\s*:\s*([^,}\s]+)/i);
      const fieldMatch = cellText.match(/field\s*:\s*([^,}\s]+)/i);
      const tableFieldMatch = cellText.match(/tableField\s*:\s*([^,}\s]+)/i);
      const rowspanMatch = cellText.match(/rowspan\s*:\s*(true)/i);

      if (idMatch) cellId = idMatch[1].trim();
      if (fieldMatch) cellField = fieldMatch[1].trim();
      if (tableFieldMatch) cellTableField = tableFieldMatch[1].trim();
      if (rowspanMatch) cellRowspan = true;
    }

    const result: { id: string, field: string, tableField?: string, rowspan?: boolean } = { id: cellId, field: cellField };
    if (cellTableField) {
      result.tableField = cellTableField;
    }
    if (cellRowspan) {
      result.rowspan = true;
    }
    return result;
  }

  // Sample selection event handlers
  onSampleSelected(sample: any): void {
    this.selectedSample = sample;

    // If we have a selected view, re-parse template and refresh answers
    if (this.selectedView) {
      // Re-parse the original HTML template to get fresh table structure
      // This ensures foreach-row templates are not pre-expanded from previous sample
      this.parseTableContent(this.selectedView.content);

      if (this.cellMetadata.length > 0) {
        this.fetchAnswersForTable();
      }
    }
  }

  onSampleCleared(): void {
    this.selectedSample = null;
    
    // If we have a selected view, refresh the table to show empty data cells
    if (this.selectedView && this.cellMetadata.length > 0) {
      this.fetchAnswersForTable(); // This will now show empty table structure
    } else {
      this.answerData = {};
      this.categoryData = {};
      this.isLoadingAnswers = false;
    }
  }

  isNestedTable(cell: any): boolean {
    return cell && typeof cell === 'object' && cell.type === 'nested';
  }

  isHtmlContent(cell: any): boolean {
    return typeof cell === 'object' && cell !== null && cell.type === 'html' && cell.content;
  }

  containsHtmlTags(cell: any): boolean {
    return typeof cell === 'string' && /<[^>]+>/.test(cell);
  }

  isCellClickable(table: any, row: any, cellIndex: number): boolean {
    // For foreach-row expanded rows, check if we have answer data with tags
    if (row._questionId !== undefined) {
      if (this.searchMode) {
        return true;
      }
      const answer = this.answerData[row._questionId];
      if (answer) {
        // Get the specific answer for this row
        let specificAnswer = answer;
        if (answer._isCombined && answer._answers && row._answerIndex !== undefined) {
          specificAnswer = answer._answers[row._answerIndex];
        }
        // Clickable if answer has tags
        if (specificAnswer && (specificAnswer.tags || specificAnswer.tag)) {
          return true;
        }
      }
      return false;
    }

    // Find the corresponding metadata for this cell
    const metadata = this.getCellMetadata(table, row, cellIndex);

    if (!metadata || !metadata.id || !metadata.field) {
      return false;
    }

    // Only simple and foreach-div cells are clickable
    if (metadata.type !== 'simple' && metadata.type !== 'foreach-div') {
      return false;
    }

    if (this.searchMode) {
      // In search mode, allow clicking on any cell with metadata except question fields
      return metadata.field !== 'question';
    } else {
      // In normal mode, only allow clicking if we have answer data with tags
      if (metadata.field === 'question') {
        return false;
      }
      // Check if there's answer data with tags for this cell
      const answer = this.answerData[metadata.id];
      if (!answer) {
        return false;
      }
      // Check for tags (handles both single and combined answers)
      if (answer._isCombined && answer._answers) {
        return answer._answers.some((a: any) => a.tags || a.tag);
      }
      return !!(answer.tags || answer.tag);
    }
  }

  onCellClick(table: any, row: any, cellIndex: number): void {
    if (!this.isCellClickable(table, row, cellIndex)) {
      return;
    }

    // Check if we're in search mode
    if (this.searchMode) {
      this.onSearchCellClick(table, row, cellIndex);
      return;
    }

    // For foreach-row expanded rows, use row._questionId directly
    if (row._questionId !== undefined) {
      let answer = this.answerData[row._questionId];
      if (answer && answer._isCombined && answer._answers && row._answerIndex !== undefined) {
        answer = answer._answers[row._answerIndex];
      }
      if (answer && (answer.tags || answer.tag) && answer._key) {
        const normalizedAnswer = {
          ...answer,
          tags: answer.tags || (answer.tag ? [answer.tag] : [])
        };
        this.openPhrasesModal(normalizedAnswer);
      }
      return;
    }

    // Normal mode - open phrases modal
    const metadata = this.getCellMetadata(table, row, cellIndex);
    if (metadata && metadata.id) {
      let answer = this.answerData[metadata.id];

      // If this is a combined answer, get the correct answer based on row context
      if (answer && answer._isCombined && answer._answers) {
        // For foreach-row expanded rows, use the _answerIndex to get the correct answer
        if (row._answerIndex !== undefined && row._answerIndex < answer._answers.length) {
          answer = answer._answers[row._answerIndex];
        } else {
          // Fallback to first answer
          answer = answer._answers[0];
        }
      }

      // Check for either tags (plural) or tag (singular)
      if (answer && (answer.tags || answer.tag) && answer._key) {
        // Normalize to tags array for modal
        const normalizedAnswer = {
          ...answer,
          tags: answer.tags || (answer.tag ? [answer.tag] : [])
        };
        this.openPhrasesModal(normalizedAnswer);
      }
    }
  }

  // Helper method to select the most appropriate answer based on the clicked field
  private selectAnswerByField(answers: any[], fieldName: string): any | null {
    if (!answers || answers.length === 0 || !fieldName) {
      return null;
    }

    // Find answers where the specific field is non-empty
    const matchingAnswers = answers.filter(answer => {
      const value = answer[fieldName];
      return value !== null && value !== undefined && value !== '' && value !== 'null';
    });

    // Return first matching answer, or null if none found
    return matchingAnswers.length > 0 ? matchingAnswers[0] : null;
  }

  openPhrasesModal(answer: any): void {
    // Generate detailed title with sample, question, and answer information
    const sampleRef = this.selectedSample?.sample_ref || 'Unknown Sample';
    
    // Get question hierarchy using the same logic as views component
    const questionHierarchy = this.getQuestionHierarchy(answer);
    
    // Get answer value using the same logic as views component
    const answerValue = this.getAnswerValue(answer);
    
    this.modalTitle = `Phrases for ${sampleRef} - ${questionHierarchy}`;
    this.modalAnswer = answer;
    this.showModal = true;
  }

  getQuestionHierarchy(answer: any): string {
    if (!answer) return 'Unknown Question';
    
    // Check if the answer itself contains hierarchy information
    if (answer.hierarchy && Array.isArray(answer.hierarchy) && answer.hierarchy.length > 0) {
      const hierarchyWithoutRMS = answer.hierarchy.filter((item: string) => item !== 'RMS');
      return hierarchyWithoutRMS.join(' > ');
    }
    
    // Try to find the category by question_id or category field
    const questionId = answer.question_id || answer.category;
    if (!questionId) return 'Unknown Question';
    
    // First check the shared category cache
    const cachedCategory = this.searchStateService.getCategoryCache(questionId);
    if (cachedCategory) {
      // Build full hierarchy without "RMS"
      if (cachedCategory.hierarchy && cachedCategory.hierarchy.length > 0) {
        const hierarchyWithoutRMS = cachedCategory.hierarchy.filter((item: string) => item !== 'RMS');
        return hierarchyWithoutRMS.join(' > ');
      }
      return cachedCategory.name || `Question ${questionId}`;
    }
    
    // Fallback to local categoryData (tables component specific)
    if (answer.category && this.categoryData[answer.category]) {
      const category = this.categoryData[answer.category];
      if (category.hierarchy && category.hierarchy.length > 0) {
        const hierarchyWithoutRMS = category.hierarchy.filter((item: string) => item !== 'RMS');
        return hierarchyWithoutRMS.join(' > ');
      }
      return category.name || `Question ${answer.category}`;
    }
    
    // Final fallback
    return `Question ${questionId}`;
  }

  getDisplayFields(result: any): {key: string, value: any}[] {
    if (!result) return [];
    
    return Object.keys(result)
      .filter(key => !this.shouldHideField(key))
      .map(key => ({key, value: result[key]}));
  }

  shouldHideField(fieldName: string): boolean {
    const hiddenFields = ['_id', 'question_id', 'sample', 'category', '_key', 'tag', 'tags'];
    return hiddenFields.includes(fieldName);
  }

  getAnswerValue(result: any): string {
    // Priority order: form, marker, then other fields
    if (result.form && result.form.toString().trim()) {
      return result.form.toString().trim();
    }
    if (result.marker && result.marker.toString().trim()) {
      return result.marker.toString().trim();
    }
    
    // Fallback to first non-hidden field value
    const fields = this.getDisplayFields(result);
    if (fields.length > 0) {
      return fields[0].value ? fields[0].value.toString() : '-';
    }
    
    return '-';
  }

  closeModal(): void {
    this.showModal = false;
    this.modalAnswer = null;
    this.modalTitle = '';
  }

  closeTableNotFoundModal(): void {
    this.showTableNotFoundModal = false;
  }

  private findSectionIndex(table: any): number {
    if (!this.tableData) return -1;
    for (let i = 0; i < this.tableData.sections.length; i++) {
      if (this.tableData.sections[i].tables.some((t: any) => t === table)) return i;
    }
    return -1;
  }

  private findTableIndex(table: any, sectionIndex: number): number {
    if (!this.tableData || sectionIndex === -1) return -1;
    return this.tableData.sections[sectionIndex].tables.indexOf(table);
  }

  private getCellMetadata(table: any, row: any, cellIndex: number): any {
    if (!this.tableData || !this.cellMetadata) {
      return null;
    }

    const sectionIndex = this.findSectionIndex(table);
    const tableIndex = this.findTableIndex(table, sectionIndex);

    if (sectionIndex === -1 || tableIndex === -1) {
      return null;
    }

    // Find the row index within the table
    const rowIndex = table.rows.indexOf(row);
    if (rowIndex === -1) {
      return null;
    }

    // Get the metadata for this cell
    const sectionMetadata = this.cellMetadata[sectionIndex];
    if (sectionMetadata && sectionMetadata.metadata && sectionMetadata.metadata[tableIndex] &&
        sectionMetadata.metadata[tableIndex].metadata) {

      const tableMetadata = sectionMetadata.metadata[tableIndex].metadata;
      let rowMetadata = tableMetadata[rowIndex];

      // Handle foreach-row expanded tables: if rowMetadata doesn't exist at this index,
      // check if the first row was a foreach-row template and use its cell metadata
      if (!rowMetadata && this.tableHasForeachRows({ metadata: tableMetadata })) {
        rowMetadata = tableMetadata[0];
      }

      if (rowMetadata && rowMetadata.cells) {
        return rowMetadata.cells[cellIndex];
      }
    }

    return null;
  }

  getCategoryTitle(category: any): string {
    return category.name || 'Untitled';
  }

  getCategoryHierarchy(category: any, options: { skipFirst?: boolean, excludeCurrent?: boolean } = {}): string[] {
    if (!category.hierarchy || category.hierarchy.length === 0) {
      return [];
    }

    let hierarchy = category.hierarchy;

    // Exclude current category name (last element) by default for breadcrumbs
    if (options.excludeCurrent !== false) {
      hierarchy = hierarchy.slice(0, -1);
    }

    // Remove leading "RMS" from hierarchy
    if (hierarchy.length > 0 && hierarchy[0] === 'RMS') {
      hierarchy = hierarchy.slice(1);
    }

    // Skip first element if requested
    if (options.skipFirst && hierarchy.length > 0) {
      return hierarchy.slice(1);
    }

    return hierarchy;
  }

  getSelectedViewTitle(): string {
    if (!this.selectedView || !this.selectedView.content) {
      return 'Untitled';
    }
    
    // Extract H1 title from content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = this.selectedView.content;
    const h1Element = tempDiv.querySelector('h1');
    
    if (h1Element) {
      return h1Element.textContent?.trim() || 'Untitled';
    }
    
    return 'Untitled';
  }

  getSelectedViewHierarchy(): string[] {
    if (!this.selectedCategory) {
      return [];
    }
    
    // Use the exact same logic as in the category list
    return this.getCategoryHierarchy(this.selectedCategory);
  }

  onSearchChange(): void {
    if (!this.searchTerm || this.searchTerm.trim() === '') {
      this.filteredCategories = this.categories;
      return;
    }
    const term = this.searchTerm.toLowerCase();
    this.filteredCategories = this.viewCategories.filter((c: any) => {
      if (c.name?.toLowerCase().includes(term)) return true;
      if (c.hierarchy && c.hierarchy.join(' ').toLowerCase().includes(term)) return true;
      return false;
    });
  }

  fetchAnswersForTable(): void {
    if (this.cellMetadata.length === 0) {
      return;
    }
    
    // Always load category data for headers (question fields)
    this.loadCategoryDataForHeaders();
    
    // If no sample is selected, just clear the answer data and return
    // This will show the table structure with populated headers but empty data cells
    if (!this.selectedSample) {
      this.answerData = {};
      this.isLoadingAnswers = false;
      this.updateTableWithAnswers(); // This will update the table with empty data but populated headers
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
              // Handle both 'data' and 'foreach-row' types
              if ((item.type === 'data' || item.type === 'foreach-row') && item.cells) {
                item.cells.forEach((cell: any) => {
                  if (cell.type === 'simple' && cell.id && !isNaN(Number(cell.id))) {
                    const id = Number(cell.id);
                    if (!categoryIds.includes(id)) {
                      categoryIds.push(id);
                    }
                  } else if (cell.type === 'foreach-div' && cell.id && !isNaN(Number(cell.id))) {
                    const id = Number(cell.id);
                    if (!categoryIds.includes(id)) {
                      categoryIds.push(id);
                    }
                  } else if (cell.type === 'foreach' && cell.nestedMetadata) {
                    this.collectNestedCategoryIds(cell.nestedMetadata, categoryIds);
                  }
                });
              }
              // Also collect from foreach-row's questionId directly
              if (item.type === 'foreach-row' && item.questionId && !isNaN(Number(item.questionId))) {
                const id = Number(item.questionId);
                if (!categoryIds.includes(id)) {
                  categoryIds.push(id);
                }
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

    const categoryRequests = this.currentCategoryIds.map(id => 
      this.dataService.getCategoryById(id).pipe(
        tap(category => {
          if (category && !category.has_children) {
            this.categoryData[id] = category;
            // Store in shared cache for other components
            this.searchStateService.setCategoryCache(id, category);
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

    forkJoin([...categoryRequests, answerRequest]).subscribe({
      next: () => {
        this.updateTableWithAnswers();
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

    // Store answers - keep as array for field-specific selection, or single object if only one
    Object.keys(groupedAnswers).forEach(key => {
      const answersForKey = groupedAnswers[key];

      if (answersForKey.length === 1) {
        // Single answer - use as is
        this.answerData[key] = answersForKey[0];
      } else {
        // Multiple answers - store the array AND create a combined display object
        // The array will be used for field-specific selection
        this.answerData[key] = {
          _answers: answersForKey, // Store original answers for filtering
          _isCombined: true,       // Flag to indicate this is combined
          question_id: answersForKey[0].question_id,
          category: answersForKey[0].category,
          sample: answersForKey[0].sample,
          // Create combined display values for each field
          ...this.createCombinedDisplayValues(answersForKey)
        };
      }
    });

  }

  // Helper method to create combined display values from multiple answers
  private createCombinedDisplayValues(answers: any[]): any {
    const combined: any = {};
    const firstAnswer = answers[0];

    Object.keys(firstAnswer).forEach(field => {
      if (field !== 'question_id' && field !== 'category' && field !== 'sample' && field !== '_key' && field !== 'tag' && field !== 'tags') {
        const values = answers
          .map(answer => answer[field])
          .filter(value => value !== null && value !== undefined && value !== '' && value !== 'null')
          .map(value => {
            // Handle object with source property (language may be null)
            if (typeof value === 'object' && !Array.isArray(value) && value.source !== undefined) {
              if (value.language && value.language !== 'null') {
                return `${value.source}: ${value.language}`;
              }
              return String(value.source);
            }
            // Handle array of objects with source property
            if (Array.isArray(value) && value.length > 0 && value[0].source !== undefined) {
              return value.map((obj: any) => {
                if (obj.language && obj.language !== 'null') {
                  return `${obj.source}: ${obj.language}`;
                }
                return String(obj.source);
              }).join(', ');
            }
            // Handle arrays of primitives
            if (Array.isArray(value)) {
              return value.join(', ');
            }
            // Handle other objects - avoid [object Object]
            if (typeof value === 'object') {
              return '';
            }
            return String(value).trim();
          })
          .filter(value => value.length > 0);

        // Remove duplicates and join with commas for display
        const uniqueValues = [...new Set(values)];
        combined[field] = uniqueValues.join(', ');
      }
    });

    return combined;
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
            // Use flatMap to allow foreach-row to expand into multiple rows
            const updatedRows = table.rows.flatMap((row: any, rowIndex: number) => {
              const rowMetadata = tableMetadata.metadata[rowIndex];

              // Skip rows beyond metadata length (these are previously expanded rows)
              if (!rowMetadata) {
                return [];
              }

              if (rowMetadata.type === 'foreach-row') {
                // Expand foreach-row template into multiple rows based on answers
                return this.expandForeachRow(row, rowMetadata);
              } else if (rowMetadata.type === 'data') {
                const updatedCells = row.cells.map((cell: any, cellIndex: number) => {
                  return this.updateCellWithAnswers(cell, rowMetadata.cells[cellIndex]);
                });
                return [{ ...row, cells: updatedCells }];
              }
              return [row];
            });

            // Merge start/continue spans across foreach blocks
            const finalRows = this.mergeStartContinueSpans(updatedRows);

            return { ...table, rows: finalRows };
          }

          return table;
        });

        return { ...section, tables: updatedTables };
      }

      return section;
    });

    this.tableData = { ...this.tableData, sections: updatedSections };
  }

  /**
   * Expand a foreach-row template into multiple rows based on available answers.
   * Each answer creates a complete row with all cells populated from that specific answer.
   *
   * Rowspan behavior:
   * - Column 0 (verb/question): Rowspan ALL rows for the same question
   * - Column 1 (root): Rowspan rows that share the same root value
   * - Header cells (th) and cells with rowspan:true: Rowspan all rows
   */
  private expandForeachRow(row: any, rowMetadata: any): any[] {
    const questionId = rowMetadata.questionId;
    if (!questionId) {
      return [row]; // No question ID, return as-is
    }

    // Get answers for this question
    const answerData = this.answerData[questionId];
    if (!answerData) {
      // No answers - return template row with _questionId so click handlers use it
      // instead of falling back to index-based metadata lookup (which gives wrong results after expansion)
      const templateRow = this.applySpanFlagsToTemplateRow(row);
      return [{ ...templateRow, _questionId: questionId }];
    }

    // Get individual answers (handle combined answers)
    const answers = answerData._isCombined && answerData._answers
      ? answerData._answers
      : [answerData];

    const answerCount = answers.length;
    if (answerCount === 0) {
      const templateRow = this.applySpanFlagsToTemplateRow(row);
      return [{ ...templateRow, _questionId: questionId }];
    }

    // Get the grouping field from column 1 metadata (typically 'root')
    const groupingField = rowMetadata.cells[1]?.field;

    // Resolve pipe-separated field spec (e.g. "source|language") to a combined string value
    const resolveGroupValue = (answer: any): string => {
      if (!groupingField) return '';
      const fields = groupingField.split('|').map((f: string) => f.trim().replace(/"/g, ''));
      const values = fields
        .map((f: string) => answer[f])
        .filter((v: any) => v !== null && v !== undefined && v !== '');
      return values.join(': ');
    };

    // Sort answers by the grouping field to cluster same values together
    const sortedAnswers = [...answers].sort((a, b) => {
      const valA = resolveGroupValue(a);
      const valB = resolveGroupValue(b);
      return valA.localeCompare(valB);
    });

    // Calculate group boundaries for column 1 (root grouping)
    const groupInfo: { startIndex: number, size: number }[] = [];
    let currentGroup = { startIndex: 0, size: 1, value: resolveGroupValue(sortedAnswers[0]) };

    for (let i = 1; i < sortedAnswers.length; i++) {
      const val = resolveGroupValue(sortedAnswers[i]);
      if (val === currentGroup.value) {
        currentGroup.size++;
      } else {
        groupInfo.push({ startIndex: currentGroup.startIndex, size: currentGroup.size });
        currentGroup = { startIndex: i, size: 1, value: val };
      }
    }
    groupInfo.push({ startIndex: currentGroup.startIndex, size: currentGroup.size });

    // Create rows with proper rowspans
    return sortedAnswers.map((answer: any, answerIndex: number) => {
      const updatedCells = row.cells.map((cell: any, cellIndex: number) => {
        const cellMetadata = rowMetadata.cells[cellIndex];
        return this.updateCellWithSingleAnswer(cell, cellMetadata, answer);
      });

      let updatedSpans = row.spans ? [...row.spans] : row.cells.map(() => ({}));

      updatedSpans = updatedSpans.map((span: any, cellIndex: number) => {
        const cellMeta = rowMetadata.cells[cellIndex];

        // Check for data-rowspan attribute (set on static th cells in template)
        // Values: 'true', 'start' (first occurrence), 'continue' (merge with above)
        // 'true' on column 1: group-based rowspan (groups by resolved field value)
        // 'start' or 'true' on other columns: span entire foreach block
        if (span?.dataRowspan) {
          if (span.dataRowspan === 'continue') {
            // Always skip - this cell merges with the span from above
            return { ...span, skip: true, continueSpan: true };
          } else if (span.dataRowspan === 'true' && cellIndex === 1 && groupInfo.length > 1) {
            // Group-based rowspan for column 1
            const group = groupInfo.find((g: any) => answerIndex >= g.startIndex && answerIndex < g.startIndex + g.size);
            if (group && answerIndex === group.startIndex) {
              return { ...span, rowspan: group.size, startSpan: true };
            } else {
              return { ...span, skip: true };
            }
          } else {
            // 'start' or 'true' (no grouping) - span entire foreach block
            if (answerIndex === 0) {
              return { ...span, rowspan: answerCount, startSpan: true };
            } else {
              return { ...span, skip: true };
            }
          }
        }

        // Cells with rowspan: true in JAML metadata
        if (cellMeta?.rowspan === true) {
          if (answerIndex === 0) {
            return { ...span, rowspan: answerCount };
          } else {
            return { ...span, skip: true };
          }
        }

        return span;
      });

      return { ...row, type: 'data', cells: updatedCells, spans: updatedSpans, _answerIndex: answerIndex, _questionId: questionId };
    });
  }

  /**
   * Merge start/continue spans across foreach blocks.
   * Cells with startSpan flag start a new span, cells with continueSpan extend it.
   * This allows parent hierarchy cells to span across multiple child foreach blocks.
   */
  private mergeStartContinueSpans(rows: any[]): any[] {
    if (rows.length <= 1) return rows;

    // Create deep copies of rows and spans to avoid mutation issues
    const result = rows.map(row => ({
      ...row,
      spans: row.spans ? row.spans.map((s: any) => ({ ...s })) : []
    }));

    // Find maximum column count across all rows (rows may have different cell counts due to colspan variations)
    const numCols = Math.max(...result.map(row => row.cells?.length || 0));

    for (let colIndex = 0; colIndex < numCols; colIndex++) {
      let activeSpanStartRow: number | null = null;
      let spanRowCount = 0;  // Count only rows that have cells at this column index

      for (let rowIndex = 0; rowIndex < result.length; rowIndex++) {
        const span = result[rowIndex]?.spans?.[colIndex];

        // If row doesn't have a cell at this column index, finalize any active span
        // (rows with different cell counts due to colspan shouldn't be part of the same span)
        if (!span || span.dataRowspan === undefined) {
          if (activeSpanStartRow !== null && spanRowCount > 1) {
            result[activeSpanStartRow].spans[colIndex].rowspan = spanRowCount;
          }
          activeSpanStartRow = null;
          spanRowCount = 0;
          continue;
        }

        if (span.startSpan) {
          // Finalize previous span if any
          if (activeSpanStartRow !== null && spanRowCount > 1) {
            result[activeSpanStartRow].spans[colIndex].rowspan = spanRowCount;
          }
          // Start new span
          activeSpanStartRow = rowIndex;
          spanRowCount = 1;
        } else if (span.dataRowspan) {
          // This row continues or is part of the current span
          spanRowCount++;
        }
      }

      // Finalize last span
      if (activeSpanStartRow !== null && spanRowCount > 1) {
        result[activeSpanStartRow].spans[colIndex].rowspan = spanRowCount;
      }
    }

    return result;
  }

  /**
   * Apply span flags to a template row that has no answers.
   * This ensures mergeStartContinueSpans can properly handle rows with no data.
   */
  private applySpanFlagsToTemplateRow(row: any): any {
    if (!row.spans) {
      return row;
    }

    const updatedSpans = row.spans.map((span: any) => {
      if (span?.dataRowspan) {
        if (span.dataRowspan === 'continue') {
          // Continue cells should be skipped, covered by span from above
          return { ...span, skip: true, continueSpan: true };
        } else {
          // 'start' or 'true' - this is the start of a new span (single row since no answers)
          return { ...span, rowspan: 1, startSpan: true };
        }
      }
      return span;
    });

    return { ...row, spans: updatedSpans };
  }

  /**
   * Check if a table's metadata contains foreach-row templates.
   * Used to determine if we need special handling for expanded rows.
   */
  private tableHasForeachRows(tableMetadata: any): boolean {
    return tableMetadata?.metadata?.some((m: any) => m?.type === 'foreach-row') ?? false;
  }

  /**
   * Update a cell with a specific single answer (not the combined answerData).
   * Used for foreach-row expansion where each row gets one specific answer.
   */
  private updateCellWithSingleAnswer(cell: any, cellMetadata: any, answer: any): any {
    if (!cellMetadata || !answer) {
      return cell;
    }

    if (cellMetadata.type === 'simple' && cellMetadata.field) {
      const fieldSpec = cellMetadata.field;
      const tableFieldSpec = cellMetadata.tableField;

      // Handle pipe-separated field names (e.g., "source|language|origin")
      // Display format: first two values joined with ": ", remaining values joined with " "
      if (fieldSpec && fieldSpec.includes('|')) {
        const fieldNames = fieldSpec.split('|').map((f: string) => f.trim());
        const fieldValues = fieldNames
          .map((f: string) => answer[f])
          .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');

        if (fieldValues.length === 0) return '';
        if (fieldValues.length <= 2) {
          return fieldValues.join(': ');
        }
        // Join first two with ": ", then append rest with ", "
        const firstPart = fieldValues.slice(0, 2).join(': ');
        const restPart = fieldValues.slice(2).join(', ');
        return `${firstPart}, ${restPart}`;
      }

      // Get field value from this specific answer
      const value = answer[fieldSpec];
      if (value === null || value === undefined || value === 'null') {
        return '';
      }

      // Handle nested object with tableField
      if (typeof value === 'object' && !Array.isArray(value) && tableFieldSpec) {
        return this.extractNestedValue(value, tableFieldSpec);
      }

      // Handle arrays
      if (Array.isArray(value)) {
        if (tableFieldSpec) {
          // Array of objects - extract tableField from each
          const values = value.map((item: any) => this.extractNestedValue(item, tableFieldSpec))
            .filter((v: string) => v !== '');
          return values.join(', ');
        }
        return value.join(', ');
      }

      return String(value);
    } else if (cellMetadata.type === 'foreach-div') {
      // Handle nested foreach within cell (e.g., markers array)
      const fieldSpec = cellMetadata.field;
      const tableFieldSpec = cellMetadata.tableField;
      const fieldValue = answer[fieldSpec];

      if (!fieldValue) return '';

      if (Array.isArray(fieldValue)) {
        const values = fieldValue
          .map((item: any) => {
            if (tableFieldSpec) {
              return this.extractNestedValue(item, tableFieldSpec);
            }
            return typeof item === 'object' ? '' : String(item);
          })
          .filter((v: string) => v !== '');

        if (values.length === 0) return '';
        const html = values.map((v: string) => `<div>${v}</div>`).join('');
        return { type: 'html', content: html };
      }

      if (tableFieldSpec) {
        return this.extractNestedValue(fieldValue, tableFieldSpec);
      }

      return typeof fieldValue === 'object' ? '' : String(fieldValue);
    }

    return cell;
  }

  /**
   * Extract value from an object using a tableFieldSpec (supports dot notation and pipe-separated paths).
   * E.g., "origin.source|origin.language" extracts origin.source and origin.language, joining non-null values.
   */
  private extractNestedValue(obj: any, tableFieldSpec: string): string {
    if (!obj || typeof obj !== 'object') {
      return '';
    }

    const getNestedValue = (o: any, path: string): any => {
      const parts = path.split('.');
      let current = o;
      for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
      }
      return current;
    };

    const fieldPaths = tableFieldSpec.split('|').map((f: string) => f.trim());
    const fieldValues = fieldPaths
      .map((path: string) => getNestedValue(obj, path))
      .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');

    return fieldValues.length > 0 ? fieldValues.join(': ') : '';
  }

  private updateCellWithAnswers(cell: any, cellMetadata: any): any {
    if (cellMetadata.type === 'simple' && cellMetadata.id && cellMetadata.field) {
      if (cellMetadata.field === 'question') {
        // For question fields (table headers), always try to populate from category data
        // These should be loaded regardless of sample selection
        const category = this.categoryData[cellMetadata.id];
        if (category && category.name !== undefined && !category.has_children) {
          const value = category.name;

          if (value === null || value === 'null') {
            return '';
          }

          return String(value);
        } else {
          // If category data is not loaded, try to load it
          this.loadCategoryForHeader(cellMetadata.id);
          return '';
        }
      } else {
        // For answer fields, only populate if we have a selected sample and answer data
        if (!this.selectedSample) {
          return ''; // Empty cell when no sample selected
        }

        const answer = this.answerData[cellMetadata.id];
        if (!answer) return '';

        const fieldSpec = cellMetadata.field;
        const tableFieldSpec = cellMetadata.tableField;

        // Handle pipe-separated field names (e.g., "source|language|origin")
        // Display format: first two values joined with ": ", remaining values joined with " "
        // Example: "Current-L2: Bulgarian Inherited"
        if (fieldSpec && fieldSpec.includes('|')) {
          const fieldNames = fieldSpec.split('|').map((f: string) => f.trim());
          const fieldValues = fieldNames
            .map((f: string) => answer[f])
            .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');

          if (fieldValues.length === 0) return '';
          if (fieldValues.length <= 2) {
            return fieldValues.join(': ');
          }
          // Join first two with ": ", then append rest with ", "
          const firstPart = fieldValues.slice(0, 2).join(': ');
          const restPart = fieldValues.slice(2).join(', ');
          return `${firstPart}, ${restPart}`;
        }

        // Single field name
        if (answer[fieldSpec] !== undefined) {
          const value = answer[fieldSpec];

          if (value === null || value === 'null') {
            return '';
          }

          // Handle nested object with tableField (e.g., field: origin, tableField: source|language)
          if (typeof value === 'object' && !Array.isArray(value) && tableFieldSpec) {
            const nestedFieldNames = tableFieldSpec.split('|').map((f: string) => f.trim());
            const nestedValues = nestedFieldNames
              .map((f: string) => value[f])
              .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');
            return nestedValues.length > 0 ? nestedValues.join(': ') : '';
          }

          // Handle arrays of primitives (e.g., ["anglal", "anglal k-"])
          if (Array.isArray(value)) {
            return value.join(', ');
          }

          return String(value);
        }

        return '';
      }
    } else if (cellMetadata.type === 'foreach-div') {
      // Handle multiple answers displayed vertically in divs
      if (!this.selectedSample) {
        return '';
      }

      const answer = this.answerData[cellMetadata.id];
      if (!answer) return '';

      const fieldSpec = cellMetadata.field;
      const tableFieldSpec = cellMetadata.tableField;

      // Helper to get nested property value using dot notation (e.g., "origin.source")
      const getNestedValue = (obj: any, path: string): any => {
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
          if (current === null || current === undefined) return undefined;
          current = current[part];
        }
        return current;
      };

      // Helper to extract value from a single object using tableFieldSpec
      const extractFromObject = (obj: any): string => {
        if (tableFieldSpec) {
          const fieldPaths = tableFieldSpec.split('|').map((f: string) => f.trim());
          const fieldValues = fieldPaths
            .map((path: string) => getNestedValue(obj, path))
            .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');
          return fieldValues.length > 0 ? fieldValues.join(': ') : '';
        }
        if (typeof obj === 'object') {
          return ''; // Don't display [object Object]
        }
        return String(obj);
      };

      // Helper to extract value from an answer object
      const extractValue = (answerObj: any): string => {
        // Get the field value from the answer
        const fieldValue = answerObj[fieldSpec];
        if (fieldValue === null || fieldValue === undefined || fieldValue === 'null') {
          return '';
        }

        // If field value is an array, extract from each element using tableFieldSpec
        if (Array.isArray(fieldValue)) {
          const values = fieldValue
            .map((item: any) => extractFromObject(item))
            .filter((v: string) => v !== '');
          return values.join(', ');
        }

        // If field value is an object, extract using tableFieldSpec
        if (typeof fieldValue === 'object') {
          return extractFromObject(fieldValue);
        }

        return String(fieldValue);
      };

      // For combined answers, use the raw _answers array to get individual values
      if (answer._isCombined && answer._answers) {
        const values = answer._answers
          .map((a: any) => extractValue(a))
          .filter((v: string) => v !== '');

        if (values.length === 0) return '';

        const html = values.map((v: string) => `<div>${v}</div>`).join('');
        return { type: 'html', content: html };
      }

      // Single answer case
      const value = extractValue(answer);
      if (!value) {
        return '';
      }

      return { type: 'html', content: `<div>${value}</div>` };
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

  private loadCategoryDataForHeaders(): void {
    // Collect category IDs that are used for headers (question fields)
    const headerCategoryIds: number[] = [];
    this.collectHeaderCategoryIds(this.cellMetadata, headerCategoryIds);
    
    // Load category data for each header
    headerCategoryIds.forEach(id => {
      if (!this.categoryData[id]) {
        this.dataService.getCategoryById(id).subscribe({
          next: (category) => {
            if (category && !category.has_children) {
              this.categoryData[id] = category;
              // Store in shared cache for other components
              this.searchStateService.setCategoryCache(id, category);
              // Refresh the table display to show the newly loaded category name
              this.updateTableWithAnswers();
            }
          },
          error: (err) => {
            console.error(`Error loading category ${id} for header:`, err);
          }
        });
      }
    });
  }

  private collectHeaderCategoryIds(metadata: any[], categoryIds: number[]): void {
    metadata.forEach(section => {
      if (section.type === 'section-group' && section.metadata) {
        section.metadata.forEach((tableMetadata: any) => {
          if (tableMetadata.type === 'table' && tableMetadata.metadata) {
            tableMetadata.metadata.forEach((item: any) => {
              if (item.type === 'data' && item.cells) {
                item.cells.forEach((cell: any) => {
                  if (cell.type === 'simple' && cell.id && cell.field === 'question' && !isNaN(Number(cell.id))) {
                    const id = Number(cell.id);
                    if (!categoryIds.includes(id)) {
                      categoryIds.push(id);
                    }
                  } else if (cell.type === 'foreach' && cell.nestedMetadata) {
                    this.collectNestedHeaderCategoryIds(cell.nestedMetadata, categoryIds);
                  }
                });
              }
            });
          }
        });
      }
    });
  }

  private collectNestedHeaderCategoryIds(nestedMetadata: any[], categoryIds: number[]): void {
    nestedMetadata.forEach(item => {
      if (item.type === 'data' && item.cells) {
        item.cells.forEach((cell: any) => {
          if (cell.type === 'simple' && cell.id && cell.field === 'question' && !isNaN(Number(cell.id))) {
            const id = Number(cell.id);
            if (!categoryIds.includes(id)) {
              categoryIds.push(id);
            }
          }
        });
      }
    });
  }

  private loadCategoryForHeader(categoryId: number): void {
    // Load category data for header cells even without sample selection
    this.dataService.getCategoryById(categoryId).subscribe({
      next: (category) => {
        if (category && !category.has_children) {
          this.categoryData[categoryId] = category;
          // Store in shared cache for other components
          this.searchStateService.setCategoryCache(categoryId, category);
          // Refresh the table display to show the newly loaded category name
          this.updateTableWithAnswers();
        }
      },
      error: (err) => {
        console.error(`Error loading category ${categoryId} for header:`, err);
      }
    });
  }

  // Search mode methods
  toggleSearchMode(): void {
    this.searchMode = !this.searchMode;
    
    if (this.searchMode) {
      // Entering search mode - clear answer data so cells are empty, keep sample selected
      this.answerData = {};
      this.isLoadingAnswers = false;
      if (this.selectedView) {
        this.parseTableContent(this.selectedView.content);
      }
    } else {
      // Exiting search mode - clear search criteria and restore table data
      this.searchStateService.clearSearchCriteria();
      if (this.selectedView) {
        this.parseTableContent(this.selectedView.content);
        if (this.selectedSample && this.cellMetadata.length > 0) {
          this.fetchAnswersForTable();
        }
      }
    }
  }

  onSearchCellClick(table: any, row: any, cellIndex: number): void {
    let questionId: number;
    let fieldName: string;

    if (row._questionId !== undefined) {
      // Foreach-row expanded row: get metadata from the template row
      const sectionIndex = this.findSectionIndex(table);
      const tableIndex = this.findTableIndex(table, sectionIndex);
      if (sectionIndex === -1 || tableIndex === -1) return;
      const tableMetadata = this.cellMetadata[sectionIndex]?.metadata?.[tableIndex]?.metadata;
      // Find the template row matching this questionId
      const templateMeta = tableMetadata?.find((m: any) => m?.type === 'foreach-row' && m.questionId == row._questionId);
      const cellMeta = templateMeta?.cells?.[cellIndex];
      if (!cellMeta || !cellMeta.id || !cellMeta.field) return;
      questionId = Number(cellMeta.id);
      fieldName = cellMeta.field;
    } else {
      const metadata = this.getCellMetadata(table, row, cellIndex);
      if (!metadata || metadata.type !== 'simple' || !metadata.id || !metadata.field) {
        return;
      }
      // Don't allow searching on question fields (headers)
      if (metadata.field === 'question') {
        return;
      }
      questionId = Number(metadata.id);
      fieldName = metadata.field;
    }

    // Get full hierarchy breadcrumb for display
    const category = this.categoryData[questionId];
    let questionHierarchy = '';
    if (category && category.hierarchy && category.hierarchy.length > 0) {
      // Show full hierarchy including the category name
      questionHierarchy = category.hierarchy.join(' > ');
    } else if (category && category.name) {
      questionHierarchy = category.name;
    } else {
      // If category data isn't loaded, try to load it first
      questionHierarchy = `Question ${questionId}`;
      // Attempt to load the category data
      this.loadCategoryForSearchModal(questionId, fieldName);
      return;
    }
    
    this.showSearchValueModal(questionId, fieldName, questionHierarchy);
  }

  private loadCategoryForSearchModal(questionId: number, fieldName: string): void {
    this.dataService.getCategoryById(questionId).subscribe({
      next: (category) => {
        if (category) {
          this.categoryData[questionId] = category;
          // Store in shared cache for other components
          this.searchStateService.setCategoryCache(questionId, category);
          // Now show the modal with proper hierarchy
          let questionHierarchy = '';
          if (category.hierarchy && category.hierarchy.length > 0) {
            questionHierarchy = category.hierarchy.join(' > ');
          } else {
            questionHierarchy = category.name || `Question ${questionId}`;
          }
          this.showSearchValueModal(questionId, fieldName, questionHierarchy);
        } else {
          // Fallback if category couldn't be loaded
          this.showSearchValueModal(questionId, fieldName, `Question ${questionId}`);
        }
      },
      error: (err) => {
        console.error(`Error loading category ${questionId} for search modal:`, err);
        // Fallback if there was an error
        this.showSearchValueModal(questionId, fieldName, `Question ${questionId}`);
      }
    });
  }

  showSearchValueModal(questionId: number, fieldName: string, questionName: string): void {
    this.searchModalQuestionId = questionId;
    this.searchModalFieldName = fieldName;
    this.searchModalQuestionName = questionName;
    
    // Get hierarchy for the modal
    const category = this.categoryData[questionId];
    this.searchModalHierarchy = (category && category.hierarchy) ? category.hierarchy : [];
    
    this.showSearchModal = true;
  }

  // New shared dialog handlers
  onSearchCriterionConfirmed(criterion: SearchCriterion): void {
    this.searchStateService.addSearchCriterion(criterion);
    this.closeSearchModal();
  }
  
  onSearchCriterionCancelled(): void {
    this.closeSearchModal();
  }

  closeSearchModal(): void {
    this.showSearchModal = false;
    this.searchModalQuestionId = 0;
    this.searchModalFieldName = '';
    this.searchModalQuestionName = '';
    this.searchModalHierarchy = [];
  }

  clearSearchCriteria(): void {
    this.searchStateService.clearSearchCriteria();
  }

  removeSearchCriterion(index: number): void {
    this.searchStateService.removeSearchCriterion(index);
  }

  executeSearch(): void {
    const searchCriteria = this.searchContext.searches;

    if (searchCriteria.length === 0) {
      return;
    }

    // Store the current view context in the search context before executing
    const currentContext = this.searchStateService.getSearchContext();
    this.searchStateService.setSearchContext({
      ...currentContext,
      selectedView: this.selectedView,
      selectedCategory: this.selectedCategory
    });

    // Call the searchAnswers endpoint with current criteria
    this.dataService.searchAnswers(searchCriteria).subscribe({
      next: (results) => {
        // Update search state service with results
        const searchStatus = `Found ${results.length} answers for ${searchCriteria.length} search ${searchCriteria.length === 1 ? 'criterion' : 'criteria'}.`;
        this.searchStateService.updateSearchResults(results, searchStatus, 'searchAnswers');
        
        // Clear current selections since we're switching to search results
        this.searchStateService.updateSampleSelection([]);
        this.searchStateService.updateQuestionSelection([]);
        
        // Build search string in the format expected by the search component
        // For search criteria, we use a special format to distinguish from regular searches
        const searchString = JSON.stringify({
          questions: [],
          samples: [],
          searches: searchCriteria
        });
        this.searchStateService.updateSearchString(searchString);
        
        // Navigate to search page which will show results tab
        this.router.navigate(['/search']);
      },
      error: (error) => {
        console.error('Error executing search:', error);
        // You could show an error message to the user here
        const errorMessage = 'Search failed. Please try again later.';
        this.searchStateService.updateSearchResults([], errorMessage, null);
      }
    });
  }

  private getQuestionNameForCriterion(questionId: number): string {
    const category = this.categoryData[questionId];
    if (category && category.hierarchy && category.hierarchy.length > 0) {
      return category.hierarchy.join(' > ');
    } else if (category) {
      return category.name;
    }
    return `Question ${questionId}`;
  }

  getQuestionHierarchyForCriterion(questionId: number): string {
    // First check local categoryData
    const category = this.categoryData[questionId];
    if (category && category.hierarchy && category.hierarchy.length > 0) {
      // Remove "RMS" from the beginning and join with " > "
      const hierarchyWithoutRMS = category.hierarchy.filter((item: string) => item !== 'RMS');
      return hierarchyWithoutRMS.join(' > ');
    } else if (category) {
      return category.name;
    }
    
    // Fallback to shared category cache
    const cachedCategory = this.searchStateService.getCategoryCache(questionId);
    if (cachedCategory && cachedCategory.hierarchy && cachedCategory.hierarchy.length > 0) {
      // Remove "RMS" from the beginning and join with " > "
      const hierarchyWithoutRMS = cachedCategory.hierarchy.filter((item: string) => item !== 'RMS');
      return hierarchyWithoutRMS.join(' > ');
    } else if (cachedCategory) {
      return cachedCategory.name;
    }
    
    return `Question ${questionId}`;
  }

}

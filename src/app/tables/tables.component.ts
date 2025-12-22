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

    // Load current sample from global state (legacy compatibility)
    this.selectedSample = this.searchStateService.getCurrentSample();
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
      // Create a temporary DOM element to parse the HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;

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
        // Use innerHTML if cell contains [foreach] to preserve HTML structure
        // Otherwise use textContent to get clean text
        const cellContent = cell.innerHTML?.trim() || '';
        const needsHtml = cellContent.includes('[foreach]');
        const cellText = needsHtml ? cellContent : (cell.textContent?.trim() || '');
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

    // Handle divs with metadata for vertical answer display
    const divs = tempDiv.querySelectorAll('div');
    if (divs.length > 0) {
      const firstDiv = divs[0];
      const divText = firstDiv.textContent?.trim() || '';

      if (this.containsJsonPattern(divText)) {
        const jsonData = this.extractJsonFromCell(divText);
        if (jsonData.id && jsonData.field) {
          // Store the div as an HTML template for later substitution
          return {
            data: '',  // Will be replaced with HTML content
            metadata: {
              type: 'foreach-div',
              id: jsonData.id,
              field: jsonData.field,
              template: '<div></div>'  // Simple div template for wrapping values
            }
          };
        }
      }
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

  isCellClickable(table: any, row: any, cellIndex: number): boolean {
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
      // In normal mode, only allow clicking if we have answer data and phrases are available
      return metadata.field !== 'question';
    }
  }

  onCellClick(table: any, row: any, cellIndex: number): void {
    console.log('Cell clicked:', table, row, cellIndex);
    if (!this.isCellClickable(table, row, cellIndex)) {
      return;
    }

    // Check if we're in search mode
    if (this.searchMode) {
      this.onSearchCellClick(table, row, cellIndex);
      return;
    }

    // Normal mode - open phrases modal
    const metadata = this.getCellMetadata(table, row, cellIndex);
    if (metadata && metadata.id) {
      let answer = this.answerData[metadata.id];

      // If this is a combined answer, use the first one (all have the same tags)
      if (answer && answer._isCombined && answer._answers) {
        answer = answer._answers[0];
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
    
    this.modalTitle = `Phrases for ${sampleRef} - ${questionHierarchy}: "${answerValue}"`;
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

  private getCellMetadata(table: any, row: any, cellIndex: number): any {
    if (!this.tableData || !this.cellMetadata) {
      return null;
    }

    // Find the table index within the current section
    let tableIndex = -1;
    let sectionIndex = -1;
    
    for (let i = 0; i < this.tableData.sections.length; i++) {
      const section = this.tableData.sections[i];
      for (let j = 0; j < section.tables.length; j++) {
        if (section.tables[j] === table) {
          sectionIndex = i;
          tableIndex = j;
          break;
        }
      }
      if (tableIndex !== -1) break;
    }

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
        sectionMetadata.metadata[tableIndex].metadata && sectionMetadata.metadata[tableIndex].metadata[rowIndex] &&
        sectionMetadata.metadata[tableIndex].metadata[rowIndex].cells) {
      return sectionMetadata.metadata[tableIndex].metadata[rowIndex].cells[cellIndex];
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
    this.filterCategories();
  }

  filterCategories(): void {
    if (!this.searchTerm || this.searchTerm.trim() === '') {
      this.filteredCategories = this.categories;
      return;
    }

    const term = this.searchTerm.toLowerCase();
    this.filteredCategories = this.categories.filter(category => {
      // Search in category name
      const name = category.name?.toLowerCase() || '';
      if (name.includes(term)) {
        return true;
      }

      // Search in hierarchy
      if (category.hierarchy) {
        const hierarchyText = category.hierarchy.join(' ').toLowerCase();
        if (hierarchyText.includes(term)) {
          return true;
        }
      }

      // Search in path
      const path = category.path?.toLowerCase() || '';
      if (path.includes(term)) {
        return true;
      }

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
              if (item.type === 'data' && item.cells) {
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
            // Handle object with source/language properties
            if (typeof value === 'object' && !Array.isArray(value) && value.source && value.language) {
              return `${value.source}: ${value.language}`;
            }
            // Handle array of objects with source/language properties
            if (Array.isArray(value) && value.length > 0 && value[0].source && value[0].language) {
              return value.map((obj: any) => `${obj.source}: ${obj.language}`).join(', ');
            }
            // Handle arrays of primitives
            if (Array.isArray(value)) {
              return value.join(', ');
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

        // Handle pipe-separated field names (e.g., "source|language")
        if (fieldSpec && fieldSpec.includes('|')) {
          const fieldNames = fieldSpec.split('|').map((f: string) => f.trim());
          const fieldValues = fieldNames
            .map((f: string) => answer[f])
            .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');
          return fieldValues.length > 0 ? fieldValues.join(': ') : '';
        }

        // Single field name
        if (answer[fieldSpec] !== undefined) {
          const value = answer[fieldSpec];

          if (value === null || value === 'null') {
            return '';
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

      // Helper to extract value from an answer object
      const extractValue = (answerObj: any): string => {
        // Check if field contains pipe-separated names (e.g., "source|language")
        if (fieldSpec.includes('|')) {
          const fieldNames = fieldSpec.split('|').map((f: string) => f.trim());
          const fieldValues = fieldNames
            .map((f: string) => answerObj[f])
            .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');
          return fieldValues.join(': ');
        }
        // Single field name
        const value = answerObj[fieldSpec];
        if (value === null || value === undefined || value === 'null') {
          return '';
        }
        return String(value);
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
      // Entering search mode - clear sample selection but preserve existing search criteria
      this.onSampleCleared();
      // Don't clear search criteria - let user build on existing ones or start fresh manually
    } else {
      // Exiting search mode - clear search criteria
      this.searchStateService.clearSearchCriteria();
    }
  }

  onSearchCellClick(table: any, row: any, cellIndex: number): void {
    const metadata = this.getCellMetadata(table, row, cellIndex);
    if (!metadata || metadata.type !== 'simple' || !metadata.id || !metadata.field) {
      return;
    }

    // Don't allow searching on question fields (headers)
    if (metadata.field === 'question') {
      return;
    }

    const questionId = Number(metadata.id);
    const fieldName = metadata.field;

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

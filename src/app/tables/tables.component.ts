import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../api/data.service';

@Component({
  selector: 'app-tables',
  imports: [CommonModule, FormsModule],
  templateUrl: './tables.component.html',
  styleUrl: './tables.component.scss'
})
export class TablesComponent implements OnInit {
  views: any[] = [];
  selectedView: any = null;
  tableData: { headers: string[], rows: string[][] } | null = null;
  
  // Sample selection properties
  samples: any[] = [];
  filteredSamples: any[] = [];
  selectedSample: any = null;
  sampleSearchTerm: string = '';

  // Answer data properties
  cellMetadata: { id: string, field: string }[][] = [];
  answerData: { [key: string]: any } = {};
  isLoadingAnswers: boolean = false;
  currentCategoryIds: number[] = []; // Store category IDs for current table

  constructor(private dataService: DataService) { }

  ngOnInit(): void {
    // Load views
    this.dataService.getViews().subscribe({
      next: (views) => {
        this.views = views.sort((a: any, b: any) => a.parent_id - b.parent_id);
      },
      error: (err) => {
        console.error('Error fetching views:', err);
      }
    });

    // Load samples for modal
    this.dataService.getSamples().subscribe({
      next: (samples) => {
        this.samples = samples;
        this.filteredSamples = samples;
      },
      error: (err) => {
        console.error('Error fetching samples:', err);
      }
    });
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

      // Find the table element
      const table = tempDiv.querySelector('table');
      if (!table) {
        this.tableData = null;
        this.cellMetadata = [];
        return;
      }

      // Check if first row contains JSON data (no real headers)
      const allRows = table.querySelectorAll('tbody tr') || table.querySelectorAll('tr');
      let hasHeaders = true;
      let startIndex = 0;
      
      if (allRows.length > 0 && !table.querySelector('thead')) {
        const firstRowCells = allRows[0].querySelectorAll('th, td');
        let hasJsonInFirstRow = false;
        
        firstRowCells.forEach(cell => {
          const cellText = cell.textContent?.trim() || '';
          if (cellText.match(/\{[^}]*id[^}]*:[^}]*field[^}]*:[^}]*\}/i) || 
              cellText.match(/<\[[^}]*\{[^}]*id[^}]*:[^}]*field[^}]*:[^}]*\}[^}]*\]>/i)) {
            hasJsonInFirstRow = true;
          }
        });
        
        hasHeaders = !hasJsonInFirstRow;
        startIndex = hasHeaders ? 1 : 0;
      } else if (table.querySelector('thead')) {
        startIndex = 0;
      } else {
        startIndex = 1; // Default: assume first row is headers
      }

      // Extract headers
      const headers: string[] = [];
      if (hasHeaders) {
        const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
        if (headerRow) {
          const headerCells = headerRow.querySelectorAll('th, td');
          headerCells.forEach(cell => {
            headers.push(cell.textContent?.trim() || '');
          });
        }
      }

      // Extract data rows and metadata
      const rows: string[][] = [];
      const metadata: { id: string, field: string }[][] = [];
      
      for (let i = startIndex; i < allRows.length; i++) {
        const row = allRows[i];
        const cells = row.querySelectorAll('td, th');
        const rowData: string[] = [];
        const rowMetadata: { id: string, field: string }[] = [];
        
        cells.forEach(cell => {
          const cellText = cell.textContent?.trim() || '';
          
          // For debugging, let's see what we're getting
          console.log('Cell content:', cellText);
          
          // Try to extract {id: value, field: value} from cell content
          let cellId = '';
          let cellField = '';
          
          try {
            // Look for JSON-like pattern in cell content
            const jsonMatch = cellText.match(/\{[^}]*id[^}]*:[^}]*,?[^}]*field[^}]*:[^}]*\}/i);
            if (jsonMatch) {
              console.log('Found JSON pattern:', jsonMatch[0]);
              
              // Try to parse as JSON
              const jsonStr = jsonMatch[0].replace(/(\w+):/g, '"$1":'); // Add quotes around keys
              const parsed = JSON.parse(jsonStr);
              
              cellId = String(parsed.id || '');
              cellField = String(parsed.field || '');
              
              console.log('Extracted ID:', cellId, 'Field:', cellField);
            }
          } catch (error) {
            // If JSON parsing fails, try regex extraction
            const idMatch = cellText.match(/id\s*:\s*([^,}\s]+)/i);
            const fieldMatch = cellText.match(/field\s*:\s*([^,}\s]+)/i);
            
            if (idMatch) cellId = idMatch[1].trim();
            if (fieldMatch) cellField = fieldMatch[1].trim();
            
            console.log('Regex extracted ID:', cellId, 'Field:', cellField);
          }
          
          // If we have id and field, this cell will be populated with answer data
          if (cellId && cellField) {
            rowData.push(''); // Start with empty, will be filled by answers
            rowMetadata.push({ id: cellId, field: cellField });
          } else {
            // Keep original content for cells without metadata
            rowData.push(cellText);
            rowMetadata.push({ id: '', field: '' });
          }
        });
        
        if (rowData.length > 0) {
          rows.push(rowData);
          metadata.push(rowMetadata);
        }
      }

      this.tableData = { headers, rows };
      this.cellMetadata = metadata;
      
      console.log('Parsed metadata:', this.cellMetadata);
    } catch (error) {
      console.error('Error parsing table content:', error);
      this.tableData = null;
      this.cellMetadata = [];
    }
  }

  // Sample selection methods
  onSampleSearch(): void {
    if (!this.sampleSearchTerm.trim()) {
      this.filteredSamples = this.samples;
      return;
    }
    
    const term = this.sampleSearchTerm.toLowerCase();
    this.filteredSamples = this.samples.filter(sample => 
      sample.sample_ref.toLowerCase().includes(term) ||
      sample.dialect_name.toLowerCase().includes(term) ||
      sample.location?.toLowerCase().includes(term)
    );
  }

  selectSample(sample: any): void {
    const previousSample = this.selectedSample;
    this.selectedSample = sample;
    
    // If we have a selected view and this is a sample change (not initial selection)
    if (this.selectedView && this.cellMetadata.length > 0) {
      if (previousSample && previousSample.sample_ref !== sample.sample_ref) {
        // Sample changed while viewing a table - refresh answers only
        this.fetchAnswersWithCurrentIds();
      } else if (!previousSample) {
        // Initial sample selection with view already selected
        this.fetchAnswersForTable();
      }
    }
  }

  fetchAnswersForTable(): void {
    if (!this.selectedSample || this.cellMetadata.length === 0) {
      return;
    }

    // Collect unique category IDs from all cells
    const categoryIds: number[] = [];
    this.cellMetadata.forEach(row => {
      row.forEach(cell => {
        if (cell.id && !isNaN(Number(cell.id))) {
          const id = Number(cell.id);
          if (!categoryIds.includes(id)) {
            categoryIds.push(id);
          }
        }
      });
    });

    if (categoryIds.length === 0) {
      console.warn('No valid category IDs found in table cells');
      return;
    }

    // Store category IDs for potential reuse
    this.currentCategoryIds = categoryIds;

    this.fetchAnswersWithCurrentIds();
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

    // Process each answer and map to cells
    answers.forEach(answer => {
      const key = `${answer.question_id || answer.category}`;
      this.answerData[key] = answer;
    });

    // Update table data with answer values
    this.updateTableWithAnswers();
  }

  updateTableWithAnswers(): void {
    if (!this.tableData || this.cellMetadata.length === 0) {
      return;
    }

    // Create new rows with answer data
    const updatedRows: string[][] = [];
    
    for (let rowIndex = 0; rowIndex < this.cellMetadata.length; rowIndex++) {
      const row = this.cellMetadata[rowIndex];
      const newRow: string[] = [];
      
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const cell = row[colIndex];
        
        if (cell.id && cell.field) {
          const answer = this.answerData[cell.id];
          
          if (answer && answer[cell.field] !== undefined) {
            const value = String(answer[cell.field]);
            newRow.push(value);
          } else {
            newRow.push('-'); // Default value when no answer found
          }
        } else {
          // Keep original cell content if no id/field metadata
          const originalValue = this.tableData!.rows[rowIndex]?.[colIndex] || '';
          newRow.push(originalValue);
        }
      }
      
      updatedRows.push(newRow);
    }

    // Update the table data
    this.tableData = {
      headers: this.tableData.headers,
      rows: updatedRows
    };
  }

}

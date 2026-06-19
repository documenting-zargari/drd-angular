import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { DataService } from '../../api/data.service';

@Component({
  selector: 'app-sample-import',
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule],
  templateUrl: './sample-import.component.html',
  styleUrl: './sample-import.component.scss',
})
export class SampleImportComponent implements OnInit {
  tab: 'import' | 'history' = 'import';

  metaForm: FormGroup;
  selectedFile: File | null = null;
  fileName = '';
  skipEmpty = false;
  upgrade = false;
  sampleExists = false;
  existingPhraseCount = 0;
  showCheckModal = false;
  checkingRef = false;
  checkResult: any = null;

  importing = false;
  importErrors: { row: number; phrase_ref: string; message: string }[] = [];
  importErrorMessage = '';
  lastResult: { batch_id: string; sample_ref: string; phrase_count: number; updated_count: number; skipped_count: number; created_at: string } | null = null;

  history: any[] = [];
  historyLoading = false;
  rollbackConfirmId: string | null = null;
  rollbackLoading = false;
  rollbackError = '';

  constructor(
    private fb: FormBuilder,
    private dataService: DataService,
    private router: Router,
  ) {
    this.metaForm = this.fb.group({
      sample_ref: ['', Validators.required],
      dialect_name: [''],
      self_attrib_name: [''],
      dialect_group_name: [''],
      location: [''],
      country_code: [''],
      source_type: [''],
      visible: ['No'],
      migrant: ['No'],
    });
  }

  ngOnInit(): void {}

  downloadTemplate(): void {
    this.dataService.downloadImportTemplate();
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedFile = file;
    this.fileName = file?.name ?? '';
    this.importErrors = [];
    this.importErrorMessage = '';
    this.sampleExists = false;
    this.upgrade = false;
    this.existingPhraseCount = 0;
  }

  submit(): void {
    if (this.metaForm.invalid) {
      this.metaForm.markAllAsTouched();
      return;
    }
    if (!this.selectedFile) {
      this.importErrorMessage = 'Please select a CSV file.';
      return;
    }

    this.importing = true;
    this.importErrors = [];
    this.importErrorMessage = '';
    this.lastResult = null;
    this.sampleExists = false;

    const fd = new FormData();
    fd.append('file', this.selectedFile);
    const vals = this.metaForm.value;
    for (const key of Object.keys(vals)) {
      fd.append(key, vals[key] ?? '');
    }
    fd.append('skip_empty', this.skipEmpty ? 'true' : 'false');
    fd.append('upgrade', this.upgrade ? 'true' : 'false');

    this.dataService.importSample(fd).subscribe({
      next: (res) => {
        this.importing = false;
        this.lastResult = res;
        this.upgrade = false;
        this.sampleExists = false;
        this.metaForm.reset({ visible: 'No', migrant: 'No' });
        this.selectedFile = null;
        this.fileName = '';
      },
      error: (err) => {
        this.importing = false;
        const body = err.error;
        if (body?.errors) {
          this.importErrors = body.errors;
        } else if (body?.exists) {
          this.sampleExists = true;
          this.existingPhraseCount = body.existing_phrase_count ?? 0;
        } else {
          this.importErrorMessage = body?.error || body?.detail || body?.message
            || (typeof body === 'string' ? body : null)
            || `Import failed (HTTP ${err.status}). Check the server logs for details.`;
        }
      },
    });
  }

  checkRef(): void {
    const ref = (this.metaForm.get('sample_ref')?.value || '').trim();
    if (!ref) return;
    this.checkingRef = true;
    this.checkResult = null;
    this.dataService.checkSampleRef(ref).subscribe({
      next: (result) => {
        this.checkingRef = false;
        this.checkResult = result;
        this.showCheckModal = true;
      },
      error: () => {
        this.checkingRef = false;
      },
    });
  }

  populateFromCheck(): void {
    if (!this.checkResult?.sample) return;
    const s = this.checkResult.sample;
    this.metaForm.patchValue({
      dialect_name:       s.dialect_name       ?? '',
      self_attrib_name:   s.self_attrib_name   ?? '',
      dialect_group_name: s.dialect_group_name ?? '',
      location:           s.location           ?? '',
      country_code:       s.country_code       ?? '',
      source_type:        s.source_type        ?? '',
      visible:            s.visible            ?? 'No',
      migrant:            s.migrant            ?? 'No',
    });
    this.showCheckModal = false;
  }

  confirmUpgrade(): void {
    this.upgrade = true;
    this.sampleExists = false;
    this.submit();
  }

  cancelUpgrade(): void {
    this.sampleExists = false;
    this.upgrade = false;
  }

  undoImport(): void {
    if (!this.lastResult) return;
    this.rollbackLoading = true;
    this.dataService.rollbackImportBatch(this.lastResult.batch_id).subscribe({
      next: () => {
        this.rollbackLoading = false;
        this.lastResult = null;
      },
      error: (err) => {
        this.rollbackLoading = false;
        const body = err.error;
        this.importErrorMessage = body?.error || body?.detail || `Rollback failed (HTTP ${err.status}).`;
      },
    });
  }

  goToSample(): void {
    if (this.lastResult) {
      this.router.navigate(['/samples', this.lastResult.sample_ref]);
    }
  }

  loadHistory(): void {
    this.historyLoading = true;
    this.rollbackError = '';
    this.dataService.getImportHistory().subscribe({
      next: (h) => {
        this.history = h;
        this.historyLoading = false;
      },
      error: () => { this.historyLoading = false; },
    });
  }

  switchTab(t: 'import' | 'history'): void {
    this.tab = t;
    if (t === 'history') this.loadHistory();
  }

  confirmRollback(batchId: string): void {
    this.rollbackConfirmId = batchId;
  }

  cancelRollback(): void {
    this.rollbackConfirmId = null;
  }

  doRollback(batchId: string): void {
    this.rollbackLoading = true;
    this.rollbackError = '';
    this.rollbackConfirmId = null;
    this.dataService.rollbackImportBatch(batchId).subscribe({
      next: () => {
        this.rollbackLoading = false;
        this.loadHistory();
      },
      error: (err) => {
        this.rollbackLoading = false;
        const body = err.error;
        this.rollbackError = body?.error || body?.detail || `Rollback failed (HTTP ${err.status}).`;
      },
    });
  }
}

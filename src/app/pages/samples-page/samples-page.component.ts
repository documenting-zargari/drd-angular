import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { DataService } from '../../api/data.service';
import { ExportService, ExportFormat } from '../../api/export.service';
import { ExportModalComponent } from '../../shared/export-modal/export-modal.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';
import { UserService } from '../../api/user.service';
import { SearchStateService } from '../../api/search-state.service';
import { UrlStateService } from '../../api/url-state.service';

@Component({
  selector: 'app-samples-page',
  imports: [CommonModule, FormsModule, RouterModule, PaginationComponent, ExportModalComponent],
  templateUrl: './samples-page.component.html',
  styleUrl: './samples-page.component.scss'
})
export class SamplesPageComponent implements OnInit, OnDestroy {
  samples: any[] = [];
  filteredSamples: any[] = [];
  pagedSamples: any[] = [];
  sampleSearchTerm = '';
  pub = false;
  migrant = true;
  loading = false;
  currentPage = 1;
  pageSize = 25;

  isGlobalAdmin = false;
  showHiddenSamples = false;
  togglingHidden = false;
  hiddenToggleError = '';

  private subscriptions: Subscription[] = [];

  @ViewChild('exportModal') exportModal!: ExportModalComponent;

  constructor(
    private dataService: DataService,
    private exportService: ExportService,
    private userService: UserService,
    private searchStateService: SearchStateService,
    private urlState: UrlStateService,
  ) {}

  ngOnInit(): void {
    const info = this.userService.getUserInfo();
    this.isGlobalAdmin = info?.is_global_admin ?? false;
    this.showHiddenSamples = info?.show_hidden_samples ?? false;

    this.subscriptions.push(
      this.urlState.selectMany<{ q: string; pub: boolean; migrant: boolean; page: number }>({
        q:       raw => raw ?? '',
        pub:     raw => this.urlState.parseBool(raw, false),
        migrant: raw => this.urlState.parseBool(raw, true),
        page:    raw => Math.max(1, parseInt(raw ?? '1', 10) || 1),
      }).subscribe(vm => {
        this.sampleSearchTerm = vm.q;
        this.pub = vm.pub;
        this.migrant = vm.migrant;
        this.currentPage = vm.page;
        this.applyFilter();
      })
    );

    this.loadSamples();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  toggleShowHiddenSamples(enabled: boolean): void {
    this.togglingHidden = true;
    this.hiddenToggleError = '';
    this.userService.setShowHiddenSamples(enabled).subscribe({
      next: () => {
        this.showHiddenSamples = enabled;
        this.togglingHidden = false;
        this.searchStateService.clearSamplesCache();
        this.loadSamples();
      },
      error: (err) => {
        this.showHiddenSamples = !enabled;
        this.togglingHidden = false;
        this.hiddenToggleError = err?.error?.detail || 'Failed to update setting.';
      },
    });
  }

  loadSamples(): void {
    this.loading = true;
    this.dataService.getSamples().subscribe({
      next: (samples) => {
        this.samples = samples;
        this.samples.forEach(sample => sample.migrant = sample.migrant == "Yes" ? true : false);
        this.applyFilter();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  onSampleSearch(): void {
    this.urlState.patch({ q: this.sampleSearchTerm || null, page: null }, { replaceUrl: true });
  }

  togglePub(): void {
    const next = !this.pub;
    this.urlState.patch({ pub: next ? '1' : null, page: null }, { replaceUrl: true });
  }

  toggleMigrant(): void {
    const next = !this.migrant;
    this.urlState.patch({ migrant: next ? null : '0', page: null }, { replaceUrl: true });
  }

  onPageChange(page: number): void {
    this.urlState.patch({ page: page > 1 ? page : null }, { replaceUrl: true });
  }

  private applyFilter(): void {
    if (this.samples.length === 0) return;

    let filtered = this.pub
      ? this.samples
      : this.samples.filter(s => s.sample_ref.substring(0, 3) !== 'PUB');
    filtered = this.migrant ? filtered : filtered.filter(s => !s.migrant);

    if (this.sampleSearchTerm.trim()) {
      const term = this.sampleSearchTerm.toLowerCase();
      filtered = filtered.filter(s =>
        s.sample_ref.toLowerCase().includes(term) ||
        s.dialect_name.toLowerCase().includes(term) ||
        s.location?.toLowerCase().includes(term)
      );
    }

    this.filteredSamples = filtered.sort((a, b) => a.sample_ref.localeCompare(b.sample_ref));
    this.updatePagedSamples();
  }

  private updatePagedSamples(): void {
    const start = (this.currentPage - 1) * this.pageSize;
    this.pagedSamples = this.filteredSamples.slice(start, start + this.pageSize);
  }

  openExportModal(): void {
    this.exportModal.open();
  }

  confirmExport(format: ExportFormat): void {
    const columns = [
      'sample_ref', 'dialect_name', 'self_attrib_name',
      'source_type', 'location', 'country_code',
      'latitude', 'longitude', 'dialect_group_name',
      'Current-L2', 'Recent-L2', 'Old-L2',
      'visible', 'migrant',
    ];
    const rows = this.filteredSamples.map(s => {
      const contactLangs: Record<string, string> = {};
      for (const cl of s.contact_languages || []) {
        if (cl.source && cl.language) {
          const existing = contactLangs[cl.source];
          contactLangs[cl.source] = existing ? `${existing}, ${cl.language}` : cl.language;
        }
      }
      const row: Record<string, string> = {};
      for (const col of columns) {
        if (col === 'latitude') row[col] = String(s.coordinates?.latitude ?? '');
        else if (col === 'longitude') row[col] = String(s.coordinates?.longitude ?? '');
        else if (col === 'Current-L2' || col === 'Recent-L2' || col === 'Old-L2') row[col] = contactLangs[col] ?? '';
        else row[col] = String(s[col] ?? '');
      }
      return row;
    });
    this.exportService.download(columns, rows, format, 'samples');
  }
}

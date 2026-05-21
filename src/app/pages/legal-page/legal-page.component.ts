import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

type LegalPageType = 'imprint' | 'data-protection' | 'privacy-settings';

interface PageConfig {
  title: string;
  icon: string;
  section: 'full' | 'data-privacy' | 'privacy-settings';
}

const IMPRINT_URL = 'https://imprint.acdh.oeaw.ac.at/24886';

const PAGE_CONFIGS: Record<LegalPageType, PageConfig> = {
  'imprint': { title: 'Imprint', icon: 'bi-building', section: 'full' },
  'data-protection': { title: 'Data Protection', icon: 'bi-shield-check', section: 'data-privacy' },
  'privacy-settings': { title: 'Privacy Settings', icon: 'bi-sliders', section: 'privacy-settings' },
};

@Component({
  selector: 'app-legal-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './legal-page.component.html',
  styleUrl: './legal-page.component.scss'
})
export class LegalPageComponent implements OnInit {
  pageType: LegalPageType = 'imprint';
  config: PageConfig = PAGE_CONFIGS['imprint'];
  content: SafeHtml | null = null;
  loading = true;
  error = false;

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.route.url.subscribe(segments => {
      const path = segments[0]?.path as LegalPageType;
      if (path && PAGE_CONFIGS[path]) {
        this.pageType = path;
        this.config = PAGE_CONFIGS[path];
      }
      this.loadContent();
    });
  }

  private loadContent(): void {
    if (this.config.section === 'privacy-settings') {
      this.loading = false;
      return;
    }

    this.loading = true;
    this.error = false;

    this.http.get(IMPRINT_URL, { responseType: 'text' }).subscribe({
      next: (html) => {
        const section = this.config.section === 'privacy-settings' ? 'full' : this.config.section;
        const extracted = this.extractSection(html, section);
        this.content = this.sanitizer.bypassSecurityTrustHtml(extracted);
        this.loading = false;
      },
      error: () => {
        this.error = true;
        this.loading = false;
      }
    });
  }

  private extractSection(html: string, section: 'full' | 'data-privacy'): string {
    if (section === 'full') return html;

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild!;

    const headings = Array.from(root.querySelectorAll('h3'));
    const target = headings.find(h => h.textContent?.includes('Data privacy notice'));
    if (!target) return html;

    const result: Element[] = [target];
    let sibling = target.nextElementSibling;
    while (sibling && sibling.tagName !== 'H3' && sibling.tagName !== 'H2') {
      result.push(sibling);
      sibling = sibling.nextElementSibling;
    }

    return result.map(el => el.outerHTML).join('\n');
  }
}

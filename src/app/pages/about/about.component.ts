import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';

interface SectionMetadata {
  title: string;
  icon: string;
}

@Component({
  selector: 'app-about',
  imports: [CommonModule, RouterModule],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss'
})
export class AboutComponent implements OnInit {
  currentSection: 'aims' | 'structure' | 'background' = 'aims';
  
  // Minimal metadata for each section
  sectionData: Record<string, SectionMetadata> = {
    'aims': {
      title: 'Aims',
      icon: 'bi-target'
    },
    'structure': {
      title: 'Structure', 
      icon: 'bi-diagram-3'
    },
    'background': {
      title: 'Background',
      icon: 'bi-book'
    }
  };

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    // Detect current section from route
    this.route.url.subscribe(url => {
      if (url.length > 1) {
        const section = url[1].path;
        if (section === 'aims' || section === 'structure' || section === 'background') {
          this.currentSection = section;
        }
      }
    });
  }

  getCurrentSectionData(): SectionMetadata {
    return this.sectionData[this.currentSection];
  }

  scrollToSection(sectionId: string): void {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}
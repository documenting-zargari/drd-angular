import { Component } from '@angular/core';

@Component({
  selector: 'app-help',
  imports: [],
  templateUrl: './help.component.html',
  styleUrl: './help.component.scss'
})
export class HelpComponent {

  scrollToSection(sectionId: string): void {
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      const element = document.getElementById(sectionId);
      if (element) {
        element.scrollIntoView({ 
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest'
        });
      } else {
        console.log(`Element with ID '${sectionId}' not found`);
      }
    }, 100);
  }
}

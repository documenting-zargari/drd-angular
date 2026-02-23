import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { UserService } from './api/user.service';
import { DataService } from './api/data.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    CommonModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  constructor(
    private userService: UserService,
    private dataService: DataService,
  ) {
    this.userService.loggedIn$.subscribe((status) => {
      this.isLoggedIn = status
    })
  }

  isLoggedIn = false
  title = 'roma-client';

  onTablesClick() {
    this.dataService.resetTablesView();
    this.collapseNavbar();
  }

  collapseNavbar() {
    const navbarCollapse = document.getElementById('navbarSupportedContent');
    if (navbarCollapse && navbarCollapse.classList.contains('show')) {
      navbarCollapse.classList.remove('show');
    }
  }
}

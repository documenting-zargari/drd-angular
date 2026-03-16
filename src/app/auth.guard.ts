import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router } from '@angular/router';
import { UserService } from './api/user.service';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  constructor(
    private userService: UserService,
    private router: Router,
  ) {}

  canActivate(route: ActivatedRouteSnapshot): boolean {
    if (!this.userService.isLoggedIn()) {
      this.router.navigate(['login']);
      return false;
    }

    const requiredRole = route.data['requiredRole'] as string | undefined;
    if (requiredRole) {
      const userRole = this.userService.getRoleForProject('rms');
      const roleHierarchy: Record<string, number> = {
        viewer: 1,
        editor: 2,
        admin: 3,
      };
      const required = roleHierarchy[requiredRole] || 0;
      const actual = roleHierarchy[userRole || ''] || 0;
      if (actual < required) {
        this.router.navigate(['home']);
        return false;
      }
    }

    return true;
  }
}

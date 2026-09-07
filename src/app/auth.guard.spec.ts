import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { AuthGuard } from './auth.guard';
import { UserService } from './api/user.service';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let userService: jasmine.SpyObj<UserService>;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    userService = jasmine.createSpyObj<UserService>('UserService', ['isLoggedIn', 'getRoleForProject']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        AuthGuard,
        { provide: UserService, useValue: userService },
        { provide: Router, useValue: router },
      ],
    });
    guard = TestBed.inject(AuthGuard);
  });

  it('should be created', () => {
    expect(guard).toBeTruthy();
  });

  it('allows activation when logged in and no role is required', () => {
    userService.isLoggedIn.and.returnValue(true);
    expect(guard.canActivate({ data: {} } as any)).toBeTrue();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('redirects to login when not logged in', () => {
    userService.isLoggedIn.and.returnValue(false);
    expect(guard.canActivate({ data: {} } as any)).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['login']);
  });

  it('redirects home when the user role is below the required role', () => {
    userService.isLoggedIn.and.returnValue(true);
    userService.getRoleForProject.and.returnValue('viewer');
    expect(guard.canActivate({ data: { requiredRole: 'admin' } } as any)).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['home']);
  });

  it('allows activation when the user role meets the required role', () => {
    userService.isLoggedIn.and.returnValue(true);
    userService.getRoleForProject.and.returnValue('admin');
    expect(guard.canActivate({ data: { requiredRole: 'editor' } } as any)).toBeTrue();
  });
});

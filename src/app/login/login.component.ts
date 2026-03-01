import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { UserService } from '../api/user.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  loginForm: FormGroup;
  errorMessage = '';
  loading = false;
  loggedIn = false;
  showRegister = false;

  constructor(
    private formBuilder: FormBuilder,
    private userService: UserService,
    private router: Router,
  ) {
    this.loginForm = this.formBuilder.group({
      username: ['', [Validators.required]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
    this.loggedIn = this.userService.isLoggedIn();
  }

  get username() { return this.loginForm.controls['username']; }
  get password() { return this.loginForm.controls['password']; }

  login(): void {
    if (this.loginForm.invalid) {
      this.errorMessage = 'Please fill in the fields correctly.';
      return;
    }

    const { username, password } = this.loginForm.value;
    this.loading = true;
    this.errorMessage = '';

    this.userService.login(username, password).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['home']);
      },
      error: () => {
        this.errorMessage = 'Invalid username or password.';
        this.loading = false;
      },
    });
  }

  logout(): void {
    this.userService.logout();
    this.loggedIn = false;
  }
}

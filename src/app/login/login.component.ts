import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { UserService } from '../api/user.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements OnInit {

  loginForm: FormGroup
  errorMessage = ''
  loggedIn = false
  loading = false

  constructor(
    private formBuilder: FormBuilder, 
    private userService: UserService,
    private router: Router,
  ) {
    this.loginForm = this.formBuilder.group({
      username: ['', [Validators.required]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    })
    this.loggedIn = (this.userService.getToken()?.length ?? 0) > 0
  }

  get username() { return this.loginForm.controls['username'] }
  get password() { return this.loginForm.controls['password'] }

  ngOnInit(): void {
    
  }

  showRegister = false

  login(): void {
    if (this.loginForm.invalid) {
      this.errorMessage = 'Please fillin the fields correctly.'
    }

    const { username, password } = this.loginForm.value

    this.loading = true
    this.errorMessage = ''
    this.userService.login(username, password).subscribe({
      next: (response) => {
        this.userService.saveToken(response.token)
        this.loading = false
        this.router.navigate(['home'])
      },
      error: (e) => {
        this.errorMessage = 'Invalid username or password.'
        this.loading = false
      }
    })
  }

  logout(): void {
    this.userService.logout()
    this.loggedIn = false
  }

  register(): void {
    this.showRegister = false
    // TODO: to be implemented
  }
}

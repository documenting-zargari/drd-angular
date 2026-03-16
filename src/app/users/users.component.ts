import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, FormArray, ReactiveFormsModule, Validators } from '@angular/forms';
import { UserService, UserDetail } from '../api/user.service';
import { DataService } from '../api/data.service';

type ViewMode = 'list' | 'edit' | 'create' | 'password';

@Component({
  selector: 'app-users',
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './users.component.html',
  styleUrl: './users.component.scss'
})
export class UsersComponent implements OnInit {
  mode: ViewMode = 'list';
  users: UserDetail[] = [];
  editingUser: UserDetail | null = null;
  isGlobalAdmin = false;
  isAdmin = false;
  isSelfProfile = false;
  currentUserId: number | null = null;
  adminProjects: string[] = [];

  userForm!: FormGroup;
  passwordForm!: FormGroup;

  loading = false;
  message = '';
  errorMessage = '';
  deleteConfirmId: number | null = null;
  validSampleRefs: Set<string> = new Set();
  invalidSamples: string[] = [];

  constructor(
    private userService: UserService,
    private dataService: DataService,
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
  ) {}

  ngOnInit() {
    this.isAdmin = this.userService.isAdmin();
    const info = this.userService.getUserInfo();
    this.isGlobalAdmin = info?.is_global_admin ?? false;
    this.currentUserId = info?.user_id ?? null;
    // Derive which projects the current user is admin of
    if (this.isGlobalAdmin) {
      this.adminProjects = [];
    } else {
      this.adminProjects = (info?.project_roles || [])
        .filter(r => r.role === 'admin')
        .map(r => r.project);
    }

    this.initForms();

    // Load valid sample refs for validation
    this.dataService.getSamples().subscribe({
      next: (samples: any[]) => {
        this.validSampleRefs = new Set(samples.map(s => s.sample_ref));
      },
    });

    this.route.paramMap.subscribe(params => {
      const idParam = params.get('id');
      const url = this.router.url;
      if (url.startsWith('/users/me')) {
        this.isSelfProfile = true;
        this.loadSelfProfile();
      } else if (idParam) {
        this.loadUser(+idParam);
      } else {
        this.mode = 'list';
        this.loadUsers();
      }
    });
  }

  private initForms() {
    this.userForm = this.fb.group({
      username: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      first_name: [''],
      last_name: [''],
      is_global_admin: [false],
      password: [''],
      project_roles: this.fb.array([]),
    });

    this.passwordForm = this.fb.group({
      old_password: ['', Validators.required],
      new_password: ['', [Validators.required, Validators.minLength(6)]],
      confirm_password: ['', Validators.required],
    });
  }

  get projectRoles(): FormArray {
    return this.userForm.get('project_roles') as FormArray;
  }

  /** Can the current user edit the given user? */
  canEdit(user: UserDetail): boolean {
    if (this.isGlobalAdmin) return true;
    // Project admins cannot edit global admins
    if (user.is_global_admin) return false;
    return this.isAdmin;
  }

  /** Can the current user manage roles for this user? */
  get canManageRoles(): boolean {
    return this.isGlobalAdmin || this.adminProjects.length > 0;
  }

  addRole() {
    const defaultProject = this.isGlobalAdmin ? 'rms' : (this.adminProjects[0] || 'rms');
    this.projectRoles.push(this.fb.group({
      project: [defaultProject, Validators.required],
      role: ['editor', Validators.required],
      allowed_samples: [''],
    }));
  }

  removeRole(index: number) {
    this.projectRoles.removeAt(index);
  }

  // --- Load data ---

  loadUsers() {
    this.loading = true;
    this.userService.getUsers().subscribe({
      next: (users) => {
        this.users = users;
        this.loading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load users.';
        this.loading = false;
      },
    });
  }

  loadUser(id: number) {
    this.loading = true;
    this.userService.getUserById(id).subscribe({
      next: (user) => {
        this.editingUser = user;
        this.mode = 'edit';
        this.populateForm(user);
        this.loading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load user.';
        this.loading = false;
      },
    });
  }

  loadSelfProfile() {
    this.loading = true;
    this.userService.getMe().subscribe({
      next: (user) => {
        this.editingUser = user;
        this.mode = 'edit';
        this.populateForm(user);
        this.loading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load profile.';
        this.loading = false;
      },
    });
  }

  private populateForm(user: UserDetail) {
    this.userForm.patchValue({
      username: user.username,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      is_global_admin: user.is_global_admin,
      password: '',
    });
    this.projectRoles.clear();
    // For project admins, only show roles for their projects
    const rolesToShow = this.isGlobalAdmin
      ? user.project_roles
      : user.project_roles.filter(r => this.adminProjects.includes(r.project));
    for (const role of rolesToShow) {
      this.projectRoles.push(this.fb.group({
        project: [role.project, Validators.required],
        role: [role.role, Validators.required],
        allowed_samples: [(role.allowed_samples || []).join(', ')],
      }));
    }
  }

  // --- Actions ---

  startCreate() {
    this.mode = 'create';
    this.editingUser = null;
    this.clearMessages();
    this.userForm.reset({ is_global_admin: false, password: '' });
    this.projectRoles.clear();
    // For project admins, pre-add a role for their project
    if (!this.isGlobalAdmin && this.adminProjects.length > 0) {
      this.addRole();
    }
  }

  startEdit(user: UserDetail) {
    this.router.navigate(['/users', user.id]);
  }

  showPasswordForm() {
    this.mode = 'password';
    this.clearMessages();
    this.passwordForm.reset();
  }

  backToList() {
    if (this.isSelfProfile) {
      this.router.navigate(['/home']);
    } else {
      this.mode = 'list';
      this.editingUser = null;
      this.clearMessages();
      this.router.navigate(['/users']);
      this.loadUsers();
    }
  }

  backToEdit() {
    this.mode = 'edit';
    this.clearMessages();
  }

  saveUser() {
    if (this.userForm.invalid) return;
    this.loading = true;
    this.clearMessages();

    const formValue = this.userForm.value;
    const data: any = {
      username: formValue.username,
      email: formValue.email,
      first_name: formValue.first_name || '',
      last_name: formValue.last_name || '',
    };

    // Only global admins send these fields
    if (this.isGlobalAdmin) {
      data.is_global_admin = formValue.is_global_admin || false;
    }

    // Admins (global or project) send project roles
    if (this.canManageRoles) {
      data.project_roles = (formValue.project_roles || []).map((r: any) => ({
        project: r.project,
        role: r.role,
        allowed_samples: r.allowed_samples
          ? r.allowed_samples.split(',').map((s: string) => s.trim()).filter((s: string) => s)
          : [],
      }));
      // Validate sample refs
      if (this.validSampleRefs.size > 0) {
        const invalid: string[] = [];
        for (const role of data.project_roles) {
          for (const s of role.allowed_samples) {
            if (!this.validSampleRefs.has(s)) {
              invalid.push(s);
            }
          }
        }
        if (invalid.length > 0) {
          this.errorMessage = `Unknown sample(s): ${invalid.join(', ')}`;
          this.invalidSamples = invalid;
          this.loading = false;
          return;
        }
      }
      this.invalidSamples = [];
    }

    if (this.mode === 'create') {
      if (!formValue.password) {
        this.errorMessage = 'Password is required for new users.';
        this.loading = false;
        return;
      }
      data.password = formValue.password;
      this.userService.createUser(data).subscribe({
        next: () => {
          this.message = 'User created successfully.';
          this.loading = false;
          this.backToList();
        },
        error: (err) => {
          this.errorMessage = this.extractError(err);
          this.loading = false;
        },
      });
    } else {
      // Edit mode — global admin can reset another user's password inline
      if (this.isGlobalAdmin && formValue.password && this.editingUser?.id !== this.currentUserId) {
        data.password = formValue.password;
      }
      const id = this.editingUser!.id;
      this.userService.updateUser(id, data).subscribe({
        next: (updated) => {
          this.message = 'User updated successfully.';
          this.editingUser = updated;
          this.loading = false;
          if (id === this.currentUserId) {
            this.userService.refreshUserInfo();
          }
        },
        error: (err) => {
          this.errorMessage = this.extractError(err);
          this.loading = false;
        },
      });
    }
  }

  changePassword() {
    if (this.passwordForm.invalid) return;
    const { old_password, new_password, confirm_password } = this.passwordForm.value;
    if (new_password !== confirm_password) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }
    this.loading = true;
    this.clearMessages();
    this.userService.changePassword(old_password, new_password).subscribe({
      next: () => {
        this.message = 'Password changed successfully.';
        this.loading = false;
        this.backToList();
      },
      error: (err) => {
        this.errorMessage = this.extractError(err);
        this.loading = false;
      },
    });
  }

  confirmDelete(userId: number) {
    this.deleteConfirmId = userId;
  }

  cancelDelete() {
    this.deleteConfirmId = null;
  }

  deleteUser(userId: number) {
    this.loading = true;
    this.clearMessages();
    this.userService.deleteUser(userId).subscribe({
      next: () => {
        this.message = 'User deleted.';
        this.deleteConfirmId = null;
        this.loading = false;
        this.loadUsers();
      },
      error: (err) => {
        this.errorMessage = this.extractError(err);
        this.deleteConfirmId = null;
        this.loading = false;
      },
    });
  }

  private clearMessages() {
    this.message = '';
    this.errorMessage = '';
  }

  private extractError(err: any): string {
    if (err.error) {
      if (typeof err.error === 'string') return err.error;
      if (err.error.error) return err.error.error;
      if (err.error.detail) return err.error.detail;
      const messages: string[] = [];
      for (const key of Object.keys(err.error)) {
        const val = err.error[key];
        messages.push(`${key}: ${Array.isArray(val) ? val.join(', ') : val}`);
      }
      if (messages.length) return messages.join(' | ');
    }
    return 'An error occurred.';
  }
}

import { Component, OnInit } from '@angular/core'
import { UserService } from '../api/user.service'
import { CommonModule } from '@angular/common'
import { ActivatedRoute, RouterModule } from '@angular/router'

@Component({
  selector: 'app-users',
  imports: [CommonModule, RouterModule],
  templateUrl: './users.component.html',
  styleUrl: './users.component.scss'
})
export class UsersComponent implements OnInit {
  users: any[] = []
  user: any = null

    constructor(private usersService: UserService, private route: ActivatedRoute) { }

    ngOnInit() {
      this.route.paramMap.subscribe(params => {
        const userId = params.get('id')
        if (userId) {
          this.usersService.getUserById(userId).subscribe(user => {
            this.user = user
          })
        } else {
          this.usersService.getUsers().subscribe(users => {
            this.users = users
          })
        }
      })
    }
}

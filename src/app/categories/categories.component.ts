import { Component, OnInit } from '@angular/core'
import { DataService } from '../api/data.service'
import { ActivatedRoute, RouterModule } from '@angular/router'
import { CommonModule } from '@angular/common'

@Component({
  selector: 'app-categories',
  imports: [CommonModule, RouterModule,],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss'
})
export class CategoriesComponent implements OnInit {
  categories: any[] = []
  parent: any = null

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
  ) { }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const parentId = params['parent'];
      if (parentId) {
        this.dataService.getChildCategories(parentId).subscribe(categories => {
          this.categories = categories;
        });
      }
      else {
        this.dataService.getCategories().subscribe(categories => {
          this.categories = categories
        })
      }
    });
  }
}

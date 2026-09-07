import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../api/data.service';

/**
 * Browsable Category/ResearchQuestion tree, extracted from the search
 * page's "Choose questions" modal so it can be reused anywhere ids need to
 * be picked without the user having to already know the hierarchy by name.
 *
 * Categories and ResearchQuestions live in the same Categories tree
 * (every ResearchQuestion is mirrored there as a leaf, has_children=false)
 * — selectableType picks which kind of node gets a checkbox.
 */
@Component({
  selector: 'app-hierarchy-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hierarchy-picker.component.html',
})
export class HierarchyPickerComponent implements OnInit, OnChanges {
  /** 'leaf' picks ResearchQuestions; 'branch' picks Categories; 'any' picks both at once. */
  @Input() selectableType: 'leaf' | 'branch' | 'any' = 'leaf';
  @Input() selectedIds: number[] = [];
  @Output() selectionChange = new EventEmitter<any[]>();

  categories: any[] = [];
  expandedCategories: Set<number> = new Set();
  loadingCategories: Set<number> = new Set();
  selectedNodes: Map<number, any> = new Map();

  constructor(private dataService: DataService) {}

  ngOnInit(): void {
    this.dataService.getCategories().subscribe(categories => {
      this.categories = this.initializeCategoriesHierarchy(categories);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedIds']) {
      const wanted = new Set(this.selectedIds ?? []);
      for (const id of [...this.selectedNodes.keys()]) {
        if (!wanted.has(id)) this.selectedNodes.delete(id);
      }
      const missing = [...wanted].filter(id => !this.selectedNodes.has(id));
      for (const id of missing) {
        this.dataService.getCategoryById(id).subscribe(node => {
          if (node) this.selectedNodes.set(Number(node.id), node);
        });
      }
    }
  }

  private initializeCategoriesHierarchy(categories: any[]): any[] {
    return categories.map(category => ({ ...category, children: [], level: category.level || 0 }));
  }

  isSelectable(category: any): boolean {
    // is_leaf marks a node as a genuine, answerable ResearchQuestion — not
    // the same as "no children": a question can have its own has_children
    // sub-fields (e.g. RQ 136 "andre" has children 137/138/139 for
    // articled_form/base_form/meaning) while still being the correct thing
    // to link a phrase to. Category (branch) nodes never carry is_leaf.
    if (this.selectableType === 'any') {
      return !!category.is_leaf || (!!category.has_children && !category.is_leaf);
    }
    return this.selectableType === 'leaf' ? !!category.is_leaf : !!category.has_children && !category.is_leaf;
  }

  isSelected(category: any): boolean {
    return this.selectedNodes.has(Number(category.id));
  }

  isCategoryExpanded(category: any): boolean {
    return this.expandedCategories.has(category.id);
  }

  isCategoryLoading(category: any): boolean {
    return this.loadingCategories.has(category.id);
  }

  expandCategory(category: any): void {
    if (this.expandedCategories.has(category.id)) {
      this.expandedCategories.delete(category.id);
      this.collapseCategory(category);
    } else {
      this.expandedCategories.add(category.id);
      if (!category.children || category.children.length === 0) {
        this.loadChildCategories(category);
      }
    }
  }

  private collapseCategory(category: any): void {
    if (category.children) {
      category.children.forEach((child: any) => {
        if (this.expandedCategories.has(child.id)) {
          this.expandedCategories.delete(child.id);
          this.collapseCategory(child);
        }
      });
    }
  }

  private loadChildCategories(category: any): void {
    if (this.loadingCategories.has(category.id) || !category.has_children) return;
    this.loadingCategories.add(category.id);
    this.dataService.getChildCategories(category.id).subscribe({
      next: (children) => {
        category.children = this.initializeCategoriesHierarchy(children);
        this.loadingCategories.delete(category.id);
      },
      error: (error) => {
        console.error('Error loading child categories:', error);
        this.loadingCategories.delete(category.id);
      }
    });
  }

  getFlattenedCategories(categories: any[] = this.categories, level: number = 0): any[] {
    const result: any[] = [];
    for (const category of categories) {
      category.level = level;
      result.push(category);
      if (this.isCategoryExpanded(category) && category.children && category.children.length > 0) {
        result.push(...this.getFlattenedCategories(category.children, level + 1));
      }
    }
    return result;
  }

  toggle(category: any): void {
    const id = Number(category.id);
    if (this.selectedNodes.has(id)) {
      this.selectedNodes.delete(id);
    } else {
      this.selectedNodes.set(id, category);
    }
    this.selectionChange.emit([...this.selectedNodes.values()]);
  }
}

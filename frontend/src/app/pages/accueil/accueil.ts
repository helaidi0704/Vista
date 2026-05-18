import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-accueil',
  standalone: true,
  imports: [],
  templateUrl: './accueil.html',
  styleUrls: ['./accueil.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccueilComponent {
  private router = inject(Router);

  navigateTo(page: string): void {
    this.router.navigate([page]);
  }

  onMouseEnter(event: MouseEvent, color: string): void {
    const element = event.currentTarget as HTMLElement;
    element.style.borderColor = color + '40';
    element.style.transform = 'translateY(-3px)';
  }

  onMouseLeave(event: MouseEvent): void {
    const element = event.currentTarget as HTMLElement;
    element.style.borderColor = 'transparent';
    element.style.transform = 'translateY(0)';
  }
}
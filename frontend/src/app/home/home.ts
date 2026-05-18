import { AfterViewInit, Component, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AccueilComponent } from '../pages/accueil/accueil';
import { AnnotationComponent } from '../pages/annotation/annotation';
import { AnalyzeComponent } from '../pages/analyze/analyze';
import { TrainingComponent } from '../pages/training/training';
import { TestingComponent } from '../pages/testing/testing';
import { DeploymentComponent } from '../pages/deployment/deployment';

@Component({
  selector: 'app-home',
  imports: [RouterModule, CommonModule, AccueilComponent, AnnotationComponent, AnalyzeComponent, TrainingComponent, TestingComponent, DeploymentComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
   zoom = 100;

  currentPage = signal('accueil');

  setPage(page: string) {
    this.currentPage.set(page);
  }

}

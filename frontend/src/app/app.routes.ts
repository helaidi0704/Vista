import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./home/home').then(m => m.Home),
  },
  {
    path: 'accueil',
    loadComponent: () => import('./pages/accueil/accueil').then(m => m.AccueilComponent),
  },
  {
    path: 'annotation',
    loadComponent: () => import('./pages/annotation/annotation').then(m => m.AnnotationComponent),
  },
  {
    path: 'analyze',
    loadComponent: () => import('./pages/analyze/analyze').then(m => m.AnalyzeComponent),
  },
  {
    path: 'training',
    loadComponent: () => import('./pages/training/training').then(m => m.TrainingComponent),
  },
  {
    path: 'testing',
    loadComponent: () => import('./pages/testing/testing').then(m => m.TestingComponent),
  },
  {
    path: 'deployment',
    loadComponent: () => import('./pages/deployment/deployment').then(m => m.DeploymentComponent),
  },
];

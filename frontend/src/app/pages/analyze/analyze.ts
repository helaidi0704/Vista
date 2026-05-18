import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, QueryList, ViewChild, ViewChildren, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface AnalyzeFile {
  name: string;
  tag: string;
  cls: string;
}

interface AugPreview {
  title: string;
  filter: string;
}

@Component({
  selector: 'app-analyze',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './analyze.html',
  styleUrls: ['./analyze.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyzeComponent implements AfterViewInit {
  @ViewChild('imgTargetCanvas', { static: true }) imgTargetCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('imgRefCanvas', { static: true }) imgRefCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChildren('augPreviewCanvas') augPreviewCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  imageFiles: AnalyzeFile[] = [
    { name: 'carter_moteur_082.jpg', tag: 'Défaut: Rayure', cls: 'tag-red' },
    { name: 'ref_template_gold.jpg', tag: 'Golden Reference', cls: 'tag-green' },
  ];

  analysisTabs = [
    'Comparaison Côte à Côte',
    'Superposition (DIfference)',
    'Analyse Spectrale (FFT)',
    'Data Augmentation Test',
    'Extraction Contours (Sobel/Canny)',
  ];

  activeTab = signal(this.analysisTabs[0]);

  augmentationPreviews: AugPreview[] = [
    { title: 'Origine', filter: '' },
    { title: 'Crop + Rot 12°', filter: 'brightness(90%)' },
    { title: 'Mixup avec BG_1', filter: 'contrast(120%)' },
    { title: 'Crop + Rot -5°', filter: 'hue-rotate(10deg)' },
  ];

  ngAfterViewInit() {
    setTimeout(() => {
      this.drawAllCanvases();
    }, 100);
  }

  switchAnalysisTab(tab: string) {
    this.activeTab.set(tab);
  }

  private drawAllCanvases() {
    this.drawFakeImageContent(this.imgTargetCanvas.nativeElement, true);
    this.drawFakeImageContent(this.imgRefCanvas.nativeElement, false);
    this.augPreviewCanvases.forEach((canvasRef, index) => {
      this.drawFakeImageContent(canvasRef.nativeElement, index === 0 ? true : false);
    });
  }

  private drawFakeImageContent(canvas: HTMLCanvasElement, hasDefect: boolean) {
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }

    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#2A2C3A';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#555A7A';
    ctx.lineWidth = Math.max(2, Math.min(W, H) * 0.03);
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#44485D';
    ctx.beginPath();
    ctx.arc(W / 2 - 20, H / 2 - 20, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W / 2 + 20, H / 2 + 20, 10, 0, Math.PI * 2);
    ctx.fill();

    if (hasDefect) {
      ctx.strokeStyle = '#8B91B5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(W / 2 + 10, H / 2 - 40);
      ctx.lineTo(W / 2 + 35, H / 2 - 15);
      ctx.stroke();
    }
  }
}

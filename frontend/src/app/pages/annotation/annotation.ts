import { Component, AfterViewInit, signal, ElementRef, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-annotation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './annotation.html',
  styleUrl: './annotation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnnotationComponent implements AfterViewInit {
  @ViewChild('imageCanvas', { static: true }) imageCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawCanvas', { static: true }) drawCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput', { static: true }) fileInput!: ElementRef<HTMLInputElement>;

  zoom = signal(100);
  currentTool = signal('rect');
  selectedSeverity = signal('Mineur');
  annotationType = signal('Rayure profonde');
  annotationDesc = signal('Rayure profonde orientée à 45° sur la zone d\'épaulement droite.');
  imageFileName = signal('carter_moteur_082.jpg');
  imageFileMeta = signal('RGB · 1920x1080 · 2.4 MB');

  imageAnnotations = signal([
    { id: 1, type: 'bbox', shape: '🟥 BBox', def: 'Rayure profonde', sev: 'Critique', scls: 'tag-red', desc: "Rayure importante sur la surface principale.", coords: { nx: 0.45, ny: 0.35, nw: 0.15, nh: 0.30 } },
    { id: 2, type: 'poly', shape: '〰️ Tracé libre', def: 'Fissure', sev: 'Majeur', scls: 'tag-orange', desc: "Micro-fissure en périphérie (zone B).", coords: { points: [{ nx: 0.38, ny: 0.35 }, { nx: 0.42, ny: 0.45 }, { nx: 0.40, ny: 0.55 }] } },
  ]);

  hoveredAnnotId = signal<number | null>(null);

  ngAfterViewInit() {
    setTimeout(() => {
      this.loadDefaultImage();
      this.setupDrawingInteraction();
      this.renderAnnotations();
    }, 100);
  }

  setTool(tool: string) {
    this.currentTool.set(tool);
    // Update cursor
    const container = document.getElementById('image-container');
    if (container) {
      if (tool === 'pan') container.style.cursor = 'grab';
      if (tool === 'rect') container.style.cursor = 'crosshair';
      if (tool === 'draw') container.style.cursor = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%236C63FF' stroke-width='2'><circle cx='8' cy='8' r='4'/></svg>") 8 8, auto`;
    }
  }

  setSeverity(severity: string) {
    this.selectedSeverity.set(severity);
  }

  hoverAnnotation(id: number, isEnter: boolean) {
    this.hoveredAnnotId.set(isEnter ? id : null);
    this.drawAnnotationsOnly();
  }

  saveAnnotation() {
    const newAnnot = {
      id: Date.now(),
      type: Math.random() > 0.5 ? 'bbox' : 'poly',
      shape: Math.random() > 0.5 ? '🟥 BBox' : '〰️ Tracé libre',
      def: this.annotationType(),
      sev: this.selectedSeverity(),
      scls: this.selectedSeverity() === 'Critique' ? 'tag-red' : this.selectedSeverity() === 'Majeur' ? 'tag-orange' : 'tag-cyan',
      desc: this.annotationDesc(),
      coords: { nx: 0.1 + Math.random() * 0.8, ny: 0.1 + Math.random() * 0.8, nw: 0.1, nh: 0.1 }
    };

    this.imageAnnotations.update(annots => [...annots, newAnnot]);
    this.renderAnnotations();
    this.drawAnnotationsOnly();
    this.annotationDesc.set('');
  }

  deleteAnnotation(id: number) {
    this.imageAnnotations.update(annots => annots.filter(a => a.id !== id));
    if (this.hoveredAnnotId() === id) this.hoveredAnnotId.set(null);
    this.renderAnnotations();
    this.drawAnnotationsOnly();
  }

  openImagePicker() {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.loadImageFile(file);
    input.value = '';
  }

  private loadImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        this.loadedImageObj = img;
        this.imageFileName.set(file.name);
        this.imageFileMeta.set(`${file.type.replace('image/', '').toUpperCase() || 'IMG'} · ${img.width}x${img.height} · ${this.formatBytes(file.size)}`);
        this.drawBaseImage();
        this.drawAnnotationsOnly();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  private formatBytes(bytes: number) {
    const kb = 1024;
    const mb = kb * 1024;
    if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
    if (bytes >= kb) return `${(bytes / kb).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  private loadedImageObj: HTMLImageElement | null = null;
  private imageRenderRect = { x: 0, y: 0, w: 0, h: 0 };

  private loadDefaultImage() {
    const img = new Image();
    img.src = '/assets/carter_moteur.png';
    img.onload = () => {
      this.loadedImageObj = img;
      this.imageFileName.set('carter_moteur_082.jpg');
      this.imageFileMeta.set(`RGB · ${img.width}x${img.height}`);
      this.drawBaseImage();
      this.drawAnnotationsOnly();
    };
    console.log('Loading default image...'+img);
    img.onerror = () => {
      console.warn('Default image not found. Ready for user import.');
    };
  }

  private drawBaseImage() {
    const container = document.getElementById('image-container');
    const imgCanvas = this.imageCanvas.nativeElement;
    if (!container || !imgCanvas || !this.loadedImageObj) return;

    const W = container.clientWidth;
    const H = container.clientHeight;
    imgCanvas.width = W;
    imgCanvas.height = H;

    const drawCanvas = this.drawCanvas.nativeElement;
    drawCanvas.width = W;
    drawCanvas.height = H;

    const ctx = imgCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    const imgRatio = this.loadedImageObj.width / this.loadedImageObj.height;
    const cvRatio = W / H;

    let drawW = W, drawH = H;
    if (imgRatio > cvRatio) {
      drawH = W / imgRatio;
    } else {
      drawW = H * imgRatio;
    }
    this.imageRenderRect = {
      x: (W - drawW) / 2,
      y: (H - drawH) / 2,
      w: drawW,
      h: drawH
    };

    ctx.drawImage(this.loadedImageObj, this.imageRenderRect.x, this.imageRenderRect.y, this.imageRenderRect.w, this.imageRenderRect.h);
  }

  private drawAnnotationsOnly() {
    const drawCanvas = this.drawCanvas.nativeElement;
    if (!drawCanvas) return;
    const dtx = drawCanvas.getContext('2d')!;
    dtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

    if (this.imageRenderRect.w === 0) return;

    const ix = this.imageRenderRect.x, iy = this.imageRenderRect.y, iw = this.imageRenderRect.w, ih = this.imageRenderRect.h;

    this.imageAnnotations().forEach(ann => {
      const isHovered = (ann.id === this.hoveredAnnotId());

      let colorMain = '#00C7BE';
      let colorFill = 'rgba(0,199,190,0.15)';
      if (ann.scls === 'tag-red') { colorMain = '#FF453A'; colorFill = 'rgba(255, 69, 58, 0.2)'; }
      if (ann.scls === 'tag-orange') { colorMain = '#FFD60A'; colorFill = 'rgba(255, 214, 10, 0.2)'; }

      if (isHovered) {
        dtx.shadowColor = colorMain;
        dtx.shadowBlur = 10;
        colorFill = colorFill.replace('0.2)', '0.4)').replace('0.15)', '0.3)');
      } else {
        dtx.shadowBlur = 0;
      }

      dtx.lineWidth = isHovered ? 3 : 2;
      dtx.strokeStyle = colorMain;

      if (ann.type === 'bbox' && ann.coords.nw) {
        const rx = ix + (ann.coords as any).nx * iw;
        const ry = iy + (ann.coords as any).ny * ih;
        const rw = (ann.coords as any).nw * iw;
        const rh = (ann.coords as any).nh * ih;

        dtx.strokeRect(rx, ry, rw, rh);
        dtx.fillStyle = colorFill;
        dtx.fillRect(rx, ry, rw, rh);

        dtx.shadowBlur = 0;
        dtx.fillStyle = colorMain;
        const txt = ann.def;
        const tw = dtx.measureText(txt).width + 8;
        dtx.fillRect(rx, ry - 16, tw, 16);
        dtx.fillStyle = '#121316';
        dtx.font = 'bold 10px Inter, sans-serif';
        dtx.fillText(txt, rx + 4, ry - 4);
      }
      else if (ann.type === 'poly' && (ann.coords as any).points) {
        dtx.beginPath();
        (ann.coords as any).points.forEach((pt: any, idx: number) => {
          const px = ix + pt.nx * iw;
          const py = iy + pt.ny * ih;
          if (idx === 0) dtx.moveTo(px, py);
          else dtx.lineTo(px, py);
        });
        dtx.closePath();
        dtx.stroke();
        dtx.fillStyle = colorFill;
        dtx.fill();
      }
    });

    dtx.shadowBlur = 0;
  }

  private renderAnnotations() {
    // This will be handled in the template with *ngFor
  }

  private setupDrawingInteraction() {
    // Placeholder for drawing interaction
  }
}
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type Tool = 'pan' | 'rect' | 'polygon' | 'freehand';

type SeverityUi = 'Critique' | 'Majeur' | 'Mineur';

interface NormPoint {
  nx: number;
  ny: number;
}

interface BBox {
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

interface PolygonData {
  points: NormPoint[];
  closed: true;
}

interface FreehandData {
  points: NormPoint[];
  closed: false;
}

type Geometry =
  | { type: 'bbox'; data: BBox }
  | { type: 'polygon'; data: PolygonData }
  | { type: 'freehand'; data: FreehandData };

interface AnnotationMeta {
  def: string;
  sev: SeverityUi;
  scls: 'tag-red' | 'tag-orange' | 'tag-cyan';
  desc: string;
  shape: string;
}

interface AnnotationItem extends AnnotationMeta {
  id: number;
  geometry: Geometry;
}

interface DraftShape {
  id: string;
  meta: AnnotationMeta;
  geometry: Geometry;
}

@Component({
  selector: 'app-annotation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './annotation.html',
  styleUrl: './annotation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnnotationComponent implements AfterViewInit, OnDestroy {
  @ViewChild('imageCanvas', { static: true }) imageCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawCanvas', { static: true }) drawCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput', { static: true }) fileInput!: ElementRef<HTMLInputElement>;

  readonly defectOptions = [
    'Rayure profonde',
    'Fissure (micro)',
    'Décoloration / Tâche',
    "Défaut d'usinage (Bavure)",
    'Pièce manquante',
  ] as const;

  zoom = signal(100);
  currentTool = signal<Tool>('rect');

  private getZoomScale(): number {
    return Math.max(0.1, this.zoom() / 100);
  }

  selectedSeverity = signal<SeverityUi>('Mineur');
  annotationType = signal('Rayure profonde');
  annotationDesc = signal("Rayure profonde orientée à 45° sur la zone d'épaulement droite.");

  imageFileName = signal('carter_moteur_082.jpg');
  imageFileMeta = signal('RGB · 1920x1080 · 2.4 MB');

  imageAnnotations = signal<AnnotationItem[]>([
    {
      id: 1,
      shape: '🟥 BBox',
      def: 'Rayure profonde',
      sev: 'Critique',
      scls: 'tag-red',
      desc: 'Rayure importante sur la surface principale.',
      geometry: { type: 'bbox', data: { nx: 0.45, ny: 0.35, nw: 0.15, nh: 0.3 } },
    },
    {
      id: 2,
      shape: '🔷 Polygon',
      def: 'Fissure',
      sev: 'Majeur',
      scls: 'tag-orange',
      desc: 'Micro-fissure en périphérie (zone B).',
      geometry: {
        type: 'polygon',
        data: {
          points: [
            { nx: 0.38, ny: 0.35 },
            { nx: 0.42, ny: 0.45 },
            { nx: 0.4, ny: 0.55 },
          ],
          closed: true,
        },
      },
    },
  ]);

  hoveredAnnotId = signal<number | null>(null);

  private draftShapes: DraftShape[] = [];
  private draftRectCurrent: { start: NormPoint; end: NormPoint; dragging: boolean } | null = null;
  private draftPolygonCurrent: { points: NormPoint[]; closed: boolean } = { points: [], closed: false };
  private polygonPreview: NormPoint | null = null;
  private panOffset = signal({ x: 0, y: 0 });
  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private panStartOffset = { x: 0, y: 0 };
  private draftFreehandCurrent: { points: NormPoint[]; drawing: boolean } = { points: [], drawing: false };

  private loadedImageObj: HTMLImageElement | null = null;
  private imageRenderRect = { x: 0, y: 0, w: 0, h: 0 };

  private readonly CLOSE_TOL_PX = 14;
  private nextAnnotationId = 3;
  private nextDraftId = 1;

  private onPointerDownRef?: (e: PointerEvent) => void;
  private onPointerMoveRef?: (e: PointerEvent) => void;
  private onPointerUpRef?: (e: PointerEvent) => void;
  private undoStack: any[] = [];
  private redoStack: any[] = [];
  private onWheelZoom = (e: WheelEvent): void => {
    if (this.imageRenderRect.w === 0) return;

    e.preventDefault();

    const delta = -e.deltaY;
    const current = this.zoom();

    const factor = delta > 0 ? 1.1 : 0.9;
    let next = current * factor;
    next = Math.round(Math.max(20, Math.min(1200, next)));

    if (next === current) return;

    const canvasPos = this.pointerToCanvasPosition(e);

    const ix = this.imageRenderRect.x;
    const iy = this.imageRenderRect.y;
    const iw = this.imageRenderRect.w;
    const ih = this.imageRenderRect.h;

    const nx = (canvasPos.x - ix) / iw;
    const ny = (canvasPos.y - iy) / ih;

    this.zoom.set(next);

    // Recompute image with new zoom
    this.drawBaseImage();

    // Adjust panOffset so that cursor stays on same image point
    const targetX = canvasPos.x - nx * this.imageRenderRect.w;
    const targetY = canvasPos.y - ny * this.imageRenderRect.h;

    const pan = this.panOffset();
    this.panOffset.set({ x: pan.x + (targetX - this.imageRenderRect.x), y: pan.y + (targetY - this.imageRenderRect.y) });

    this.drawBaseImage();
    this.drawAnnotationsOnly();
  };

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.loadDefaultImage();
      this.setupDrawingInteraction();
      this.drawBaseImage();
      this.drawAnnotationsOnly();
    }, 50);
  }

  ngOnDestroy(): void {
    const canvas = this.drawCanvas?.nativeElement;
    if (!canvas) return;

    if (this.onPointerDownRef) canvas.removeEventListener('pointerdown', this.onPointerDownRef);
    if (this.onPointerMoveRef) canvas.removeEventListener('pointermove', this.onPointerMoveRef);
    if (this.onPointerUpRef) canvas.removeEventListener('pointerup', this.onPointerUpRef);
    canvas.removeEventListener('wheel', this.onWheelZoom);
  }

  setTool(tool: Tool): void {
    this.currentTool.set(tool);
    this.polygonPreview = null;
    this.drawAnnotationsOnly();
  }

  setSeverity(severity: SeverityUi): void {
    this.selectedSeverity.set(severity);
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();

    // Undo (Ctrl+Z or Cmd+Z)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
      e.preventDefault();
      e.stopPropagation();
      this.undo();
      return;
    }

    // Redo (Ctrl+Y OR Ctrl+Shift+Z)
    if (
      (e.ctrlKey || e.metaKey) &&
      (key === 'y' || (key === 'z' && e.shiftKey))
    ) {
      e.preventDefault();
      e.stopPropagation();
      this.redo();
      return;
    }
  }

  hoverAnnotation(id: number, isEnter: boolean): void {
    this.hoveredAnnotId.set(isEnter ? id : null);
    this.drawAnnotationsOnly();
  }

  deleteAnnotation(id: number): void {
    this.imageAnnotations.update((annots) => annots.filter((annot) => annot.id !== id));
    if (this.hoveredAnnotId() === id) this.hoveredAnnotId.set(null);
    this.drawAnnotationsOnly();
  }

  resetDrafts(): void {
    this.pushHistory();
    this.draftShapes = [];
    this.draftRectCurrent = null;
    this.draftPolygonCurrent = { points: [], closed: false };
    this.polygonPreview = null;
    this.draftFreehandCurrent = { points: [], drawing: false };
    this.drawAnnotationsOnly();
  }

  saveAnnotation(): void {
    if (this.draftShapes.length === 0) {
      if (this.hasInProgressShape()) {
        this.resetDrafts();
        alert("Aucun draft finalisé à enregistrer. Le dessin en cours a été réinitialisé.");
        return;
      }

      alert("Aucune forme à enregistrer. Dessine une BBox, un Polygon ou un tracé libre d'abord.");
      return;
    }

    const startId = this.nextAnnotationId;
    const committed: AnnotationItem[] = this.draftShapes.map((draft, index) => ({
      id: startId + index,
      ...draft.meta,
      geometry: draft.geometry,
    }));

    this.nextAnnotationId += committed.length;
    this.imageAnnotations.update((prev) => [...prev, ...committed]);
    this.resetDrafts();
  }

  openImagePicker(): void {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.loadImageFile(file);
    input.value = '';
  }

  updateAnnotationType(value: string): void {
    this.annotationType.set(value);
  }

  updateAnnotationDesc(value: string): void {
    this.annotationDesc.set(value);
  }

  updateZoom(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    let next = Number.isFinite(value) ? value : 100;

    next = Math.round(Math.max(20, Math.min(1200, next)));

    this.zoom.set(next);

    // auto switch to pan tool
    this.currentTool.set('pan');

    this.drawBaseImage();
    this.drawAnnotationsOnly();
  }

  resetZoom(): void {
    this.zoom.set(100);
    this.drawBaseImage();
    this.drawAnnotationsOnly();
  }

  private snapshotState(): any {
    return {
      draftShapes: JSON.parse(JSON.stringify(this.draftShapes)),
      draftPolygonCurrent: JSON.parse(JSON.stringify(this.draftPolygonCurrent)),
      draftFreehandCurrent: JSON.parse(JSON.stringify(this.draftFreehandCurrent)),
    };
  }

  private restoreState(state: any): void {
    this.draftShapes = state.draftShapes;
    this.draftPolygonCurrent = state.draftPolygonCurrent;
    this.draftFreehandCurrent = state.draftFreehandCurrent;

    this.drawAnnotationsOnly();
  }

  private pushHistory(): void {
    this.undoStack.push(this.snapshotState());
    this.redoStack = [];
  }

  undo(): void {
    if (this.undoStack.length === 0) return;

    const current = this.snapshotState();
    this.redoStack.push(current);

    const prev = this.undoStack.pop();
    this.restoreState(prev);
  }

  redo(): void {
    if (this.redoStack.length === 0) return;

    const current = this.snapshotState();
    this.undoStack.push(current);

    const next = this.redoStack.pop();
    this.restoreState(next);
  }

  currentToolLabel(): string {
    switch (this.currentTool()) {
      case 'pan':
        return 'Navigation';
      case 'rect':
        return 'BBox';
      case 'polygon':
        return 'Polygon';
      case 'freehand':
        return 'Tracé libre';
    }
  }

  currentLayerLabel(): string {
    if (this.draftRectCurrent?.dragging) return 'Preview BBox';
    if (this.draftPolygonCurrent.points.length > 0) return `Polygon (${this.draftPolygonCurrent.points.length} points)`;
    if (this.draftFreehandCurrent.drawing) return `Tracé libre (${this.draftFreehandCurrent.points.length} points)`;
    if (this.draftShapes.length > 0) return `${this.draftShapes.length} draft(s) en attente`;
    return 'Aucun draft actif';
  }

  draftCount(): number {
    return this.draftShapes.length;
  }

  hasInProgressShape(): boolean {
    return !!this.draftRectCurrent?.dragging || this.draftPolygonCurrent.points.length > 0 || this.draftFreehandCurrent.drawing;
  }

  cursorStyle(): string {
    if (this.currentTool() === 'pan') return this.isPanning ? 'grabbing' : 'grab';

    switch (this.currentTool()) {
      case 'rect':
      case 'polygon':
        return 'crosshair';
      case 'freehand':
        return 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' fill=\'none\' stroke=\'%23E06C00\' stroke-width=\'2\'><circle cx=\'8\' cy=\'8\' r=\'4\'/></svg>") 8 8, auto';
      default:
        return 'crosshair';
    }
  }

  trackAnnotationById(_index: number, ann: AnnotationItem): number {
    return ann.id;
  }

  @HostListener('window:resize')
  onResize(): void {
    this.drawBaseImage();
    this.drawAnnotationsOnly();
  }

  private loadImageFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        this.loadedImageObj = img;
        this.imageFileName.set(file.name);
        this.imageFileMeta.set(`${this.fileTypeLabel(file.type)} · ${img.width}x${img.height} · ${this.formatBytes(file.size)}`);
        this.drawBaseImage();
        this.drawAnnotationsOnly();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  private fileTypeLabel(mime: string): string {
    const short = mime.replace('image/', '').toUpperCase();
    return short || 'IMG';
  }

  private formatBytes(bytes: number): string {
    const kb = 1024;
    const mb = kb * 1024;
    if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
    if (bytes >= kb) return `${(bytes / kb).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  private loadDefaultImage(): void {
    const img = new Image();
    img.src = '/assets/carter_moteur.png';
    img.onload = () => {
      this.loadedImageObj = img;
      this.imageFileName.set('carter_moteur_082.jpg');
      this.imageFileMeta.set(`RGB · ${img.width}x${img.height}`);
      this.drawBaseImage();
      this.drawAnnotationsOnly();
    };
    img.onerror = () => {
      this.drawBaseImage();
      this.drawAnnotationsOnly();
    };
  }

  private drawBaseImage(): void {
    const container = document.getElementById('image-container');
    if (!container) return;

    const imgCanvas = this.imageCanvas.nativeElement;
    const drawCanvas = this.drawCanvas.nativeElement;

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    imgCanvas.width = width;
    imgCanvas.height = height;
    drawCanvas.width = width;
    drawCanvas.height = height;

    const ctx = imgCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (!this.loadedImageObj) {
      // Fallback: no image loaded yet -> allow drawing on the full canvas surface
      ctx.fillStyle = '#0D0E1A';
      ctx.fillRect(0, 0, width, height);
      this.imageRenderRect = { x: 0, y: 0, w: width, h: height };
      return;
    }

    const imgRatio = this.loadedImageObj.width / this.loadedImageObj.height;
    const cvRatio = width / height;

    let drawWidth = width;
    let drawHeight = height;
    if (imgRatio > cvRatio) drawHeight = width / imgRatio;
    else drawWidth = height * imgRatio;

    // Apply zoom around center
    const scale = this.getZoomScale();
    drawWidth *= scale;
    drawHeight *= scale;

    const baseX = (width - drawWidth) / 2;
    const baseY = (height - drawHeight) / 2;
    const pan = this.panOffset();
    let nextPanX = pan.x;
    let nextPanY = pan.y;
    let x = baseX + nextPanX;
    let y = baseY + nextPanY;

    // clamp X
    if (drawWidth <= width) {
      x = baseX;
      nextPanX = 0;
    } else {
      const minX = width - drawWidth;
      const maxX = 0;
      x = Math.min(maxX, Math.max(minX, x));
      nextPanX = x - baseX;
    }

    // clamp Y
    if (drawHeight <= height) {
      y = baseY;
      nextPanY = 0;
    } else {
      const minY = height - drawHeight;
      const maxY = 0;
      y = Math.min(maxY, Math.max(minY, y));
      nextPanY = y - baseY;
    }

    if (nextPanX !== pan.x || nextPanY !== pan.y) {
      this.panOffset.set({ x: nextPanX, y: nextPanY });
    }

    this.imageRenderRect = {
      x,
      y,
      w: drawWidth,
      h: drawHeight,
    };

    ctx.drawImage(
      this.loadedImageObj,
      this.imageRenderRect.x,
      this.imageRenderRect.y,
      this.imageRenderRect.w,
      this.imageRenderRect.h
    );
  }

  private setupDrawingInteraction(): void {
    const canvas = this.drawCanvas.nativeElement;
    canvas.style.touchAction = 'none';

    if (this.onPointerDownRef) canvas.removeEventListener('pointerdown', this.onPointerDownRef);
    if (this.onPointerMoveRef) canvas.removeEventListener('pointermove', this.onPointerMoveRef);
    if (this.onPointerUpRef) canvas.removeEventListener('pointerup', this.onPointerUpRef);
    canvas.removeEventListener('wheel', this.onWheelZoom);

    this.onPointerDownRef = (e: PointerEvent) => this.onPointerDown(e);
    this.onPointerMoveRef = (e: PointerEvent) => this.onPointerMove(e);
    this.onPointerUpRef = (e: PointerEvent) => this.onPointerUp(e);

    canvas.addEventListener('pointerdown', this.onPointerDownRef);
    canvas.addEventListener('pointermove', this.onPointerMoveRef);
    canvas.addEventListener('pointerup', this.onPointerUpRef);
    canvas.addEventListener('wheel', this.onWheelZoom, { passive: false });
  }

  private onPointerDown(e: PointerEvent): void {
    const tool = this.currentTool();

    if (tool === 'pan') {
      // allow panning only if renderRect exists
      if (this.imageRenderRect.w === 0) this.drawBaseImage();

      const p = this.pointerToCanvasPosition(e);
      this.isPanning = true;
      this.panStart = { x: p.x, y: p.y };
      const off = this.panOffset();
      this.panStartOffset = { x: off.x, y: off.y };
      this.drawCanvas.nativeElement.setPointerCapture?.(e.pointerId);
      // cursor will update via binding, and we redraw to be safe
      this.drawBaseImage();
      this.drawAnnotationsOnly();
      return;
    }

    if (this.imageRenderRect.w === 0) this.drawBaseImage();

    const point = this.pixelToNorm(e);
    if (!point) return;

    this.drawCanvas.nativeElement.setPointerCapture?.(e.pointerId);

    if (tool === 'rect') {
      this.draftRectCurrent = { start: point, end: point, dragging: true };
      this.drawAnnotationsOnly();
      return;
    }

    if (tool === 'polygon') {
      if (this.draftPolygonCurrent.closed) return;

      if (this.draftPolygonCurrent.points.length >= 3) {
        const first = this.draftPolygonCurrent.points[0];
        const firstPx = this.normToPixel(first);
        const canvasPoint = this.pointerToCanvasPosition(e);
        const dist = Math.hypot(canvasPoint.x - firstPx.x, canvasPoint.y - firstPx.y);

        if (dist <= this.CLOSE_TOL_PX) {
          const meta = this.snapshotMeta('polygon');
          const geometry: Geometry = {
            type: 'polygon',
            data: { points: this.draftPolygonCurrent.points.slice(), closed: true },
          };
          this.pushHistory();
          this.draftShapes.push({ id: this.createDraftId('poly'), meta, geometry });
          this.draftPolygonCurrent = { points: [], closed: false };
          this.polygonPreview = null;
          this.drawAnnotationsOnly();
          return;
        }
      }

      this.pushHistory();
      this.draftPolygonCurrent.points.push(point);
      this.drawAnnotationsOnly();
      return;
    }

    this.pushHistory();
    this.draftFreehandCurrent = { points: [point], drawing: true };
    this.drawAnnotationsOnly();
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.imageRenderRect.w === 0) return;

    if (this.currentTool() === 'pan' && this.isPanning) {
      const p = this.pointerToCanvasPosition(e);
      const dx = p.x - this.panStart.x;
      const dy = p.y - this.panStart.y;
      this.panOffset.set({ x: this.panStartOffset.x + dx, y: this.panStartOffset.y + dy });
      this.drawBaseImage();
      this.drawAnnotationsOnly();
      return;
    }

    const tool = this.currentTool();
    const point = this.pixelToNorm(e);

    if (tool === 'rect' && this.draftRectCurrent?.dragging && point) {
      this.draftRectCurrent.end = point;
      this.drawAnnotationsOnly();
      return;
    }

    if (tool === 'polygon') {
      this.polygonPreview = point ? { nx: point.nx, ny: point.ny } : null;
      if (this.draftPolygonCurrent.points.length > 0) this.drawAnnotationsOnly();
      return;
    }

    if (tool === 'freehand' && this.draftFreehandCurrent.drawing && point) {
      this.draftFreehandCurrent.points.push(point);
      if (this.draftFreehandCurrent.points.length > 3000) this.draftFreehandCurrent.points.shift();
      this.drawAnnotationsOnly();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.drawCanvas.nativeElement.releasePointerCapture?.(e.pointerId);

    if (this.currentTool() === 'pan' && this.isPanning) {
      this.isPanning = false;
      // redraw with clamped offset (drawBaseImage clamps)
      this.drawBaseImage();
      this.drawAnnotationsOnly();
      return;
    }

    const tool = this.currentTool();

    if (tool === 'rect' && this.draftRectCurrent?.dragging) {
      this.draftRectCurrent.dragging = false;
      const bbox = this.rectToBbox(this.draftRectCurrent.start, this.draftRectCurrent.end);
      if (bbox) {
        this.pushHistory();
        const meta = this.snapshotMeta('bbox');
        const geometry: Geometry = { type: 'bbox', data: bbox };
        this.draftShapes.push({ id: this.createDraftId('bbox'), meta, geometry });
      }
      this.draftRectCurrent = null;
      this.drawAnnotationsOnly();
      return;
    }

    if (tool === 'freehand' && this.draftFreehandCurrent.drawing) {
      this.draftFreehandCurrent.drawing = false;

      const pts = this.draftFreehandCurrent.points.slice();
      const loop = this.tryBuildPolygonFromFreehand(pts);

      if (loop) {
        // Convertir en POLYGON rempli (zone interne)
        const meta = this.snapshotMeta('polygon');
        meta.shape = '〰️ Lasso';

        // On enlève éventuellement le dernier doublon si tu préfères; ici on le garde, closed:true suffit aussi.
        const geometry: Geometry = {
          type: 'polygon',
          data: { points: loop, closed: true },
        };

        this.draftShapes.push({ id: this.createDraftId('lasso'), meta, geometry });
        // reset après validation
        this.draftFreehandCurrent = { points: [], drawing: false };
        this.drawAnnotationsOnly();
        return;
      }

      // Pas fermé -> on ne valide pas une annotation de zone
      // (option future: conserver les points entre strokes; pour l’instant on reset)
      this.draftFreehandCurrent = { points: [], drawing: false };
      this.drawAnnotationsOnly();
    }
  }

  private snapshotMeta(kind: Geometry['type']): AnnotationMeta {
    const sev = this.selectedSeverity();
    const scls: AnnotationMeta['scls'] = sev === 'Critique' ? 'tag-red' : sev === 'Majeur' ? 'tag-orange' : 'tag-cyan';
    const shape = kind === 'bbox' ? '🟥 BBox' : kind === 'polygon' ? '🔷 Polygon' : '〰️ Tracé libre';

    return {
      def: this.annotationType(),
      sev,
      scls,
      desc: this.annotationDesc(),
      shape,
    };
  }

  private drawAnnotationsOnly(): void {
    const drawCanvas = this.drawCanvas.nativeElement;
    const ctx = drawCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    if (this.imageRenderRect.w === 0) return;

    for (const ann of this.imageAnnotations()) {
      this.drawGeometry(ctx, ann.geometry, ann.id, ann.scls, ann.def, false);
    }

    for (const draft of this.draftShapes) {
      this.drawGeometry(ctx, draft.geometry, -1, 'draft', draft.meta.def, true);
    }

    if (this.draftRectCurrent?.dragging) {
      const bbox = this.rectToBbox(this.draftRectCurrent.start, this.draftRectCurrent.end);
      if (bbox) this.drawGeometry(ctx, { type: 'bbox', data: bbox }, -2, 'draft', 'Draft', true);
    }

    if (this.draftPolygonCurrent.points.length > 0) {
      this.drawDraftPolygonOverlay(ctx);
    }

    if (this.draftFreehandCurrent.drawing && this.draftFreehandCurrent.points.length > 1) {
      const geometry: Geometry = {
        type: 'freehand',
        data: { points: this.draftFreehandCurrent.points, closed: false },
      };
      this.drawGeometry(ctx, geometry, -3, 'draft', 'Draft', true);
    }
  }

  private drawGeometry(
    ctx: CanvasRenderingContext2D,
    geometry: Geometry,
    annId: number,
    sevClass: 'tag-red' | 'tag-orange' | 'tag-cyan' | 'draft',
    label: string,
    isDraft: boolean,
  ): void {
    const hovered = !isDraft && this.hoveredAnnotId() === annId;
    const colors = this.getColors(sevClass);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = hovered ? 3 : 2;
    ctx.strokeStyle = colors.main;
    ctx.fillStyle = colors.fill;

    if (hovered) {
      ctx.shadowColor = colors.main;
      ctx.shadowBlur = 10;
    }

    const ix = this.imageRenderRect.x;
    const iy = this.imageRenderRect.y;
    const iw = this.imageRenderRect.w;
    const ih = this.imageRenderRect.h;

    if (geometry.type === 'bbox') {
      const data = geometry.data;
      const rx = ix + data.nx * iw;
      const ry = iy + data.ny * ih;
      const rw = data.nw * iw;
      const rh = data.nh * ih;

      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);

      if (!isDraft) {
        ctx.shadowBlur = 0;
        ctx.font = 'bold 10px Inter, sans-serif';
        const tw = ctx.measureText(label).width + 8;
        ctx.fillStyle = colors.main;
        ctx.fillRect(rx, ry - 16, tw, 16);
        ctx.fillStyle = '#121316';
        ctx.fillText(label, rx + 4, ry - 4);
      }

      ctx.restore();
      return;
    }

    const points = geometry.data.points;
    if (points.length < 2) {
      ctx.restore();
      return;
    }

    ctx.beginPath();
    points.forEach((pt, index) => {
      const px = ix + pt.nx * iw;
      const py = iy + pt.ny * ih;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });

    if (geometry.type === 'polygon') {
      ctx.closePath();
      ctx.fill();
    }

    ctx.stroke();
    ctx.restore();
  }

  private drawDraftPolygonOverlay(ctx: CanvasRenderingContext2D): void {
    const ix = this.imageRenderRect.x;
    const iy = this.imageRenderRect.y;
    const iw = this.imageRenderRect.w;
    const ih = this.imageRenderRect.h;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#E06C00';
    ctx.fillStyle = 'rgba(224,108,0,0.12)';

    ctx.beginPath();
    this.draftPolygonCurrent.points.forEach((pt, index) => {
      const px = ix + pt.nx * iw;
      const py = iy + pt.ny * ih;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });

    if (this.polygonPreview) {
      const px = ix + this.polygonPreview.nx * iw;
      const py = iy + this.polygonPreview.ny * ih;
      ctx.lineTo(px, py);
    }

    ctx.stroke();

    for (const pt of this.draftPolygonCurrent.points) {
      const px = ix + pt.nx * iw;
      const py = iy + pt.ny * ih;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#E06C00';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (this.draftPolygonCurrent.points.length > 0) {
      const first = this.draftPolygonCurrent.points[0];
      const fx = ix + first.nx * iw;
      const fy = iy + first.ny * ih;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(224,108,0,0.5)';
      ctx.lineWidth = 1;
      ctx.arc(fx, fy, this.CLOSE_TOL_PX, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  private getColors(sevClass: 'tag-red' | 'tag-orange' | 'tag-cyan' | 'draft'): { main: string; fill: string } {
    if (sevClass === 'draft') return { main: '#E06C00', fill: 'rgba(224,108,0,0.12)' };
    if (sevClass === 'tag-red') return { main: '#FF453A', fill: 'rgba(255,69,58,0.2)' };
    if (sevClass === 'tag-orange') return { main: '#FFD60A', fill: 'rgba(255,214,10,0.2)' };
    return { main: '#00C7BE', fill: 'rgba(0,199,190,0.15)' };
  }

  private tryBuildPolygonFromFreehand(points: NormPoint[]): NormPoint[] | null {
    if (points.length < 3) return null;

    // A) fermeture par proximité first/last (tolérance en px)
    const firstPx = this.normToPixel(points[0]);
    const lastPx = this.normToPixel(points[points.length - 1]);
    const d = Math.hypot(lastPx.x - firstPx.x, lastPx.y - firstPx.y);
    if (d <= this.CLOSE_TOL_PX) {
      return [...points, points[0]];
    }

    // B) fermeture par auto-intersection (segments non adjacents)
    // On cherche une boucle interne: intersection entre segments i..i+1 et j..j+1 (j >= i+2)
    for (let i = 0; i < points.length - 3; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      for (let j = i + 2; j < points.length - 1; j++) {
        // skip adjacency in same chain
        if (j === i + 1) continue;

        const q1 = points[j];
        const q2 = points[j + 1];

        // éviter le cas "premier et dernier segment" qui simule une fermeture extrémités (déjà géré au-dessus)
        if (i === 0 && j === points.length - 2) continue;

        const I = this.segmentIntersection(p1, p2, q1, q2);
        if (I) {
          // boucle = intersection + points entre i+1..j + intersection
          const middle = points.slice(i + 1, j + 1);
          return [I, ...middle, I];
        }
      }
    }

    return null;
  }

  private segmentIntersection(a1: NormPoint, a2: NormPoint, b1: NormPoint, b2: NormPoint): NormPoint | null {
    // Intersections sur segments 2D (coordonnées normalisées)
    const x1 = a1.nx, y1 = a1.ny;
    const x2 = a2.nx, y2 = a2.ny;
    const x3 = b1.nx, y3 = b1.ny;
    const x4 = b2.nx, y4 = b2.ny;

    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-10) return null; // parallèle / colinéaire

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / den;

    // intersection strictement à l'intérieur des segments (évite les faux positifs sur extrémités)
    const eps = 1e-6;
    if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;

    const ix = x1 + t * (x2 - x1);
    const iy = y1 + t * (y2 - y1);

    // clamp sécurité
    return { nx: Math.min(1, Math.max(0, ix)), ny: Math.min(1, Math.max(0, iy)) };
  }

  private rectToBbox(start: NormPoint, end: NormPoint): BBox | null {
    const x1 = Math.min(start.nx, end.nx);
    const y1 = Math.min(start.ny, end.ny);
    const x2 = Math.max(start.nx, end.nx);
    const y2 = Math.max(start.ny, end.ny);
    const nw = x2 - x1;
    const nh = y2 - y1;
    if (nw < 0.003 || nh < 0.003) return null;
    return { nx: x1, ny: y1, nw, nh };
  }

  private pixelToNorm(e: PointerEvent): NormPoint | null {
    const { x, y } = this.pointerToCanvasPosition(e);
    const ix = this.imageRenderRect.x;
    const iy = this.imageRenderRect.y;
    const iw = this.imageRenderRect.w;
    const ih = this.imageRenderRect.h;

    if (iw === 0 || ih === 0) return null;
    if (x < ix || x > ix + iw || y < iy || y > iy + ih) return null;

    return { nx: (x - ix) / iw, ny: (y - iy) / ih };
  }

  private pointerToCanvasPosition(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.drawCanvas.nativeElement.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private normToPixel(point: NormPoint): { x: number; y: number } {
    return {
      x: this.imageRenderRect.x + point.nx * this.imageRenderRect.w,
      y: this.imageRenderRect.y + point.ny * this.imageRenderRect.h,
    };
  }

  private createDraftId(prefix: string): string {
    const id = `${prefix}_${this.nextDraftId}`;
    this.nextDraftId += 1;
    return id;
  }
}

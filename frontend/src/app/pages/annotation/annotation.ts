import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { delay, firstValueFrom, Observable, of } from 'rxjs';

type Tool = 'pan' | 'rect' | 'polygon' | 'freehand';
type SeverityUi = 'Critique' | 'Majeur' | 'Mineur';
type SaveToastKind = 'success' | 'error';

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
  imageId: string;
  geometry: Geometry;
}

type WorkItemSource = 'draft' | 'base';

interface KanbanWorkItem {
  workId: string;
  order: number;
  source: WorkItemSource;
  dirty: boolean;
  imageId: string;
  baseAnnotationId?: number;
  draftId?: string;
  geometry: Geometry;
  meta: AnnotationMeta;
}

interface PersistedKanbanState {
  items: KanbanWorkItem[];
  currentWorkId: string | null;
  nextOrder: number;
}

interface DraftShape {
  id: string;
  meta: AnnotationMeta;
  geometry: Geometry;
}

interface ImageModel {
  id: string;
  name: string;
  src: string;
  format: string;
  size?: number;
  width: number;
  height: number;
  createdAt: string;
}

interface PersistedAnnotationWorkspaceV2 {
  version: 2;
  currentImageId: string;
  images: Record<string, ImageModel>;
  annotationsByImageId: Record<string, AnnotationItem[]>;
  viewByImageId: Record<string, { zoom: number; panOffset: { x: number; y: number } }>;
  draftsByImageId: Record<string, PersistedDraftState>;
  editorByImageId: Record<string, PersistedEditorState>;
  kanbanByImageId: Record<string, PersistedKanbanState>;
}

interface PersistedDraftState {
  draftShapes: DraftShape[];
  draftRectCurrent: { start: NormPoint; end: NormPoint; dragging: boolean } | null;
  draftPolygonCurrent: { points: NormPoint[]; closed: boolean };
  polygonPreview: NormPoint | null;
  draftFreehandCurrent: { points: NormPoint[]; drawing: boolean };
}

interface PersistedEditorState {
  selectedSeverity: SeverityUi;
  annotationType: string;
  annotationDesc: string;
}

interface SaveAnnotationsRequestDto {
  requestId: string;
  sentAt: string;
  image: SaveImageDto;
  creates: SaveCreateAnnotationDto[];
  updates: SaveUpdateAnnotationDto[];
}

interface SaveCreateAnnotationDto {
  workId: string;
  imageId: string;
  defectLabel: string;
  severity: SeverityUi;
  description: string;
  shapeLabel: string;
  geometry: SaveGeometryDto;
}

interface SaveUpdateAnnotationDto extends SaveCreateAnnotationDto {
  id: number;
}

interface SaveImageDto {
  id: string;
  name: string;
  format: string;
  size?: number;
  width: number;
  height: number;
  createdAt: string;
  src?: string;
}

type SaveGeometryDto =
  | { type: 'bbox'; bbox: { nx: number; ny: number; nw: number; nh: number } }
  | { type: 'polygon'; polygon: { points: NormPoint[]; closed: true } }
  | { type: 'freehand'; freehand: { points: NormPoint[]; closed: false } };

interface SaveAnnotationsResponseDto {
  success: boolean;
  requestId: string;
  createdWorkIds: string[];
  updatedWorkIds: string[];
  failedWorkIds: string[];
  backendMessage: string;
  receivedAt: string;
}

interface SaveAnnotationsErrorDto {
  success: false;
  requestId: string;
  backendMessage: string;
  receivedAt: string;
  errorCode?: string;
}

interface SaveToastState {
  visible: boolean;
  kind: SaveToastKind;
  message: string;
}

interface UndoState {
  draftShapes: DraftShape[];
  draftRectCurrent: { start: NormPoint; end: NormPoint; dragging: boolean } | null;
  draftPolygonCurrent: { points: NormPoint[]; closed: boolean };
  polygonPreview: NormPoint | null;
  draftFreehandCurrent: { points: NormPoint[]; drawing: boolean };
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

  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly STORAGE_KEY = 'vista.viewer.annotation.workspace.v2';
  private readonly SAVE_ENDPOINT = '/api/images/save-annotations';
  private readonly ENABLE_REAL_BACKEND_CALL = false;
  private readonly MAX_VISUAL_ITEMS = 10;

  private readonly DEFAULT_IMAGE_ID = 'asset_carter_moteur';
  private readonly DEFAULT_IMAGE_SRC = '/assets/carter_moteur.png';
  private readonly DEFAULT_IMAGE_NAME = 'carter_moteur_082.jpg';

  readonly defectOptions = [
    'Rayure profonde',
    'Fissure (micro)',
    'Décoloration / Tâche',
    "Défaut d'usinage (Bavure)",
    'Pièce manquante',
  ] as const;

  zoom = signal(100);
  currentTool = signal<Tool>('rect');

  selectedSeverity = signal<SeverityUi>('Mineur');
  annotationType = signal('Rayure profonde');
  annotationDesc = signal("Rayure profonde orientée à 45° sur la zone d'épaulement droite.");

  imageFileName = signal(this.DEFAULT_IMAGE_NAME);
  imageFileMeta = signal('RGB · 1920x1080 · 2.4 MB');

  currentImage = signal<ImageModel | null>(null);

  isSavingRemote = signal(false);
  remoteSaveSuccess = signal<string | null>(null);
  remoteSaveError = signal<string | null>(null);

  saveToast = signal<SaveToastState>({
    visible: false,
    kind: 'success',
    message: '',
  });

  kanbanItems = signal<KanbanWorkItem[]>([]);
  currentWorkId = signal<string | null>(null);

  imageAnnotations = signal<AnnotationItem[]>([]);
  hoveredAnnotId = signal<number | null>(null);

  private draftShapes: DraftShape[] = [];
  private draftRectCurrent: { start: NormPoint; end: NormPoint; dragging: boolean } | null = null;
  private draftPolygonCurrent: { points: NormPoint[]; closed: boolean } = { points: [], closed: false };
  private polygonPreview: NormPoint | null = null;
  private draftFreehandCurrent: { points: NormPoint[]; drawing: boolean } = { points: [], drawing: false };

  private panOffset = signal({ x: 0, y: 0 });
  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private panStartOffset = { x: 0, y: 0 };

  private loadedImageObj: HTMLImageElement | null = null;
  private imageRenderRect = { x: 0, y: 0, w: 0, h: 0 };

  private readonly CLOSE_TOL_PX = 14;
  private nextAnnotationId = 1;
  private nextDraftId = 1;
  private nextKanbanOrder = 1;
  private lastDraftAutosaveAt = 0;
  private toastTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private onPointerDownRef?: (e: PointerEvent) => void;
  private onPointerMoveRef?: (e: PointerEvent) => void;
  private onPointerUpRef?: (e: PointerEvent) => void;

  private undoStack: UndoState[] = [];
  private redoStack: UndoState[] = [];

  private onWheelZoom = (e: WheelEvent): void => {
    if (this.imageRenderRect.w === 0) return;
    e.preventDefault();

    const delta = -e.deltaY;
    const current = this.zoom();

    const factor = delta > 0 ? 1.1 : 0.9;
    const next = Math.round(Math.max(20, Math.min(1200, current * factor)));
    if (next === current) return;

    const canvasPos = this.pointerToCanvasPosition(e);

    const ix = this.imageRenderRect.x;
    const iy = this.imageRenderRect.y;
    const iw = this.imageRenderRect.w;
    const ih = this.imageRenderRect.h;

    const u = (canvasPos.x - ix) / iw;
    const v = (canvasPos.y - iy) / ih;

    this.zoom.set(next);

    this.drawBaseImage();

    const baseX = this.imageRenderRect.x - this.panOffset().x;
    const baseY = this.imageRenderRect.y - this.panOffset().y;

    const newW = this.imageRenderRect.w;
    const newH = this.imageRenderRect.h;

    const desiredX = canvasPos.x - u * newW;
    const desiredY = canvasPos.y - v * newH;

    this.panOffset.set({
      x: desiredX - baseX,
      y: desiredY - baseY,
    });

    this.drawBaseImage();
    this.drawAnnotationsOnly();
    this.persistWorkspaceState();
  };

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.setupDrawingInteraction();

      if (this.isBrowser && this.restoreWorkspaceFromStorage()) {
        const img = this.currentImage();
        if (img) this.loadImageFromSrc(img.src, true);
      } else {
        this.setDefaultImageAndSeed();
        this.persistWorkspaceState();
        const img = this.currentImage();
        if (img) this.loadImageFromSrc(img.src, true);
      }

      this.drawBaseImage();
      this.drawAnnotationsOnly();
    }, 50);
  }

  ngOnDestroy(): void {
    const canvas = this.drawCanvas?.nativeElement;
    if (canvas) {
      if (this.onPointerDownRef) canvas.removeEventListener('pointerdown', this.onPointerDownRef);
      if (this.onPointerMoveRef) canvas.removeEventListener('pointermove', this.onPointerMoveRef);
      if (this.onPointerUpRef) canvas.removeEventListener('pointerup', this.onPointerUpRef);
      canvas.removeEventListener('wheel', this.onWheelZoom);
    }

    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }
  }

  @HostListener('document:pointerdown')
  onDocumentPointerDown(): void {
    if (this.saveToast().visible) {
      this.hideSaveToast();
    }
  }

  setTool(tool: Tool): void {
    this.clearRemoteFeedback();
    this.currentTool.set(tool);
    this.polygonPreview = null;
    this.persistWorkspaceState();
    this.drawAnnotationsOnly();
  }

  setSeverity(severity: SeverityUi): void {
    this.clearRemoteFeedback();
    this.selectedSeverity.set(severity);

    const scls = this.severityToClass(severity);
    if (this.currentWorkItem()) this.updateCurrentWorkMeta({ sev: severity, scls });

    this.persistWorkspaceState();
  }

  updateAnnotationType(value: string): void {
    this.clearRemoteFeedback();
    this.annotationType.set(value);

    if (this.currentWorkItem()) this.updateCurrentWorkMeta({ def: value });

    this.persistWorkspaceState();
  }

  updateAnnotationDesc(value: string): void {
    this.clearRemoteFeedback();
    this.annotationDesc.set(value);

    if (this.currentWorkItem()) this.updateCurrentWorkMeta({ desc: value });

    this.persistWorkspaceState();
  }

  updateZoom(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    let next = Number.isFinite(value) ? value : 100;
    next = Math.round(Math.max(20, Math.min(1200, next)));

    this.zoom.set(next);
    this.currentTool.set('pan');

    this.drawBaseImage();
    this.drawAnnotationsOnly();
    this.persistWorkspaceState();
  }

  resetZoom(): void {
    this.zoom.set(100);
    this.drawBaseImage();
    this.drawAnnotationsOnly();
    this.persistWorkspaceState();
  }

  hoverAnnotation(id: number, isEnter: boolean): void {
    this.hoveredAnnotId.set(isEnter ? id : null);
    this.drawAnnotationsOnly();
  }

  editAnnotation(id: number): void {
    this.clearRemoteFeedback();
    this.focusBaseAnnotation(id);
  }

  removeCurrentKanbanItem(): void {
    const id = this.currentWorkId();
    if (!id) return;
    this.clearRemoteFeedback();
    this.removeKanbanItem(id);
  }

  clearCurrentWork(): void {
    this.currentWorkId.set(null);
    this.persistWorkspaceState();
    this.drawAnnotationsOnly();
  }

  draftCount(): number {
    return this.kanbanItems().filter((item) => item.source === 'draft').length;
  }

  cursorStyle(): string {
    if (this.currentTool() === 'pan') return this.isPanning ? 'grabbing' : 'grab';
    switch (this.currentTool()) {
      case 'rect':
      case 'polygon':
      case 'freehand':
      default:
        return 'crosshair';
    }
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

  private createWorkId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  private currentWorkItem(): KanbanWorkItem | null {
    const id = this.currentWorkId();
    if (!id) return null;
    return this.kanbanItems().find((item) => item.workId === id) ?? null;
  }

  setCurrentWork(workId: string | null): void {
    this.currentWorkId.set(workId);
    const current = workId ? this.kanbanItems().find((item) => item.workId === workId) ?? null : null;

    if (current) {
      this.selectedSeverity.set(current.meta.sev);
      this.annotationType.set(current.meta.def);
      this.annotationDesc.set(current.meta.desc);
    }

    this.persistWorkspaceState();
    this.drawAnnotationsOnly();
  }

  private canAddVisualItem(): boolean {
    return this.kanbanItems().length < this.MAX_VISUAL_ITEMS;
  }

  private addKanbanItem(item: Omit<KanbanWorkItem, 'workId' | 'order'>): KanbanWorkItem | null {
    const existingBase = item.source === 'base' && item.baseAnnotationId != null
      ? this.kanbanItems().find((w) => w.source === 'base' && w.baseAnnotationId === item.baseAnnotationId)
      : null;

    if (existingBase) {
      this.setCurrentWork(existingBase.workId);
      return existingBase;
    }

    if (!this.canAddVisualItem()) {
      this.showSaveToast('error', 'Limite de 10 éléments dans le visuel.');
      return null;
    }

    const created: KanbanWorkItem = {
      ...item,
      workId: this.createWorkId(item.source),
      order: this.nextKanbanOrder++,
    };

    this.kanbanItems.update((items) => [...items, created].sort((a, b) => a.order - b.order));
    this.setCurrentWork(created.workId);
    this.persistWorkspaceState();
    return created;
  }

  removeKanbanItem(workId: string): void {
    const wasCurrent = this.currentWorkId() === workId;
    const removed = this.kanbanItems().find((item) => item.workId === workId);

    this.kanbanItems.update((items) => items.filter((item) => item.workId !== workId));

    if (removed?.source === 'draft' && removed.draftId) {
      this.draftShapes = this.draftShapes.filter((draft) => draft.id !== removed.draftId);
    }

    if (wasCurrent) this.currentWorkId.set(null);

    this.persistWorkspaceState();
    this.drawAnnotationsOnly();
  }

  private updateCurrentWorkMeta(patch: Partial<Pick<AnnotationMeta, 'def' | 'sev' | 'scls' | 'desc'>>): void {
    const currentId = this.currentWorkId();
    if (!currentId) return;

    this.kanbanItems.update((items) =>
      items.map((item) =>
        item.workId === currentId
          ? {
              ...item,
              dirty: true,
              meta: {
                ...item.meta,
                ...patch,
              },
            }
          : item,
      ),
    );

    this.persistWorkspaceState();
    this.drawAnnotationsOnly();
  }

  private logFocusBaseAnnotation(annotationId: number): void {
    console.log('[VISTA][VISUEL][FOCUS_BASE]', {
      annotationId,
      alreadyInVisual: this.kanbanItems().some((item) => item.source === 'base' && item.baseAnnotationId === annotationId),
      visualCount: this.kanbanItems().length,
    });
  }

  private focusBaseAnnotation(annotationId: number): void {
    this.logFocusBaseAnnotation(annotationId);

    const ann = this.imageAnnotations().find((a) => a.id === annotationId);
    if (!ann) return;

    const existing = this.kanbanItems().find((item) => item.source === 'base' && item.baseAnnotationId === annotationId);
    if (existing) {
      this.setCurrentWork(existing.workId);
      return;
    }

    this.addKanbanItem({
      source: 'base',
      dirty: false,
      imageId: ann.imageId,
      baseAnnotationId: ann.id,
      geometry: JSON.parse(JSON.stringify(ann.geometry)) as Geometry,
      meta: {
        def: ann.def,
        sev: ann.sev,
        scls: ann.scls,
        desc: ann.desc,
        shape: ann.shape,
      },
    });
  }

  isBaseRowCurrent(annotationId: number): boolean {
    const current = this.currentWorkItem();
    return !!current && current.source === 'base' && current.baseAnnotationId === annotationId;
  }

  isKanbanCurrent(workId: string): boolean {
    return this.currentWorkId() === workId;
  }

  hasBaseItemsInKanban(): boolean {
    return this.kanbanItems().some((item) => item.source === 'base');
  }

  saveButtonLabel(): string {
    return this.hasBaseItemsInKanban() ? 'Mettre à jour' : 'Enregistrer';
  }

  kanbanBadgeLabel(item: KanbanWorkItem): string {
    if (item.source === 'base' && item.baseAnnotationId != null) return `#${item.baseAnnotationId}`;
    return `D${item.order}`;
  }

  kanbanSecondaryLabel(item: KanbanWorkItem): string {
    return item.meta.def;
  }

  kanbanItemClasses(item: KanbanWorkItem): string {
    return item.source === 'base' ? 'visual-item visual-item-base' : 'visual-item visual-item-draft';
  }

  private currentHighlightMatchesGeometry(geometry: Geometry, fallbackAnnotationId?: number): boolean {
    const current = this.currentWorkItem();
    if (!current) return false;

    if (fallbackAnnotationId != null && current.source === 'base' && current.baseAnnotationId === fallbackAnnotationId) {
      return true;
    }

    return this.sameGeometry(current.geometry, geometry);
  }

  private sameGeometry(a: Geometry, b: Geometry): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  deletePersistedAnnotation(id: number): void {
    this.clearRemoteFeedback();
    this.isSavingRemote.set(true);

    this.deletePersistedAnnotationDryRun$(id).subscribe({
      next: (response) => {
        if (!response.success) {
          this.handleSaveFailure('La suppression ne s’est pas faite.');
          return;
        }

        const wasCurrent = this.currentWorkItem()?.source === 'base' && this.currentWorkItem()?.baseAnnotationId === id;
        this.imageAnnotations.update((annots) => annots.filter((a) => a.id !== id));
        this.kanbanItems.update((items) => items.filter((item) => item.source !== 'base' || item.baseAnnotationId !== id));
        if (this.hoveredAnnotId() === id) this.hoveredAnnotId.set(null);
        if (wasCurrent) this.currentWorkId.set(null);

        this.showSaveToast('success', 'Annotation supprimée.');
        this.persistWorkspaceState();
        this.drawAnnotationsOnly();
      },
      error: () => {
        this.handleSaveFailure('La suppression ne s’est pas faite.');
        this.isSavingRemote.set(false);
      },
      complete: () => {
        this.isSavingRemote.set(false);
      },
    });
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
      e.preventDefault();
      e.stopPropagation();
      this.undo();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      e.stopPropagation();
      this.redo();
    }
  }

  private snapshotState(): UndoState {
    return JSON.parse(
      JSON.stringify({
        draftShapes: this.draftShapes,
        draftRectCurrent: this.draftRectCurrent,
        draftPolygonCurrent: this.draftPolygonCurrent,
        polygonPreview: this.polygonPreview,
        draftFreehandCurrent: this.draftFreehandCurrent,
      } satisfies UndoState),
    ) as UndoState;
  }

  private restoreState(state: UndoState): void {
    this.draftShapes = state.draftShapes ?? [];
    this.draftRectCurrent = state.draftRectCurrent ?? null;
    this.draftPolygonCurrent = state.draftPolygonCurrent ?? { points: [], closed: false };
    this.polygonPreview = state.polygonPreview ?? null;
    this.draftFreehandCurrent = state.draftFreehandCurrent ?? { points: [], drawing: false };

    this.drawAnnotationsOnly();
  }

  private pushHistory(): void {
    this.undoStack.push(this.snapshotState());
    this.redoStack = [];
    if (this.undoStack.length > 80) this.undoStack.shift();
  }

  undo(): void {
    if (this.undoStack.length === 0) return;

    const current = this.snapshotState();
    this.redoStack.push(current);

    const prev = this.undoStack.pop();
    if (prev) this.restoreState(prev);

    this.clearRemoteFeedback();
    this.persistWorkspaceState();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;

    const current = this.snapshotState();
    this.undoStack.push(current);

    const next = this.redoStack.pop();
    if (next) this.restoreState(next);

    this.clearRemoteFeedback();
    this.persistWorkspaceState();
  }

  private clearDraftsNoHistory(): void {
    this.draftShapes = [];
    this.draftRectCurrent = null;
    this.draftPolygonCurrent = { points: [], closed: false };
    this.polygonPreview = null;
    this.draftFreehandCurrent = { points: [], drawing: false };
  }

  private resetTransientAnnotationState(): void {
    this.clearDraftsNoHistory();
    this.hoveredAnnotId.set(null);
    this.kanbanItems.set([]);
    this.currentWorkId.set(null);
    this.nextKanbanOrder = 1;

    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.panStartOffset = { x: 0, y: 0 };

    this.undoStack = [];
    this.redoStack = [];
  }

  resetDrafts(): void {
    const hasAnyDraft =
      this.draftShapes.length > 0 ||
      this.kanbanItems().some((item) => item.source === 'draft') ||
      !!this.draftRectCurrent?.dragging ||
      this.draftPolygonCurrent.points.length > 0 ||
      this.draftFreehandCurrent.drawing;

    if (hasAnyDraft) this.pushHistory();

    this.clearDraftsNoHistory();
    this.kanbanItems.update((items) => items.filter((item) => item.source !== 'draft'));
    if (this.currentWorkItem()?.source === 'draft') this.currentWorkId.set(null);
    this.clearRemoteFeedback();
    this.persistWorkspaceState();
    this.drawAnnotationsOnly();
  }

  async saveToBackend(): Promise<void> {
    this.remoteSaveSuccess.set(null);
    this.remoteSaveError.set(null);
    this.hideSaveToast();

    const img = this.currentImage();
    if (!img) {
      this.handleSaveFailure('Aucune image chargée.');
      return;
    }

    if (this.hasInProgressShape()) {
      this.handleSaveFailure("Une annotation est encore en cours de dessin. Finalise-la avant l'envoi en base.");
      this.persistWorkspaceState();
      return;
    }

    const workItems = this.kanbanItems();
    if (workItems.length === 0) {
      this.handleSaveFailure('Aucun élément à enregistrer.');
      return;
    }

    let dto: SaveAnnotationsRequestDto;
    try {
      dto = this.buildSaveRequestDto();
    } catch (error) {
      console.error('[VISTA][SAVE][DTO]', error);
      this.handleSaveFailure('Impossible de préparer la sauvegarde.');
      return;
    }

    const validationErrors = this.validateSaveRequest(dto);
    if (validationErrors.length > 0) {
      console.error('[VISTA][SAVE][VALIDATION]', validationErrors, dto);
      this.handleSaveFailure("L'enregistrement ne s'est pas fait.");
      return;
    }

    this.isSavingRemote.set(true);

    try {
      const response = await firstValueFrom(
        this.ENABLE_REAL_BACKEND_CALL
          ? this.saveToBackendDryRun$(dto)
          : this.saveToBackendDryRun$(dto),
      );

      if (!response.success) {
        this.handleSaveFailure("L'enregistrement ne s'est pas fait.");
        return;
      }

      this.applySaveResponse(response);
      const remaining = this.kanbanItems().length;
      this.remoteSaveSuccess.set(remaining === 0 ? 'Enregistrement préparé.' : 'Enregistrement partiel préparé.');
      this.showSaveToast(remaining === 0 ? 'success' : 'error', remaining === 0 ? 'Enregistrement réussi.' : 'Enregistrement partiel : certains éléments restent dans le kanban.');

      this.currentWorkId.set(null);
      this.persistWorkspaceState();
      this.drawAnnotationsOnly();
    } catch (error) {
      console.error('[VISTA][SAVE]', error);
      this.handleSaveFailure("L'enregistrement ne s'est pas fait.");
    } finally {
      this.isSavingRemote.set(false);
    }
  }

  private buildSaveRequestDto(): SaveAnnotationsRequestDto {
    const img = this.currentImage();
    if (!img) {
      throw new Error('No current image');
    }

    return {
      requestId: this.createRequestId(),
      sentAt: new Date().toISOString(),
      image: {
        id: img.id,
        name: img.name,
        format: img.format,
        size: img.size,
        width: img.width,
        height: img.height,
        createdAt: img.createdAt,
        src: img.src,
      },
      creates: this.kanbanItems()
        .filter((item) => item.source === 'draft')
        .map((item) => this.toSaveCreateAnnotationDto(item)),
      updates: this.kanbanItems()
        .filter((item) => item.source === 'base' && item.dirty)
        .map((item) => this.toSaveUpdateAnnotationDto(item)),
    };
  }

  private createRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  private toSaveCreateAnnotationDto(item: KanbanWorkItem): SaveCreateAnnotationDto {
    return {
      workId: item.workId,
      imageId: item.imageId,
      defectLabel: item.meta.def,
      severity: item.meta.sev,
      description: item.meta.desc,
      shapeLabel: item.meta.shape,
      geometry: this.toSaveGeometryDto(item.geometry),
    };
  }

  private toSaveUpdateAnnotationDto(item: KanbanWorkItem): SaveUpdateAnnotationDto {
    if (item.baseAnnotationId == null) throw new Error('Missing base annotation id');
    return {
      ...this.toSaveCreateAnnotationDto(item),
      id: item.baseAnnotationId,
    };
  }

  private toSaveGeometryDto(geometry: Geometry): SaveGeometryDto {
    if (geometry.type === 'bbox') {
      return {
        type: 'bbox',
        bbox: {
          nx: geometry.data.nx,
          ny: geometry.data.ny,
          nw: geometry.data.nw,
          nh: geometry.data.nh,
        },
      };
    }

    if (geometry.type === 'polygon') {
      return {
        type: 'polygon',
        polygon: {
          points: geometry.data.points.map((p) => ({ nx: p.nx, ny: p.ny })),
          closed: true,
        },
      };
    }

    return {
      type: 'freehand',
      freehand: {
        points: geometry.data.points.map((p) => ({ nx: p.nx, ny: p.ny })),
        closed: false,
      },
    };
  }

  private validateSaveRequest(dto: SaveAnnotationsRequestDto): string[] {
    const errors: string[] = [];

    if (!dto.image?.id) errors.push('Missing image id');
    if (dto.image.id !== this.currentImage()?.id) errors.push('DTO image does not match current image');

    const annotations = [...dto.creates, ...dto.updates];

    for (const ann of annotations) {
      if (ann.imageId !== dto.image.id) errors.push(`Annotation ${ann.workId}: imageId mismatch`);

      if (ann.geometry.type === 'bbox') {
        if (!(ann.geometry.bbox.nw > 0) || !(ann.geometry.bbox.nh > 0)) {
          errors.push(`Annotation ${ann.workId}: invalid bbox size`);
        }
        continue;
      }

      if (ann.geometry.type === 'polygon') {
        const usefulPoints = this.countUniquePoints(ann.geometry.polygon.points);
        if (usefulPoints < 3) errors.push(`Annotation ${ann.workId}: polygon needs at least 3 useful points`);
        continue;
      }

      if (ann.geometry.freehand.points.length < 2) {
        errors.push(`Annotation ${ann.workId}: freehand needs at least 2 points`);
      }
    }

    return errors;
  }

  private countUniquePoints(points: NormPoint[]): number {
    return new Set(points.map((p) => `${p.nx.toFixed(6)}:${p.ny.toFixed(6)}`)).size;
  }

  private saveToBackendDryRun$(dto: SaveAnnotationsRequestDto): Observable<SaveAnnotationsResponseDto> {
    void this.http;

    const receivedAt = new Date().toISOString();
    const simulatedHeaders = {
      'Content-Type': 'application/json',
      'X-Vista-Dry-Run': 'true',
      'X-Request-Id': dto.requestId,
    };

    console.groupCollapsed('[VISTA][DRY-RUN API] POST ' + this.SAVE_ENDPOINT);
    console.log('endpoint:', this.SAVE_ENDPOINT);
    console.log('method:', 'POST');
    console.log('headers:', simulatedHeaders);
    console.log('requestId:', dto.requestId);
    console.log('sentAt:', dto.sentAt);
    console.log('timestamp:', receivedAt);
    console.log('imageId:', dto.image.id);
    console.log('createsCount:', dto.creates.length);
    console.log('updatesCount:', dto.updates.length);
    console.log('payload:', dto);
    console.groupEnd();

    const createdWorkIds = dto.creates.map((item) => item.workId);
    const updatedWorkIds = dto.updates.map((item) => item.workId);

    return of({
      success: true,
      requestId: dto.requestId,
      createdWorkIds,
      updatedWorkIds,
      failedWorkIds: [],
      backendMessage: 'Dry-run only: no external call has been made.',
      receivedAt,
    }).pipe(delay(300));
  }

  private applySaveResponse(response: SaveAnnotationsResponseDto): void {
    const items = this.kanbanItems();
    const failed = new Set(response.failedWorkIds);
    const cleanBaseWorkIds = items
      .filter((item) => item.source === 'base' && !item.dirty && !failed.has(item.workId))
      .map((item) => item.workId);
    const succeeded = new Set([...response.createdWorkIds, ...response.updatedWorkIds, ...cleanBaseWorkIds]);
    const successfulItems = items.filter((item) => succeeded.has(item.workId) && !failed.has(item.workId));

    const createdAnnotations: AnnotationItem[] = [];
    const updatedById = new Map<number, KanbanWorkItem>();

    for (const item of successfulItems) {
      if (item.source === 'draft') {
        createdAnnotations.push({
          id: this.nextAnnotationId++,
          imageId: item.imageId,
          ...item.meta,
          geometry: JSON.parse(JSON.stringify(item.geometry)) as Geometry,
        });
      } else if (item.source === 'base' && item.baseAnnotationId != null && item.dirty) {
        updatedById.set(item.baseAnnotationId, item);
      }
    }

    if (createdAnnotations.length > 0 || updatedById.size > 0) {
      this.imageAnnotations.update((annotations) => [
        ...annotations.map((ann) => {
          const update = updatedById.get(ann.id);
          return update
            ? {
                ...ann,
                ...update.meta,
                geometry: JSON.parse(JSON.stringify(update.geometry)) as Geometry,
              }
            : ann;
        }),
        ...createdAnnotations,
      ]);
    }

    this.kanbanItems.update((current) => current.filter((item) => !succeeded.has(item.workId) || failed.has(item.workId)));

    const remainingDraftIds = new Set(
      this.kanbanItems()
        .filter((item) => item.source === 'draft' && !!item.draftId)
        .map((item) => item.draftId as string),
    );

    this.draftShapes = this.draftShapes.filter((draft) => remainingDraftIds.has(draft.id));
    this.syncNextAnnotationId();
    this.currentWorkId.set(null);
  }

  private deletePersistedAnnotationDryRun$(id: number): Observable<{ success: boolean; id: number; receivedAt: string }> {
    void this.http;
    const receivedAt = new Date().toISOString();
    console.groupCollapsed('[VISTA][DRY-RUN API] DELETE /api/annotations/' + id);
    console.log('method:', 'DELETE');
    console.log('id:', id);
    console.log('timestamp:', receivedAt);
    console.groupEnd();

    return of({ success: true, id, receivedAt }).pipe(delay(220));
  }

  /*
  private deletePersistedAnnotationHttp$(id: number): Observable<{ success: boolean; id: number; receivedAt: string }> {
    return this.http.delete<{ success: boolean; id: number; receivedAt: string }>(
      `/api/annotations/${id}`,
      {
        observe: 'response',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    ).pipe(
      timeout(10000),
      map((response) => {
        const body = response.body;
        if (!body || body.success !== true || body.id !== id) {
          throw new Error('Invalid delete response');
        }
        return body;
      }),
      catchError((error: unknown) => {
        console.error('[VISTA][API] deletePersistedAnnotation failed', error);
        return throwError(() => new Error('DELETE_BACKEND_FAILED'));
      }),
    );
  }
  */

  /*
  private saveToBackendHttp$(dto: SaveAnnotationsRequestDto): Observable<SaveAnnotationsResponseDto> {
    return this.http.post<SaveAnnotationsResponseDto>(
      this.SAVE_ENDPOINT,
      dto,
      {
        observe: 'response',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': dto.requestId,
        },
      },
    ).pipe(
      timeout(10000),
      map((response) => {
        const body = response.body;
        if (!body || body.success !== true || !body.requestId || body.requestId !== dto.requestId) {
          throw new Error('Invalid backend response');
        }
        return body;
      }),
      catchError((error: unknown) => {
        console.error('[VISTA][API] saveToBackend failed', error);
        return throwError(() => new Error('SAVE_BACKEND_FAILED'));
      }),
    );
  }
  */

  private handleSaveFailure(message: string): void {
    const errorDto: SaveAnnotationsErrorDto = {
      success: false,
      requestId: this.createRequestId(),
      backendMessage: message,
      receivedAt: new Date().toISOString(),
      errorCode: 'SAVE_BACKEND_FAILED',
    };

    console.error('[VISTA][SAVE][ERROR]', errorDto);
    this.remoteSaveError.set(message);
    this.showSaveToast('error', "L'enregistrement ne s'est pas fait.");
  }

  private showSaveToast(kind: SaveToastKind, message: string, durationMs = 2800): void {
    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }

    this.saveToast.set({
      visible: true,
      kind,
      message,
    });

    this.toastTimeoutId = setTimeout(() => {
      this.hideSaveToast();
    }, durationMs);
  }

  hideSaveToast(): void {
    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }

    this.saveToast.set({
      visible: false,
      kind: 'success',
      message: '',
    });
  }

  private hasInProgressShape(): boolean {
    return !!this.draftRectCurrent?.dragging
      || this.draftPolygonCurrent.points.length > 0
      || this.draftFreehandCurrent.drawing;
  }

  private clearRemoteFeedback(): void {
    this.remoteSaveSuccess.set(null);
    this.remoteSaveError.set(null);
    this.hideSaveToast();
  }

  private emptyDraftState(): PersistedDraftState {
    return {
      draftShapes: [],
      draftRectCurrent: null,
      draftPolygonCurrent: { points: [], closed: false },
      polygonPreview: null,
      draftFreehandCurrent: { points: [], drawing: false },
    };
  }

  private currentDraftState(): PersistedDraftState {
    return {
      draftShapes: JSON.parse(JSON.stringify(this.draftShapes)),
      draftRectCurrent: this.draftRectCurrent ? JSON.parse(JSON.stringify(this.draftRectCurrent)) : null,
      draftPolygonCurrent: JSON.parse(JSON.stringify(this.draftPolygonCurrent)),
      polygonPreview: this.polygonPreview ? JSON.parse(JSON.stringify(this.polygonPreview)) : null,
      draftFreehandCurrent: JSON.parse(JSON.stringify(this.draftFreehandCurrent)),
    };
  }

  private applyDraftState(state: PersistedDraftState | null | undefined): void {
    const safe = state ?? this.emptyDraftState();
    this.draftShapes = safe.draftShapes ?? [];
    this.draftRectCurrent = safe.draftRectCurrent ?? null;
    this.draftPolygonCurrent = safe.draftPolygonCurrent ?? { points: [], closed: false };
    this.polygonPreview = safe.polygonPreview ?? null;
    this.draftFreehandCurrent = safe.draftFreehandCurrent ?? { points: [], drawing: false };
  }

  private currentEditorState(): PersistedEditorState {
    return {
      selectedSeverity: this.selectedSeverity(),
      annotationType: this.annotationType(),
      annotationDesc: this.annotationDesc(),
    };
  }

  private applyEditorState(state: PersistedEditorState | null | undefined): void {
    if (!state) return;
    this.selectedSeverity.set(state.selectedSeverity ?? 'Mineur');
    this.annotationType.set(state.annotationType ?? 'Rayure profonde');
    this.annotationDesc.set(state.annotationDesc ?? "Rayure profonde orientée à 45° sur la zone d'épaulement droite.");
  }

  private currentKanbanState(): PersistedKanbanState {
    return {
      items: JSON.parse(JSON.stringify(this.kanbanItems().slice().sort((a, b) => a.order - b.order))) as KanbanWorkItem[],
      currentWorkId: this.currentWorkId(),
      nextOrder: this.nextKanbanOrder,
    };
  }

  private applyKanbanState(state: PersistedKanbanState | null | undefined): void {
    const items = (state?.items ?? []).slice().sort((a, b) => a.order - b.order);
    this.kanbanItems.set(items);
    this.currentWorkId.set(items.some((item) => item.workId === state?.currentWorkId) ? state?.currentWorkId ?? null : null);

    const maxOrder = items.reduce((max, item) => Math.max(max, item.order), 0);
    this.nextKanbanOrder = Math.max(state?.nextOrder ?? 1, maxOrder + 1, 1);

    const current = this.currentWorkItem();
    if (current) {
      this.selectedSeverity.set(current.meta.sev);
      this.annotationType.set(current.meta.def);
      this.annotationDesc.set(current.meta.desc);
    }
  }

  private readWorkspaceState(): PersistedAnnotationWorkspaceV2 | null {
    if (!this.isBrowser) return null;
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PersistedAnnotationWorkspaceV2>;
      if (parsed.version !== 2) return null;
      if (typeof parsed.currentImageId !== 'string') return null;
      if (!parsed.images || !parsed.annotationsByImageId || !parsed.viewByImageId || !parsed.draftsByImageId) return null;
      return parsed as PersistedAnnotationWorkspaceV2;
    } catch {
      return null;
    }
  }

  private persistWorkspaceState(): void {
    if (!this.isBrowser) return;
    const img = this.currentImage();
    if (!img) return;

    const prev = this.readWorkspaceState();

    const state: PersistedAnnotationWorkspaceV2 = {
      version: 2,
      currentImageId: img.id,
      images: {
        ...(prev?.images ?? {}),
        [img.id]: img,
      },
      annotationsByImageId: {
        ...(prev?.annotationsByImageId ?? {}),
        [img.id]: this.imageAnnotations(),
      },
      viewByImageId: {
        ...(prev?.viewByImageId ?? {}),
        [img.id]: {
          zoom: this.zoom(),
          panOffset: this.panOffset(),
        },
      },
      draftsByImageId: {
        ...(prev?.draftsByImageId ?? {}),
        [img.id]: this.currentDraftState(),
      },
      editorByImageId: {
        ...(prev?.editorByImageId ?? {}),
        [img.id]: this.currentEditorState(),
      },
      kanbanByImageId: {
        ...(prev?.kanbanByImageId ?? {}),
        [img.id]: this.currentKanbanState(),
      },
    };

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore quota / storage failures
    }
  }

  private persistDraftProgressThrottled(): void {
    const now = Date.now();
    if (now - this.lastDraftAutosaveAt < 250) return;
    this.lastDraftAutosaveAt = now;
    this.persistWorkspaceState();
  }

  private restoreWorkspaceFromStorage(): boolean {
    if (!this.isBrowser) return false;

    const state = this.readWorkspaceState();
    if (!state) return false;

    const img = state.images[state.currentImageId];
    if (!img) return false;

    this.resetTransientAnnotationState();

    this.currentImage.set(img);
    this.zoom.set(state.viewByImageId?.[img.id]?.zoom ?? 100);
    this.panOffset.set(state.viewByImageId?.[img.id]?.panOffset ?? { x: 0, y: 0 });

    const ann = state.annotationsByImageId?.[img.id] ?? [];
    this.imageAnnotations.set(ann.map((a) => ({ ...a, imageId: a.imageId ?? img.id })));

    this.applyDraftState(state.draftsByImageId?.[img.id]);
    this.applyEditorState(state.editorByImageId?.[img.id]);
    this.applyKanbanState(state.kanbanByImageId?.[img.id]);

    this.syncNextAnnotationId();
    this.syncNextDraftId();

    this.imageFileName.set(img.name);
    this.imageFileMeta.set(`${img.format} · ${img.width}x${img.height}`);

    return true;
  }

  private setDefaultImageAndSeed(): void {
    this.resetTransientAnnotationState();
    this.clearRemoteFeedback();

    const img: ImageModel = {
      id: this.DEFAULT_IMAGE_ID,
      name: this.DEFAULT_IMAGE_NAME,
      src: this.DEFAULT_IMAGE_SRC,
      format: 'PNG',
      size: undefined,
      width: 0,
      height: 0,
      createdAt: new Date().toISOString(),
    };

    this.currentImage.set(img);
    this.imageFileName.set(img.name);
    this.imageFileMeta.set('PNG · —');

    this.imageAnnotations.set([
      {
        id: 1,
        imageId: img.id,
        shape: '🟥 BBox',
        def: 'Rayure profonde',
        sev: 'Critique',
        scls: 'tag-red',
        desc: 'Rayure importante sur la surface principale.',
        geometry: { type: 'bbox', data: { nx: 0.45, ny: 0.35, nw: 0.15, nh: 0.3 } },
      },
      {
        id: 2,
        imageId: img.id,
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

    this.zoom.set(100);
    this.panOffset.set({ x: 0, y: 0 });
    this.syncNextAnnotationId();
    this.persistWorkspaceState();
  }

  private syncNextAnnotationId(): void {
    const maxId = this.imageAnnotations().reduce((max, a) => Math.max(max, a.id), 0);
    this.nextAnnotationId = Math.max(1, maxId + 1);
  }

  private syncNextDraftId(): void {
    const maxDraftId = this.draftShapes.reduce((max, draft) => {
      const match = draft.id.match(/_(\d+)$/);
      const numericId = match ? Number(match[1]) : 0;
      return Number.isFinite(numericId) ? Math.max(max, numericId) : max;
    }, 0);

    this.nextDraftId = Math.max(1, maxDraftId + 1);
  }

  private newImageId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  private loadImageFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const src = reader.result;

      this.resetTransientAnnotationState();
      this.clearRemoteFeedback();

      const img: ImageModel = {
        id: this.newImageId('upload'),
        name: file.name,
        src,
        format: this.fileTypeLabel(file.type),
        size: file.size,
        width: 0,
        height: 0,
        createdAt: new Date().toISOString(),
      };

      this.currentImage.set(img);
      this.imageAnnotations.set([]);
      this.syncNextAnnotationId();

      this.zoom.set(100);
      this.panOffset.set({ x: 0, y: 0 });

      this.imageFileName.set(img.name);
      this.imageFileMeta.set(`${img.format} · — · ${this.formatBytes(file.size)}`);

      this.persistWorkspaceState();
      this.loadImageFromSrc(src, true);
    };
    reader.readAsDataURL(file);
  }

  private loadImageFromSrc(src: string, updateMeta: boolean): void {
    const imgEl = new Image();
    imgEl.src = src;

    imgEl.onload = () => {
      this.loadedImageObj = imgEl;

      const ci = this.currentImage();
      if (ci) {
        const updated: ImageModel = { ...ci, width: imgEl.width, height: imgEl.height };
        this.currentImage.set(updated);

        if (updateMeta) {
          this.imageFileName.set(updated.name);
          const sizePart = updated.size != null ? ` · ${this.formatBytes(updated.size)}` : '';
          this.imageFileMeta.set(`${updated.format} · ${updated.width}x${updated.height}${sizePart}`);
        }

        this.persistWorkspaceState();
      }

      this.drawBaseImage();
      this.drawAnnotationsOnly();
    };

    imgEl.onerror = () => {
      this.loadedImageObj = null;
      this.drawBaseImage();
      this.drawAnnotationsOnly();
    };
  }

  @HostListener('window:resize')
  onResize(): void {
    this.drawBaseImage();
    this.drawAnnotationsOnly();
  }

  private getZoomScale(): number {
    return Math.max(0.1, this.zoom() / 100);
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

    if (drawWidth <= width) {
      x = baseX;
      nextPanX = 0;
    } else {
      const minX = width - drawWidth;
      const maxX = 0;
      x = Math.min(maxX, Math.max(minX, x));
      nextPanX = x - baseX;
    }

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

    this.imageRenderRect = { x, y, w: drawWidth, h: drawHeight };

    ctx.drawImage(this.loadedImageObj, this.imageRenderRect.x, this.imageRenderRect.y, this.imageRenderRect.w, this.imageRenderRect.h);
  }

  private drawAnnotationsOnly(): void {
    const drawCanvas = this.drawCanvas.nativeElement;
    const ctx = drawCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    if (this.imageRenderRect.w === 0) return;

    const baseWorkItems = this.kanbanItems().filter((item) => item.source === 'base');

    for (const ann of this.imageAnnotations()) {
      const workItem = baseWorkItems.find((item) => item.baseAnnotationId === ann.id);
      this.drawGeometry(
        ctx,
        workItem?.geometry ?? ann.geometry,
        ann.id,
        workItem?.meta.scls ?? ann.scls,
        workItem?.meta.def ?? ann.def,
        false,
      );
    }

    for (const item of this.kanbanItems().filter((workItem) => workItem.source === 'draft')) {
      this.drawGeometry(
        ctx,
        item.geometry,
        -1,
        item.meta.scls,
        item.meta.def,
        true,
      );
    }

    if (this.draftRectCurrent?.dragging) {
      const bbox = this.rectToBbox(this.draftRectCurrent.start, this.draftRectCurrent.end);
      if (bbox) this.drawGeometry(ctx, { type: 'bbox', data: bbox }, -2, 'draft', 'Draft', true);
    }

    if (this.draftPolygonCurrent.points.length > 0) {
      this.drawDraftPolygonOverlay(ctx);
    }

    if (this.draftFreehandCurrent.drawing && this.draftFreehandCurrent.points.length > 1) {
      const geometry: Geometry = { type: 'freehand', data: { points: this.draftFreehandCurrent.points, closed: false } };
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
    const highlighted =
      (!isDraft && this.hoveredAnnotId() === annId) ||
      this.currentHighlightMatchesGeometry(geometry, !isDraft && annId > 0 ? annId : undefined);

    const colors = this.getColors(sevClass);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = highlighted ? 3 : 2;
    ctx.strokeStyle = colors.main;
    ctx.fillStyle = colors.fill;

    if (highlighted) {
      ctx.shadowColor = colors.main;
      ctx.shadowBlur = 10;
    }

    const ix = this.imageRenderRect.x;
    const iy = this.imageRenderRect.y;
    const iw = this.imageRenderRect.w;
    const ih = this.imageRenderRect.h;

    if (geometry.type === 'bbox') {
      const d = geometry.data;
      const rx = ix + d.nx * iw;
      const ry = iy + d.ny * ih;
      const rw = d.nw * iw;
      const rh = d.nh * ih;

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

    const pts = geometry.data.points;
    if (pts.length < 2) {
      ctx.restore();
      return;
    }

    ctx.beginPath();
    pts.forEach((pt, idx) => {
      const px = ix + pt.nx * iw;
      const py = iy + pt.ny * ih;
      if (idx === 0) ctx.moveTo(px, py);
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

    ctx.beginPath();
    this.draftPolygonCurrent.points.forEach((pt, idx) => {
      const px = ix + pt.nx * iw;
      const py = iy + pt.ny * ih;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });

    if (this.polygonPreview) {
      ctx.lineTo(ix + this.polygonPreview.nx * iw, iy + this.polygonPreview.ny * ih);
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
      if (this.imageRenderRect.w === 0) this.drawBaseImage();

      const p = this.pointerToCanvasPosition(e);
      this.isPanning = true;
      this.panStart = { x: p.x, y: p.y };
      const off = this.panOffset();
      this.panStartOffset = { x: off.x, y: off.y };
      this.drawCanvas.nativeElement.setPointerCapture?.(e.pointerId);
      this.drawBaseImage();
      this.drawAnnotationsOnly();
      return;
    }

    if (this.imageRenderRect.w === 0) this.drawBaseImage();

    const point = this.pixelToNorm(e);
    if (!point) return;

    this.drawCanvas.nativeElement.setPointerCapture?.(e.pointerId);

    if (tool === 'rect') {
      this.clearRemoteFeedback();
      this.draftRectCurrent = { start: point, end: point, dragging: true };
      this.persistWorkspaceState();
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
          this.clearRemoteFeedback();
          const meta = this.snapshotMeta('polygon');
          const geometry: Geometry = { type: 'polygon', data: { points: this.draftPolygonCurrent.points.slice(), closed: true } };
          this.pushHistory();

          const newDraft: DraftShape = {
            id: this.createDraftId('poly'),
            meta,
            geometry,
          };

          this.draftShapes.push(newDraft);
          this.draftPolygonCurrent = { points: [], closed: false };
          this.polygonPreview = null;
          this.addDraftShapeToKanban(newDraft);
          this.persistWorkspaceState();
          this.drawAnnotationsOnly();
          return;
        }
      }

      this.clearRemoteFeedback();
      this.pushHistory();
      this.draftPolygonCurrent.points.push(point);
      this.persistWorkspaceState();
      this.drawAnnotationsOnly();
      return;
    }

    this.clearRemoteFeedback();
    this.pushHistory();
    this.draftFreehandCurrent = { points: [point], drawing: true };
    this.persistWorkspaceState();
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
      this.persistDraftProgressThrottled();
      this.drawAnnotationsOnly();
      return;
    }

    if (tool === 'polygon') {
      this.polygonPreview = point ? { nx: point.nx, ny: point.ny } : null;
      if (this.draftPolygonCurrent.points.length > 0) {
        this.persistDraftProgressThrottled();
        this.drawAnnotationsOnly();
      }
      return;
    }

    if (tool === 'freehand' && this.draftFreehandCurrent.drawing && point) {
      this.draftFreehandCurrent.points.push(point);
      if (this.draftFreehandCurrent.points.length > 3000) this.draftFreehandCurrent.points.shift();
      this.persistDraftProgressThrottled();
      this.drawAnnotationsOnly();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.drawCanvas.nativeElement.releasePointerCapture?.(e.pointerId);

    if (this.currentTool() === 'pan' && this.isPanning) {
      this.isPanning = false;
      this.drawBaseImage();
      this.drawAnnotationsOnly();
      this.persistWorkspaceState();
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
        const newDraft: DraftShape = { id: this.createDraftId('bbox'), meta, geometry };
        this.draftShapes.push(newDraft);
        this.addDraftShapeToKanban(newDraft);
      }
      this.draftRectCurrent = null;
      this.clearRemoteFeedback();
      this.persistWorkspaceState();
      this.drawAnnotationsOnly();
      return;
    }

    if (tool === 'freehand' && this.draftFreehandCurrent.drawing) {
      this.draftFreehandCurrent.drawing = false;

      const pts = this.draftFreehandCurrent.points.slice();
      const loop = this.tryBuildPolygonFromFreehand(pts);

      if (loop) {
        const meta = this.snapshotMeta('polygon');
        meta.shape = '〰️ Lasso';

        const geometry: Geometry = { type: 'polygon', data: { points: loop, closed: true } };
        const newDraft: DraftShape = { id: this.createDraftId('lasso'), meta, geometry };
        this.draftShapes.push(newDraft);

        this.draftFreehandCurrent = { points: [], drawing: false };
        this.addDraftShapeToKanban(newDraft);
        this.clearRemoteFeedback();
        this.persistWorkspaceState();
        this.drawAnnotationsOnly();
        return;
      }

      this.draftFreehandCurrent = { points: [], drawing: false };
      this.clearRemoteFeedback();
      this.persistWorkspaceState();
      this.drawAnnotationsOnly();
    }
  }

  private snapshotMeta(kind: Geometry['type']): AnnotationMeta {
    const sev = this.selectedSeverity();
    const scls: AnnotationMeta['scls'] = this.severityToClass(sev);
    const shape = kind === 'bbox' ? '🟥 BBox' : kind === 'polygon' ? '🔷 Polygon' : '〰️ Tracé libre';

    return { def: this.annotationType(), sev, scls, desc: this.annotationDesc(), shape };
  }

  private createDraftId(prefix: string): string {
    const id = `${prefix}_${this.nextDraftId}`;
    this.nextDraftId += 1;
    return id;
  }

  private addDraftShapeToKanban(draft: DraftShape): void {
    const imageId = this.currentImage()?.id ?? 'unknown';
    const added = this.addKanbanItem({
      source: 'draft',
      dirty: true,
      imageId,
      draftId: draft.id,
      geometry: JSON.parse(JSON.stringify(draft.geometry)) as Geometry,
      meta: JSON.parse(JSON.stringify(draft.meta)) as AnnotationMeta,
    });

    if (!added) {
      this.draftShapes = this.draftShapes.filter((item) => item.id !== draft.id);
      this.persistWorkspaceState();
      this.drawAnnotationsOnly();
    }
  }

  private severityToClass(sev: SeverityUi): AnnotationMeta['scls'] {
    return sev === 'Critique' ? 'tag-red' : sev === 'Majeur' ? 'tag-orange' : 'tag-cyan';
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
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private normToPixel(p: NormPoint): { x: number; y: number } {
    return {
      x: this.imageRenderRect.x + p.nx * this.imageRenderRect.w,
      y: this.imageRenderRect.y + p.ny * this.imageRenderRect.h,
    };
  }

  private fileTypeLabel(mime: string): string {
    const short = (mime || '').replace('image/', '').toUpperCase();
    return short || 'IMG';
  }

  private formatBytes(bytes: number): string {
    const kb = 1024;
    const mb = kb * 1024;
    if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
    if (bytes >= kb) return `${(bytes / kb).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  private tryBuildPolygonFromFreehand(points: NormPoint[]): NormPoint[] | null {
    if (points.length < 3) return null;

    const firstPx = this.normToPixel(points[0]);
    const lastPx = this.normToPixel(points[points.length - 1]);
    const d = Math.hypot(lastPx.x - firstPx.x, lastPx.y - firstPx.y);
    if (d <= this.CLOSE_TOL_PX) return [...points, points[0]];

    for (let i = 0; i < points.length - 3; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      for (let j = i + 2; j < points.length - 1; j++) {
        if (i === 0 && j === points.length - 2) continue;

        const q1 = points[j];
        const q2 = points[j + 1];

        const I = this.segmentIntersection(p1, p2, q1, q2);
        if (I) {
          const middle = points.slice(i + 1, j + 1);
          return [I, ...middle, I];
        }
      }
    }

    return null;
  }

  private segmentIntersection(a1: NormPoint, a2: NormPoint, b1: NormPoint, b2: NormPoint): NormPoint | null {
    const x1 = a1.nx, y1 = a1.ny;
    const x2 = a2.nx, y2 = a2.ny;
    const x3 = b1.nx, y3 = b1.ny;
    const x4 = b2.nx, y4 = b2.ny;

    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-10) return null;

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / den;

    const eps = 1e-6;
    if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;

    const ix = x1 + t * (x2 - x1);
    const iy = y1 + t * (y2 - y1);
    return { nx: Math.min(1, Math.max(0, ix)), ny: Math.min(1, Math.max(0, iy)) };
  }
}

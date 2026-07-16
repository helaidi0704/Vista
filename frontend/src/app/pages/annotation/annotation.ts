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
import { catchError, delay, firstValueFrom, map, Observable, of, throwError, timeout } from 'rxjs';

import { API_BASE_URL } from '../../core/api-config';

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
  id: string;
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
  baseAnnotationId?: string;
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

interface PersistedAnnotationWorkspaceV3 {
  version: 4;
  currentImageId: string | null;
  imageOrderIds: string[];
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
  id: string;
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

interface CreatedAnnotationRefDto {
  workId: string;
  id: string;
}

interface SaveAnnotationsResponseDto {
  success: boolean;
  requestId: string;
  createdWorkIds: string[];
  updatedWorkIds: string[];
  failedWorkIds: string[];
  backendMessage: string;
  receivedAt: string;
  created: CreatedAnnotationRefDto[];
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

interface DeleteImageConfirmState {
  visible: boolean;
  imageId: string | null;
  imageName: string;
}

interface VisualLimitDialogState {
  visible: boolean;
  message: string;
}

type PanelMode = 'idle' | 'create' | 'edit-base' | 'edit-draft';
type BBoxEditHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface DeletePersistedAnnotationResponseDto {
  success: boolean;
  id: string;
  receivedAt: string;
}

interface BBoxEditState {
  workId: string;
  handle: BBoxEditHandle;
  startPointer: NormPoint;
  startBBox: BBox;
}

type ImageCardStatus = 'pending' | 'draft' | 'ready';

interface RegisterImageResponseDto {
  success: boolean;
  requestId: string;
  savedImage: ImageModel;
  backendMessage: string;
  receivedAt: string;
}

interface DeleteImageResponseDto {
  success: boolean;
  requestId: string;
  deletedImageId: string;
  backendMessage: string;
  receivedAt: string;
}

interface UndoState {
  draftShapes: DraftShape[];
  draftRectCurrent: { start: NormPoint; end: NormPoint; dragging: boolean } | null;
  draftPolygonCurrent: { points: NormPoint[]; closed: boolean };
  polygonPreview: NormPoint | null;
  draftFreehandCurrent: { points: NormPoint[]; drawing: boolean };
  currentWorkId: string | null;
  currentWorkItem: KanbanWorkItem | null;
  backgroundKanbanItems: KanbanWorkItem[];
}

/* Backend list response DTOs — match GET /api/images and GET /api/images/{id}/annotations */
interface ListImagesResponseDto {
  success: boolean;
  images: {
    id: string; name: string; format: string;
    size: number | null; width: number; height: number;
    status: string; createdAt: string; src: string;
  }[];
}

interface ListAnnotationsResponseDto {
  success: boolean;
  annotations: {
    id: string; imageId: string; defectLabel: string;
    severity: SeverityUi; description: string;
    geometryType: string; geometry: SaveGeometryDto;
    createdAt: string; updatedAt: string;
  }[];
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
  @ViewChild('imageCanvas') imageCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawCanvas') drawCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput', { static: true }) fileInput!: ElementRef<HTMLInputElement>;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = inject(API_BASE_URL);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly STORAGE_KEY = 'vista.viewer.annotation.workspace.v4';
  private readonly MAX_VISUAL_ITEMS = 10;

  private readonly USE_MOCK_API = false;

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

  imageFileName = signal('');
  imageFileMeta = signal('');

  currentImage = signal<ImageModel | null>(null);
  imageList = signal<ImageModel[]>([]);

  isSavingRemote = signal(false);
  remoteSaveSuccess = signal<string | null>(null);
  remoteSaveError = signal<string | null>(null);

  saveToast = signal<SaveToastState>({
    visible: false,
    kind: 'success',
    message: '',
  });

  deleteImageConfirm = signal<DeleteImageConfirmState>({
    visible: false,
    imageId: null,
    imageName: '',
  });

  visualLimitDialog = signal<VisualLimitDialogState>({
    visible: false,
    message: '',
  });

  kanbanItems = signal<KanbanWorkItem[]>([]);
  currentWorkId = signal<string | null>(null);

  imageAnnotations = signal<AnnotationItem[]>([]);
  hoveredAnnotId = signal<string | null>(null);

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
  private nextDraftId = 1;
  private readonly BBOX_HANDLE_HIT_RADIUS_PX = 10;
  private readonly BBOX_MIN_SIZE = 0.003;
  private bboxEditState: BBoxEditState | null = null;
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

    this.clearUndoRedoHistory();
    this.bboxEditState = null;

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

      const hadLocalState = this.isBrowser && this.restoreWorkspaceFromStorage();

      if (hadLocalState) {
        const img = this.currentImage();
        if (img) {
          this.loadImageFromSrc(img.src, true);
        } else {
          this.drawBaseImage();
          this.drawAnnotationsOnly();
        }
        // Reconcile local state with backend: prune images that no longer exist on the server.
        this.reconcileLocalStateWithBackend();
      } else {
        this.loadImagesFromBackend();
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
    const changed = this.currentTool() !== tool;
    if (changed) {
      this.clearUndoRedoHistory();
      this.bboxEditState = null;
    }

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
    this.setTool('pan');
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

  hoverAnnotation(id: string, isEnter: boolean): void {
    this.hoveredAnnotId.set(isEnter ? id : null);
    this.drawAnnotationsOnly();
  }

  editAnnotation(id: string): void {
    this.clearRemoteFeedback();
    this.focusBaseAnnotation(id);
  }

  draftCount(): number {
    return this.localDraftWorkItemsCount();
  }

  panelMode(): PanelMode {
    const current = this.currentWorkItem();
    if (!current) return this.hasInProgressShape() ? 'create' : 'idle';
    if (this.isWorkItemDraftMode(current)) return 'edit-draft';
    return 'edit-base';
  }

  panelModeLabel(): string {
    const mode = this.panelMode();
    const current = this.currentWorkItem();

    if (mode === 'edit-base') {
      const id = current?.baseAnnotationId;
      return id != null ? `Édition annotation #${id}` : 'Édition annotation base';
    }

    if (mode === 'edit-draft') {
      if (current?.source === 'base' && current.baseAnnotationId != null) {
        return `Brouillon de mise à jour #${current.baseAnnotationId}`;
      }
      return current ? `Édition brouillon ${this.kanbanBadgeLabel(current)}` : 'Édition brouillon';
    }

    if (mode === 'create') return 'Création de brouillon';
    return 'Aucune annotation sélectionnée';
  }

  panelModeDescription(): string {
    const mode = this.panelMode();
    const current = this.currentWorkItem();

    if (mode === 'edit-base') {
      return "L'annotation base courante est sélectionnée. Toute modification locale la fera repasser en brouillon jusqu'à la prochaine sauvegarde en base.";
    }

    if (mode === 'edit-draft') {
      if (current?.source === 'base') {
        return "Cette annotation base a été modifiée localement et est maintenant en brouillon de mise à jour jusqu'à la prochaine sauvegarde en base.";
      }
      return "Ce brouillon peut être modifié localement jusqu'à la prochaine sauvegarde en base.";
    }

    if (mode === 'create') {
      return "Un dessin est en cours ou un brouillon vient d'être créé. Finalisez-le puis enregistrez-le.";
    }

    return "Sélectionnez une annotation existante ou dessinez une nouvelle annotation.";
  }

  isRectGeometryEditable(): boolean {
    const current = this.currentWorkItem();
    return !!current && this.currentTool() === 'rect' && current.geometry.type === 'bbox' && !!this.currentImage();
  }

  cursorStyle(): string {
    if (!this.currentImage()) return 'default';

    if (this.currentTool() === 'pan') return this.isPanning ? 'grabbing' : 'grab';

    if (this.currentTool() === 'rect' && this.isRectGeometryEditable()) {
      return this.bboxEditState ? 'grabbing' : 'crosshair';
    }

    switch (this.currentTool()) {
      case 'rect':
      case 'polygon':
      case 'freehand':
      default:
        return 'crosshair';
    }
  }

  openImagePicker(): void {
    if (!this.canAddMoreImages()) {
      this.showSaveToast('error', 'Limite de 2 images atteinte.');
      return;
    }
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    if (!this.canAddMoreImages()) {
      this.showSaveToast('error', 'Limite de 2 images atteinte.');
      const inputLimit = event.target as HTMLInputElement;
      inputLimit.value = '';
      return;
    }

    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const src = reader.result;

      const imgEl = new Image();
      imgEl.onload = () => {
        this.registerImageCandidate(file, src, imgEl.width, imgEl.height);
      };
      imgEl.onerror = () => {
        this.handleSaveFailure("L'ajout de l'image ne s'est pas fait.");
      };
      imgEl.src = src;
    };
    reader.readAsDataURL(file);

    input.value = '';
  }

  allImages(): ImageModel[] {
    return this.imageList().slice(0, 2);
  }

  canAddMoreImages(): boolean {
    return this.imageList().length < 2;
  }

  isCurrentImageCard(imageId: string): boolean {
    return this.currentImage()?.id === imageId;
  }

  private imageBaseCount(imageId: string): number {
    const state = this.readWorkspaceState();
    return state?.annotationsByImageId?.[imageId]?.length ?? (this.currentImage()?.id === imageId ? this.imageAnnotations().length : 0);
  }

  private imageDraftCount(imageId: string): number {
    const state = this.readWorkspaceState();
    const isCurrent = this.currentImage()?.id === imageId;

    if (isCurrent) {
      return this.localDraftCountWithInProgress();
    }

    const persistedDraft = state?.draftsByImageId?.[imageId];
    const persistedKanbanItems = state?.kanbanByImageId?.[imageId]?.items ?? [];
    const persistedDraftItemsCount = persistedKanbanItems.filter((item) => this.isWorkItemDraftMode(item)).length;

    if (!persistedDraft) {
      return persistedDraftItemsCount;
    }

    const hasPartial =
      !!persistedDraft.draftRectCurrent?.dragging ||
      (persistedDraft.draftPolygonCurrent?.points?.length ?? 0) > 0 ||
      persistedDraft.draftFreehandCurrent?.drawing;

    return persistedDraftItemsCount + (hasPartial ? 1 : 0);
  }

  imageCardStatus(imageId: string): ImageCardStatus {
    const baseCount = this.imageBaseCount(imageId);
    const draftCount = this.imageDraftCount(imageId);

    if (draftCount > 0) return 'draft';
    if (baseCount > 0) return 'ready';
    return 'pending';
  }

  imageCardClasses(image: ImageModel): string {
    return this.imageCardStatus(image.id) === 'draft'
      ? 'image-kanban-card image-kanban-card-draft'
      : this.imageCardStatus(image.id) === 'ready'
        ? 'image-kanban-card image-kanban-card-ready'
        : 'image-kanban-card image-kanban-card-pending';
  }

  imageCardIcon(imageId: string): string {
    const status = this.imageCardStatus(imageId);
    if (status === 'draft') return '✎';
    if (status === 'ready') return '✔';
    return '⏳';
  }

  imageCardCounts(imageId: string): string {
    return `B:${this.imageBaseCount(imageId)} · D:${this.imageDraftCount(imageId)}`;
  }

  imageCardName(image: ImageModel): string {
    return image.name;
  }

  private syncImageListFromWorkspace(state: PersistedAnnotationWorkspaceV3 | null): void {
    if (!state) {
      this.imageList.set([]);
      return;
    }

    const ordered = (state.imageOrderIds ?? [])
      .map((id) => state.images[id])
      .filter((img): img is ImageModel => !!img);

    this.imageList.set(ordered);
  }

  private clearCurrentImageContextOnly(): void {
    this.currentImage.set(null);
    this.imageAnnotations.set([]);
    this.clearDraftsNoHistory();
    this.kanbanItems.set([]);
    this.currentWorkId.set(null);
    this.hoveredAnnotId.set(null);
    this.zoom.set(100);
    this.panOffset.set({ x: 0, y: 0 });
    this.loadedImageObj = null;
    this.imageRenderRect = { x: 0, y: 0, w: 0, h: 0 };
    this.selectedSeverity.set('Mineur');
    this.annotationType.set('Rayure profonde');
    this.annotationDesc.set('');
    this.imageFileName.set('Aucune image sélectionnée');
    this.imageFileMeta.set('—');
    this.bboxEditState = null;
    this.clearUndoRedoHistory();
    this.drawBaseImage();
    this.drawAnnotationsOnly();
  }

  selectImageById(imageId: string): void {
    this.clearRemoteFeedback();
    this.clearUndoRedoHistory();
    this.bboxEditState = null;
    this.persistWorkspaceState();

    const state = this.readWorkspaceState();
    if (!state) return;

    const img = state.images?.[imageId];
    if (!img) return;

    this.currentImage.set(img);
    this.imageAnnotations.set((state.annotationsByImageId?.[img.id] ?? []).map((a) => ({ ...a, imageId: a.imageId ?? img.id })));
    this.zoom.set(state.viewByImageId?.[img.id]?.zoom ?? 100);
    this.panOffset.set(state.viewByImageId?.[img.id]?.panOffset ?? { x: 0, y: 0 });
    this.applyDraftState(state.draftsByImageId?.[img.id]);
    this.applyEditorState(state.editorByImageId?.[img.id]);
    this.applyKanbanState(state.kanbanByImageId?.[img.id]);
    this.syncNextDraftId();
    this.imageFileName.set(img.name);
    this.imageFileMeta.set(`${img.format} · ${img.width}x${img.height}${img.size != null ? ` · ${this.formatBytes(img.size)}` : ''}`);
    this.persistWorkspaceState();
    this.loadImageFromSrc(img.src, true);
  }

  private selectLoadedImage(image: ImageModel): void {
    this.currentImage.set(image);

    const state = this.readWorkspaceState();

    this.imageAnnotations.set(
      (state?.annotationsByImageId?.[image.id] ?? []).map((annotation) => ({
        ...annotation,
        imageId: annotation.imageId ?? image.id,
      })),
    );

    this.zoom.set(state?.viewByImageId?.[image.id]?.zoom ?? 100);
    this.panOffset.set(state?.viewByImageId?.[image.id]?.panOffset ?? { x: 0, y: 0 });

    this.applyDraftState(state?.draftsByImageId?.[image.id]);
    this.applyEditorState(state?.editorByImageId?.[image.id]);
    this.applyKanbanState(state?.kanbanByImageId?.[image.id]);

    this.syncNextDraftId();

    this.imageFileName.set(image.name);
    this.imageFileMeta.set(
      `${image.format} · ${image.width}x${image.height}${image.size != null ? ` · ${this.formatBytes(image.size)}` : ''}`,
    );

    this.persistWorkspaceState();
    this.loadImageFromSrc(image.src, true);
    this.refreshAnnotationsForImage(image.id);
  }

  private appendImageAndSelect(image: ImageModel): void {
    this.imageList.update((list) => {
      const idx = list.findIndex((img) => img.id === image.id);
      if (idx >= 0) {
        const updated = [...list];
        updated[idx] = image;
        return updated;
      }
      return [...list, image];
    });

    this.selectLoadedImage(image);
  }

  requestDeleteImage(imageId: string, event?: Event): void {
    event?.stopPropagation();

    const target = this.imageList().find((img) => img.id === imageId);
    if (!target) return;

    this.deleteImageConfirm.set({
      visible: true,
      imageId: target.id,
      imageName: target.name,
    });
  }

  cancelDeleteImage(): void {
    this.deleteImageConfirm.set({
      visible: false,
      imageId: null,
      imageName: '',
    });
  }

  confirmDeleteImage(): void {
    const imageId = this.deleteImageConfirm().imageId;
    if (!imageId) {
      this.cancelDeleteImage();
      return;
    }

    this.cancelDeleteImage();
    this.deleteImage(imageId);
  }

  showVisualLimitDialog(): void {
    this.visualLimitDialog.set({
      visible: true,
      message: 'Limite de 10 éléments atteinte dans le visuel. Supprimez un élément existant avant de dessiner une nouvelle annotation.',
    });
  }

  closeVisualLimitDialog(): void {
    this.visualLimitDialog.set({
      visible: false,
      message: '',
    });
  }

  private deleteImage(imageId: string): void {
    this.clearRemoteFeedback();
    this.isSavingRemote.set(true);

    this.deleteImageRequest$(imageId).subscribe({
      next: (response) => {
        if (!response.success) {
          this.handleSaveFailure("La suppression de l'image ne s'est pas faite.");
          return;
        }

        const deletingCurrent = this.currentImage()?.id === imageId;

        this.imageList.update((list) => list.filter((img) => img.id !== imageId));

        const prev = this.readWorkspaceState();
        const remainingIds = new Set(this.imageList().map((img) => img.id));

        const nextState: PersistedAnnotationWorkspaceV3 = {
          version: 4,
          currentImageId: deletingCurrent ? null : (prev?.currentImageId ?? this.currentImage()?.id ?? null),
          imageOrderIds: this.imageList().map((img) => img.id),
          images: {},
          annotationsByImageId: {},
          viewByImageId: {},
          draftsByImageId: {},
          editorByImageId: {},
          kanbanByImageId: {},
        };

        for (const id of remainingIds) {
          if (prev?.images?.[id]) nextState.images[id] = prev.images[id];
          if (prev?.annotationsByImageId?.[id]) nextState.annotationsByImageId[id] = prev.annotationsByImageId[id];
          if (prev?.viewByImageId?.[id]) nextState.viewByImageId[id] = prev.viewByImageId[id];
          if (prev?.draftsByImageId?.[id]) nextState.draftsByImageId[id] = prev.draftsByImageId[id];
          if (prev?.editorByImageId?.[id]) nextState.editorByImageId[id] = prev.editorByImageId[id];
          if (prev?.kanbanByImageId?.[id]) nextState.kanbanByImageId[id] = prev.kanbanByImageId[id];
        }

        try {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(nextState));
        } catch {
          // ignore
        }

        if (deletingCurrent) {
          this.clearCurrentImageContextOnly();
        } else {
          this.persistWorkspaceState();
        }

        this.clearUndoRedoHistory();
        this.showSaveToast('success', 'Image supprimée.');
      },
      error: () => {
        this.handleSaveFailure("La suppression de l'image ne s'est pas faite.");
        this.isSavingRemote.set(false);
      },
      complete: () => {
        this.isSavingRemote.set(false);
      },
    });
  }

  private registerImageCandidate(file: File, src: string, width: number, height: number): void {
    if (!this.canAddMoreImages()) {
      this.showSaveToast('error', 'Limite de 2 images atteinte.');
      return;
    }

    const candidate: ImageModel = {
      id: this.newImageId('upload'),
      name: file.name,
      src,
      format: this.fileTypeLabel(file.type),
      size: file.size,
      width,
      height,
      createdAt: new Date().toISOString(),
    };

    this.isSavingRemote.set(true);
    this.clearRemoteFeedback();

    this.registerImageRequest$(candidate).subscribe({
      next: (response) => {
        if (!response.success) {
          this.handleSaveFailure("L'ajout de l'image ne s'est pas fait.");
          return;
        }

        this.appendImageAndSelect(response.savedImage);
        this.showSaveToast('success', 'Image ajoutée.');
      },
      error: () => {
        this.handleSaveFailure("L'ajout de l'image ne s'est pas fait.");
        this.isSavingRemote.set(false);
      },
      complete: () => {
        this.isSavingRemote.set(false);
      },
    });
  }



  private saveAnnotationsRequest$(dto: SaveAnnotationsRequestDto): Observable<SaveAnnotationsResponseDto> {
    return this.USE_MOCK_API ? this.saveToBackendDryRun$(dto) : this.saveToBackendHttp$(dto);
  }

  private registerImageRequest$(image: ImageModel): Observable<RegisterImageResponseDto> {
    return this.USE_MOCK_API ? this.registerImageDryRun$(image) : this.registerImageHttp$(image);
  }

  private deleteImageRequest$(imageId: string): Observable<DeleteImageResponseDto> {
    return this.USE_MOCK_API ? this.deleteImageDryRun$(imageId) : this.deleteImageHttp$(imageId);
  }

  private deletePersistedAnnotationRequest$(id: string): Observable<DeletePersistedAnnotationResponseDto> {
    return this.USE_MOCK_API
      ? this.deletePersistedAnnotationDryRun$(id)
      : this.deletePersistedAnnotationHttp$(id);
  }

  private listImagesRequest$(): Observable<ListImagesResponseDto> {
    return this.USE_MOCK_API
      ? this.listImagesDryRun$()
      : this.http.get<ListImagesResponseDto>(`${this.apiBaseUrl}/api/images`).pipe(timeout(10000));
  }

  private listAnnotationsRequest$(imageId: string): Observable<ListAnnotationsResponseDto> {
    return this.USE_MOCK_API
      ? this.listAnnotationsDryRun$(imageId)
      : this.http
          .get<ListAnnotationsResponseDto>(`${this.apiBaseUrl}/api/images/${imageId}/annotations`)
          .pipe(timeout(10000));
  }

  private registerImageDryRun$(image: ImageModel): Observable<RegisterImageResponseDto> {
    return of({
      success: true,
      requestId: this.createRequestId(),
      savedImage: image,
      backendMessage: 'Mock: image enregistrée (dry-run).',
      receivedAt: new Date().toISOString(),
    } satisfies RegisterImageResponseDto).pipe(delay(150));
  }

  private deleteImageDryRun$(imageId: string): Observable<DeleteImageResponseDto> {
    return of({
      success: true,
      requestId: this.createRequestId(),
      deletedImageId: imageId,
      backendMessage: 'Mock: image supprimée (dry-run).',
      receivedAt: new Date().toISOString(),
    } satisfies DeleteImageResponseDto).pipe(delay(150));
  }

  private deletePersistedAnnotationDryRun$(id: string): Observable<DeletePersistedAnnotationResponseDto> {
    return of({
      success: true,
      id,
      receivedAt: new Date().toISOString(),
    } satisfies DeletePersistedAnnotationResponseDto).pipe(delay(150));
  }

  private saveToBackendDryRun$(dto: SaveAnnotationsRequestDto): Observable<SaveAnnotationsResponseDto> {
    const created: CreatedAnnotationRefDto[] = dto.creates.map((create) => ({
      workId: create.workId,
      id: this.newImageId('mock_ann'),
    }));

    return of({
      success: true,
      requestId: dto.requestId,
      createdWorkIds: dto.creates.map((create) => create.workId),
      updatedWorkIds: dto.updates.map((update) => update.workId),
      failedWorkIds: [],
      backendMessage: 'Mock: enregistrement effectué (dry-run).',
      receivedAt: new Date().toISOString(),
      created,
    } satisfies SaveAnnotationsResponseDto).pipe(delay(200));
  }

  private listImagesDryRun$(): Observable<ListImagesResponseDto> {
    return of({
      success: true,
      images: [
        {
          id: this.DEFAULT_IMAGE_ID,
          name: this.DEFAULT_IMAGE_NAME,
          format: 'PNG',
          size: null,
          width: 0,
          height: 0,
          status: 'ready',
          createdAt: new Date().toISOString(),
          src: this.DEFAULT_IMAGE_SRC,
        },
      ],
    } satisfies ListImagesResponseDto).pipe(delay(150));
  }

  private listAnnotationsDryRun$(imageId: string): Observable<ListAnnotationsResponseDto> {
    if (imageId !== this.DEFAULT_IMAGE_ID) {
      return of({ success: true, annotations: [] } satisfies ListAnnotationsResponseDto).pipe(delay(100));
    }

    return of({
      success: true,
      annotations: [
        {
          id: 'mock_ann_bbox_1',
          imageId,
          defectLabel: 'Rayure profonde',
          severity: 'Critique',
          description: 'Mock: rayure profonde détectée sur le carter moteur.',
          geometryType: 'bbox',
          geometry: {
            type: 'bbox',
            bbox: { nx: 0.2, ny: 0.2, nw: 0.2, nh: 0.15 },
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'mock_ann_polygon_1',
          imageId,
          defectLabel: "Défaut d'usinage (Bavure)",
          severity: 'Majeur',
          description: 'Mock: bavure détectée en zone de perçage.',
          geometryType: 'polygon',
          geometry: {
            type: 'polygon',
            polygon: {
              points: [
                { nx: 0.55, ny: 0.5 },
                { nx: 0.65, ny: 0.5 },
                { nx: 0.6, ny: 0.6 },
              ],
              closed: true,
            },
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    } satisfies ListAnnotationsResponseDto).pipe(delay(150));
  }

  private registerImageHttp$(image: ImageModel): Observable<RegisterImageResponseDto> {
    return this.http.post<RegisterImageResponseDto>(
      `${this.apiBaseUrl}/api/images`,
      image,
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
        if (!body || body.success !== true || !body.savedImage?.id) {
          throw new Error('Invalid image register response');
        }
        return body;
      }),
      catchError((error: unknown) => {
        console.error('[VISTA][API] registerImage failed', error);
        return throwError(() => new Error('REGISTER_IMAGE_BACKEND_FAILED'));
      }),
    );
  }

  private deleteImageHttp$(imageId: string): Observable<DeleteImageResponseDto> {
    return this.http.delete<DeleteImageResponseDto>(
      `${this.apiBaseUrl}/api/images/${imageId}`,
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
        if (!body || body.success !== true || body.deletedImageId !== imageId) {
          throw new Error('Invalid image delete response');
        }
        return body;
      }),
      catchError((error: unknown) => {
        // If the image is already deleted from the backend (404), treat it as a
        // successful deletion — the caller will clean up localStorage.
        const status = (error as { status?: number })?.status;
        if (status === 404) {
          return of({
            success: true,
            requestId: this.createRequestId(),
            deletedImageId: imageId,
            backendMessage: 'Image was already removed from server.',
            receivedAt: new Date().toISOString(),
          } satisfies DeleteImageResponseDto);
        }
        console.error('[VISTA][API] deleteImage failed', error);
        return throwError(() => new Error('DELETE_IMAGE_BACKEND_FAILED'));
      }),
    );
  }


  private currentWorkItem(): KanbanWorkItem | null {
    const id = this.currentWorkId();
    if (!id) return null;
    return this.kanbanItems().find((item) => item.workId === id) ?? null;
  }

  private toolForGeometry(geometry: Geometry): Tool {
    if (geometry.type === 'bbox') return 'rect';
    if (geometry.type === 'polygon') return 'polygon';
    return 'freehand';
  }

  private toolForWorkItem(item: KanbanWorkItem): Tool {
    if (item.meta.shape.includes('Lasso') || item.meta.shape.includes('Tracé libre')) {
      return 'freehand';
    }

    return this.toolForGeometry(item.geometry);
  }

  private syncToolFromCurrentWork(): void {
    const current = this.currentWorkItem();
    if (!current) return;

    const expectedTool = this.toolForWorkItem(current);

    if (this.currentTool() !== expectedTool) {
      this.currentTool.set(expectedTool);
    }

    this.bboxEditState = null;
    this.polygonPreview = null;
  }

  setCurrentWork(workId: string | null, options: { syncTool?: boolean } = {}): void {
    const changed = this.currentWorkId() !== workId;
    if (changed) {
      this.clearUndoRedoHistory();
    }

    this.bboxEditState = null;
    this.polygonPreview = null;
    this.currentWorkId.set(workId);
    this.syncEditorFromCurrentWork();

    if (options.syncTool !== false) {
      this.syncToolFromCurrentWork();
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
      this.showVisualLimitDialog();
      return null;
    }

    const created: KanbanWorkItem = {
      ...item,
      workId: this.createWorkId(item.source),
      order: this.nextKanbanOrder++,
    };

    this.kanbanItems.update((items) => [...items, created].sort((a, b) => a.order - b.order));
    this.setCurrentWork(created.workId, { syncTool: item.source !== 'draft' });
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

    if (this.bboxEditState?.workId === workId) {
      this.bboxEditState = null;
    }

    if (wasCurrent) this.currentWorkId.set(null);

    this.clearUndoRedoHistory();
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

  private logFocusBaseAnnotation(annotationId: string): void {
    console.log('[VISTA][VISUEL][FOCUS_BASE]', {
      annotationId,
      alreadyInVisual: this.kanbanItems().some((item) => item.source === 'base' && item.baseAnnotationId === annotationId),
      visualCount: this.kanbanItems().length,
    });
  }

  private focusBaseAnnotation(annotationId: string): void {
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

  isBaseRowCurrent(annotationId: string): boolean {
    const current = this.currentWorkItem();
    return !!current && current.source === 'base' && current.baseAnnotationId === annotationId;
  }

  isKanbanCurrent(workId: string): boolean {
    return this.currentWorkId() === workId;
  }

  private isWorkItemDraftMode(item: KanbanWorkItem): boolean {
    return item.source === 'draft' || item.dirty;
  }

  private localDraftWorkItemsCount(): number {
    return this.kanbanItems().filter((item) => this.isWorkItemDraftMode(item)).length;
  }

  private syncEditorFromCurrentWork(): void {
    const current = this.currentWorkItem();
    if (!current) return;

    this.selectedSeverity.set(current.meta.sev);
    this.annotationType.set(current.meta.def);
    this.annotationDesc.set(current.meta.desc);
  }

  hasBaseItemsInKanban(): boolean {
    return this.kanbanItems().some((item) => item.source === 'base');
  }

  saveButtonLabel(): string {
    return 'Enregistrer les modifications';
  }

  kanbanBadgeLabel(item: KanbanWorkItem): string {
    if (item.source === 'base' && item.baseAnnotationId != null) return `#${item.baseAnnotationId}`;
    return `D${item.order}`;
  }

  kanbanSecondaryLabel(item: KanbanWorkItem): string {
    return item.meta.def;
  }

  kanbanItemClasses(item: KanbanWorkItem): string {
    if (item.source === 'base' && !item.dirty) {
      return 'visual-item visual-item-base-neutral';
    }

    return this.isWorkItemDraftMode(item)
      ? 'visual-item visual-item-draft'
      : 'visual-item visual-item-base-neutral';
  }

  private currentHighlightMatchesGeometry(geometry: Geometry, fallbackAnnotationId?: string): boolean {
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

  deletePersistedAnnotation(id: string): void {
    const ann = this.imageAnnotations().find((item) => item.id === id);
    if (!ann) return;

    this.clearRemoteFeedback();
    this.isSavingRemote.set(true);

    this.deletePersistedAnnotationRequest$(id).subscribe({
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
        if (wasCurrent) this.bboxEditState = null;
        this.clearUndoRedoHistory();

        this.showSaveToast('success', 'Annotation supprimée.');
        this.persistWorkspaceState();
        this.drawAnnotationsOnly();
        if (!this.USE_MOCK_API) {
          const ci = this.currentImage();
          if (ci) this.refreshAnnotationsForImage(ci.id);
        }
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
    const currentId = this.currentWorkId();

    return JSON.parse(
      JSON.stringify({
        draftShapes: this.draftShapes,
        draftRectCurrent: this.draftRectCurrent,
        draftPolygonCurrent: this.draftPolygonCurrent,
        polygonPreview: this.polygonPreview,
        draftFreehandCurrent: this.draftFreehandCurrent,
        currentWorkId: currentId,
        currentWorkItem: this.currentWorkItem(),
        backgroundKanbanItems: this.kanbanItems().filter((item) => item.workId !== currentId),
      } satisfies UndoState),
    ) as UndoState;
  }

  private restoreState(state: UndoState): void {
    this.draftShapes = state.draftShapes ?? [];
    this.draftRectCurrent = state.draftRectCurrent ?? null;
    this.draftPolygonCurrent = state.draftPolygonCurrent ?? { points: [], closed: false };
    this.polygonPreview = state.polygonPreview ?? null;
    this.draftFreehandCurrent = state.draftFreehandCurrent ?? { points: [], drawing: false };

    const restoredCurrentId = state.currentWorkId ?? null;
    const restoredCurrentItem = state.currentWorkItem
      ? this.cloneGeometry(state.currentWorkItem)
      : null;
    const backgroundItems = (state.backgroundKanbanItems ?? []).map((item) => this.cloneGeometry(item));

    const nextItems = restoredCurrentId && restoredCurrentItem
      ? [...backgroundItems, restoredCurrentItem]
      : [...backgroundItems];

    this.kanbanItems.set(nextItems.sort((a, b) => a.order - b.order));

    if (restoredCurrentId && restoredCurrentItem) {
      this.currentWorkId.set(restoredCurrentId);
      this.syncEditorFromCurrentWork();
    } else {
      this.currentWorkId.set(null);
    }

    this.syncToolFromCurrentWork();
    this.bboxEditState = null;
    this.drawAnnotationsOnly();
  }

  private pushHistory(): void {
    this.undoStack.push(this.snapshotState());
    this.redoStack = [];
    if (this.undoStack.length > 80) this.undoStack.shift();
  }

  private clearUndoRedoHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private beginShortUndoRedoScope(): void {
    this.clearUndoRedoHistory();
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    if (!this.currentImage()) {
      this.clearUndoRedoHistory();
      return;
    }

    const current = this.snapshotState();
    this.redoStack.push(current);

    const prev = this.undoStack.pop();
    if (prev) this.restoreState(prev);

    this.clearRemoteFeedback();
    this.persistWorkspaceState();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    if (!this.currentImage()) {
      this.clearUndoRedoHistory();
      return;
    }

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

    this.bboxEditState = null;
    this.clearUndoRedoHistory();
  }

  resetDrafts(): void {
    this.clearUndoRedoHistory();

    this.clearDraftsNoHistory();

    this.kanbanItems.update((items) =>
      items.filter((item) => !(item.source === 'draft' || item.dirty)),
    );

    this.currentWorkId.set(null);
    this.bboxEditState = null;
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
      const response = await firstValueFrom(this.saveAnnotationsRequest$(dto));

      if (!response.success) {
        this.handleSaveFailure("L'enregistrement ne s'est pas fait.");
        return;
      }

      this.applySaveResponse(response);
      const remaining = this.kanbanItems().length;
      this.remoteSaveSuccess.set(remaining === 0 ? 'Enregistrement préparé.' : 'Enregistrement partiel préparé.');
      this.showSaveToast(remaining === 0 ? 'success' : 'error', remaining === 0 ? 'Enregistrement réussi.' : 'Enregistrement partiel : certains éléments restent dans le kanban.');
      if (!this.USE_MOCK_API) {
        const currentId = this.currentImage()?.id;
        if (currentId) this.refreshAnnotationsForImage(currentId);
      }

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

  downloadAnnotationsJson(): void {
    const image = this.currentImage();
    const annotations = this.imageAnnotations();
    if (!image || annotations.length === 0) return;

    const exportData = {
      image: {
        id: image.id,
        name: image.name,
        format: image.format,
        size: image.size ?? null,
        width: image.width,
        height: image.height,
        createdAt: image.createdAt,
      },
      metadata: {
        annotationCount: annotations.length,
        source: 'imageAnnotations',
      },
      exportDate: new Date().toISOString(),
      annotations: annotations.map((annotation) => ({
        id: annotation.id,
        imageId: annotation.imageId,
        shape: annotation.shape,
        defectLabel: annotation.def,
        severity: annotation.sev,
        description: annotation.desc,
        geometry: annotation.geometry,
      })),
    };

    this.downloadTextFile(
      `annotations_${this.annotationExportFileNameBase(image)}.json`,
      JSON.stringify(exportData, null, 2),
      'application/json;charset=utf-8',
    );
  }

  downloadAnnotationsCsv(): void {
    const image = this.currentImage();
    const annotations = this.imageAnnotations();
    if (!image || annotations.length === 0) return;

    const header = [
      'id',
      'imageId',
      'shape',
      'defectLabel',
      'severity',
      'description',
      'geometryType',
      'geometry',
    ];
    const rows = annotations.map((annotation) => [
      annotation.id,
      annotation.imageId,
      annotation.shape,
      annotation.def,
      annotation.sev,
      annotation.desc,
      annotation.geometry.type,
      JSON.stringify(annotation.geometry),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => this.escapeCsvCell(cell)).join(','))
      .join('\n');

    this.downloadTextFile(
      `annotations_${this.annotationExportFileNameBase(image)}.csv`,
      csv,
      'text/csv;charset=utf-8',
    );
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

  private applySaveResponse(response: SaveAnnotationsResponseDto): void {
    const items = this.kanbanItems();
    const failed = new Set(response.failedWorkIds);
    const cleanBaseWorkIds = items
      .filter((item) => item.source === 'base' && !item.dirty && !failed.has(item.workId))
      .map((item) => item.workId);
    const succeeded = new Set([...response.createdWorkIds, ...response.updatedWorkIds, ...cleanBaseWorkIds]);
    const successfulItems = items.filter((item) => succeeded.has(item.workId) && !failed.has(item.workId));
    const createdIdByWorkId = new Map(response.created.map((ref) => [ref.workId, ref.id]));

    const createdAnnotations: AnnotationItem[] = [];
    const updatedById = new Map<string, KanbanWorkItem>();

    for (const item of successfulItems) {
      if (item.source === 'draft') {
        const backendId = createdIdByWorkId.get(item.workId);
        if (!backendId) continue;
        createdAnnotations.push({
          id: backendId,
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
    this.currentWorkId.set(null);
    this.bboxEditState = null;
    this.clearUndoRedoHistory();
  }

  private deletePersistedAnnotationHttp$(id: string): Observable<DeletePersistedAnnotationResponseDto> {
    return this.http.delete<DeletePersistedAnnotationResponseDto>(
      `${this.apiBaseUrl}/api/annotations/${id}`,
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

  private saveToBackendHttp$(dto: SaveAnnotationsRequestDto): Observable<SaveAnnotationsResponseDto> {
    return this.http.post<SaveAnnotationsResponseDto>(
      `${this.apiBaseUrl}/api/images/save-annotations`,
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

  private localDraftCountWithInProgress(): number {
    return this.localDraftWorkItemsCount() + (this.hasInProgressShape() ? 1 : 0);
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

    this.syncEditorFromCurrentWork();
    this.syncToolFromCurrentWork();
  }

  private readWorkspaceState(): PersistedAnnotationWorkspaceV3 | null {
    if (!this.isBrowser) return null;
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PersistedAnnotationWorkspaceV3>;
      if (parsed.version !== 4) return null;
      if (!Array.isArray(parsed.imageOrderIds)) return null;
      if (!parsed.images || !parsed.annotationsByImageId || !parsed.viewByImageId || !parsed.draftsByImageId || !parsed.editorByImageId || !parsed.kanbanByImageId) {
        return null;
      }
      return parsed as PersistedAnnotationWorkspaceV3;
    } catch {
      return null;
    }
  }

  private persistWorkspaceState(): void {
    if (!this.isBrowser) return;
    const prev = this.readWorkspaceState();

    const current = this.currentImage();
    const list = this.imageList();
    const imageIds = new Set(list.map((img) => img.id));

    const images: Record<string, ImageModel> = {};
    const annotationsByImageId: Record<string, AnnotationItem[]> = {};
    const viewByImageId: Record<string, { zoom: number; panOffset: { x: number; y: number } }> = {};
    const draftsByImageId: Record<string, PersistedDraftState> = {};
    const editorByImageId: Record<string, PersistedEditorState> = {};
    const kanbanByImageId: Record<string, PersistedKanbanState> = {};

    for (const img of list) {
      images[img.id] = img;
      annotationsByImageId[img.id] = prev?.annotationsByImageId?.[img.id] ?? [];
      viewByImageId[img.id] = prev?.viewByImageId?.[img.id] ?? { zoom: 100, panOffset: { x: 0, y: 0 } };
      draftsByImageId[img.id] = prev?.draftsByImageId?.[img.id] ?? this.emptyDraftState();
      editorByImageId[img.id] = prev?.editorByImageId?.[img.id] ?? this.currentEditorState();
      kanbanByImageId[img.id] = prev?.kanbanByImageId?.[img.id] ?? { items: [], currentWorkId: null, nextOrder: 1 };
    }

    if (current && imageIds.has(current.id)) {
      images[current.id] = current;
      annotationsByImageId[current.id] = this.imageAnnotations();
      viewByImageId[current.id] = {
        zoom: this.zoom(),
        panOffset: this.panOffset(),
      };
      draftsByImageId[current.id] = this.currentDraftState();
      editorByImageId[current.id] = this.currentEditorState();
      kanbanByImageId[current.id] = this.currentKanbanState();
    }

    const state: PersistedAnnotationWorkspaceV3 = {
      version: 4,
      currentImageId: current?.id ?? null,
      imageOrderIds: list.map((img) => img.id),
      images,
      annotationsByImageId,
      viewByImageId,
      draftsByImageId,
      editorByImageId,
      kanbanByImageId,
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

    this.resetTransientAnnotationState();
    this.syncImageListFromWorkspace(state);

    if (!state.currentImageId) {
      this.clearCurrentImageContextOnly();
      return this.imageList().length > 0;
    }

    const img = state.images[state.currentImageId];
    if (!img) {
      this.clearCurrentImageContextOnly();
      return this.imageList().length > 0;
    }

    this.currentImage.set(img);
    this.zoom.set(state.viewByImageId?.[img.id]?.zoom ?? 100);
    this.panOffset.set(state.viewByImageId?.[img.id]?.panOffset ?? { x: 0, y: 0 });

    const ann = state.annotationsByImageId?.[img.id] ?? [];
    this.imageAnnotations.set(ann.map((a) => ({ ...a, imageId: a.imageId ?? img.id })));

    this.applyDraftState(state.draftsByImageId?.[img.id]);
    this.applyEditorState(state.editorByImageId?.[img.id]);
    this.applyKanbanState(state.kanbanByImageId?.[img.id]);

    this.syncNextDraftId();

    this.imageFileName.set(img.name);
    this.imageFileMeta.set(`${img.format} · ${img.width}x${img.height}${img.size != null ? ` · ${this.formatBytes(img.size)}` : ''}`);

    return true;
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
    return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  }

  private createRequestId(): string {
    return `req_${Date.now()}_${crypto.randomUUID().slice(0, 12)}`;
  }

  private createWorkId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
  }

  private loadImagesFromBackend(): void {
    if (!this.isBrowser) return;
    this.listImagesRequest$()
      .subscribe({
        next: (response) => {
          if (!response.success || !response.images) return;
          const images: ImageModel[] = response.images.map((item) => ({
            id: item.id, name: item.name, src: item.src,
            format: item.format, size: item.size ?? undefined,
            width: item.width, height: item.height,
            createdAt: item.createdAt,
          }));
          this.imageList.set(images);
          if (images.length > 0) {
            this.selectLoadedImage(images[0]);
          }
        },
        error: (err: unknown) => console.error('[VISTA] Failed to load images from backend', err),
      });
  }

  /**
   * After restoring workspace from localStorage, validate that each locally cached
   * image still exists on the backend. Stale images (deleted from DB but still in
   * localStorage) are pruned silently.
   */
  private reconcileLocalStateWithBackend(): void {
    if (!this.isBrowser) return;
    this.listImagesRequest$().subscribe({
      next: (response) => {
        if (!response?.images) return;
        const backendIds = new Set(response.images.map((img) => img.id));
        const localImages = this.imageList();
        const staleIds = localImages.filter((img) => !backendIds.has(img.id)).map((img) => img.id);

        if (staleIds.length === 0) return;

        // Remove stale images from signal
        this.imageList.update((list) => list.filter((img) => !staleIds.includes(img.id)));

        // If the current image is stale, clear it
        const current = this.currentImage();
        if (current && staleIds.includes(current.id)) {
          this.clearCurrentImageContextOnly();
          const remaining = this.imageList();
          if (remaining.length > 0) {
            this.selectLoadedImage(remaining[0]);
          }
        }

        // Prune stale entries from localStorage
        this.purgeStaleEntriesFromStorage(staleIds);
      },
      error: () => {
        // Backend unreachable — keep local state as-is.
      },
    });
  }

  private purgeStaleEntriesFromStorage(staleIds: string[]): void {
    const state = this.readWorkspaceState();
    if (!state) return;

    const remainingIds = new Set(
      state.imageOrderIds.filter((id) => !staleIds.includes(id)),
    );

    const nextState: PersistedAnnotationWorkspaceV3 = {
      ...state,
      currentImageId: state.currentImageId && !staleIds.includes(state.currentImageId)
        ? state.currentImageId
        : (remainingIds.size > 0 ? [...remainingIds][0] : null),
      imageOrderIds: [...remainingIds],
      images: Object.fromEntries(
        Object.entries(state.images).filter(([id]) => !staleIds.includes(id)),
      ),
      annotationsByImageId: Object.fromEntries(
        Object.entries(state.annotationsByImageId).filter(([id]) => !staleIds.includes(id)),
      ),
      viewByImageId: Object.fromEntries(
        Object.entries(state.viewByImageId).filter(([id]) => !staleIds.includes(id)),
      ),
      draftsByImageId: Object.fromEntries(
        Object.entries(state.draftsByImageId).filter(([id]) => !staleIds.includes(id)),
      ),
      editorByImageId: Object.fromEntries(
        Object.entries(state.editorByImageId).filter(([id]) => !staleIds.includes(id)),
      ),
      kanbanByImageId: Object.fromEntries(
        Object.entries(state.kanbanByImageId).filter(([id]) => !staleIds.includes(id)),
      ),
    };

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(nextState));
    } catch {
      // ignore
    }
  }

  private refreshAnnotationsForImage(imageId: string): void {
    this.listAnnotationsRequest$(imageId)
      .subscribe({
        next: (response) => {
          if (!response.success) return;
          const annotations: AnnotationItem[] = response.annotations.map((ann) => ({
            id: ann.id, imageId: ann.imageId,
            shape: this.geometryShapeLabel(ann.geometryType),
            def: ann.defectLabel, sev: ann.severity,
            scls: this.severityToClass(ann.severity),
            desc: ann.description,
            geometry: this.backendGeometryToLocal(ann.geometry),
          }));
          this.imageAnnotations.set(annotations);
          this.persistWorkspaceState();
          this.drawAnnotationsOnly();
        },
        error: (err: unknown) => console.error('[VISTA] Failed to refresh annotations', err),
      });
  }

  private geometryShapeLabel(geometryType: string): string {
    if (geometryType === 'bbox') return '🟥 BBox';
    if (geometryType === 'polygon') return '🔷 Polygon';
    return '〰️ Tracé libre';
  }

  private backendGeometryToLocal(dto: SaveGeometryDto): Geometry {
    if (dto.type === 'bbox' && 'bbox' in dto) {
      return { type: 'bbox', data: dto.bbox };
    }
    if (dto.type === 'polygon' && 'polygon' in dto) {
      return { type: 'polygon', data: dto.polygon as PolygonData };
    }
    return { type: 'freehand', data: (dto as { freehand: FreehandData }).freehand };
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

      this.setupDrawingInteraction();
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
    if (!this.isBrowser) return;

    const container = document.getElementById('image-container');
    if (!container) return;

    const imgCanvas = this.imageCanvas?.nativeElement;
    const drawCanvas = this.drawCanvas?.nativeElement;
    if (!imgCanvas || !drawCanvas) {
      this.imageRenderRect = { x: 0, y: 0, w: 0, h: 0 };
      return;
    }

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
    const drawCanvas = this.drawCanvas?.nativeElement;
    if (!drawCanvas) return;

    const ctx = drawCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    if (this.imageRenderRect.w === 0) return;

    const baseWorkItems = this.kanbanItems().filter((item) => item.source === 'base');

    for (const ann of this.imageAnnotations()) {
      const workItem = baseWorkItems.find((item) => item.baseAnnotationId === ann.id);

      const visualClass: 'tag-red' | 'tag-orange' | 'tag-cyan' | 'draft' | 'base-neutral' =
        workItem
          ? (workItem.dirty ? workItem.meta.scls : 'base-neutral')
          : ann.scls;

      this.drawGeometry(
        ctx,
        workItem?.geometry ?? ann.geometry,
        ann.id,
        visualClass,
        workItem?.meta.def ?? ann.def,
        false,
      );
    }

    for (const item of this.kanbanItems().filter((workItem) => workItem.source === 'draft')) {
      this.drawGeometry(
        ctx,
        item.geometry,
        null,
        item.meta.scls,
        item.meta.def,
        true,
      );
    }

    if (this.draftRectCurrent?.dragging) {
      const bbox = this.rectToBbox(this.draftRectCurrent.start, this.draftRectCurrent.end);
      if (bbox) this.drawGeometry(ctx, { type: 'bbox', data: bbox }, null, 'draft', 'Draft', true);
    }

    if (this.draftPolygonCurrent.points.length > 0) {
      this.drawDraftPolygonOverlay(ctx);
    }

    if (this.draftFreehandCurrent.drawing && this.draftFreehandCurrent.points.length > 1) {
      const geometry: Geometry = {
        type: 'freehand',
        data: { points: this.draftFreehandCurrent.points, closed: false },
      };
      this.drawGeometry(ctx, geometry, null, 'draft', 'Draft', true);
    }

    this.drawCurrentBBoxHandles(ctx);
  }

  private drawGeometry(
    ctx: CanvasRenderingContext2D,
    geometry: Geometry,
    annId: string | null,
    sevClass: 'tag-red' | 'tag-orange' | 'tag-cyan' | 'draft' | 'base-neutral',
    label: string,
    isDraft: boolean,
  ): void {
    const highlighted =
      (!isDraft && this.hoveredAnnotId() === annId) ||
      this.currentHighlightMatchesGeometry(geometry, !isDraft && annId != null ? annId : undefined);

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

  private getColors(sevClass: 'tag-red' | 'tag-orange' | 'tag-cyan' | 'draft' | 'base-neutral'): { main: string; fill: string } {
    if (sevClass === 'draft') return { main: '#E06C00', fill: 'rgba(224,108,0,0.12)' };
    if (sevClass === 'base-neutral') return { main: '#9CA3AF', fill: 'rgba(156,163,175,0.16)' };
    if (sevClass === 'tag-red') return { main: '#FF453A', fill: 'rgba(255,69,58,0.2)' };
    if (sevClass === 'tag-orange') return { main: '#FFD60A', fill: 'rgba(255,214,10,0.2)' };
    return { main: '#00C7BE', fill: 'rgba(0,199,190,0.15)' };
  }

  private setupDrawingInteraction(): void {
    const canvas = this.drawCanvas?.nativeElement;
    if (!canvas) return;

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
    if (!this.currentImage()) return;

    const tool = this.currentTool();

    if (tool === 'rect' && this.isRectGeometryEditable()) {
      const handle = this.hitTestCurrentBBoxHandle(e);
      const current = this.currentBBoxWorkItem();
      if (handle && current && current.geometry.type === 'bbox') {
        const point = this.pixelToNorm(e);
        if (!point) return;

        this.beginShortUndoRedoScope();
        this.pushHistory();
        this.clearRemoteFeedback();
        this.bboxEditState = {
          workId: current.workId,
          handle,
          startPointer: point,
          startBBox: this.cloneGeometry(current.geometry.data),
        };

        this.drawCanvas?.nativeElement.setPointerCapture?.(e.pointerId);
        this.drawAnnotationsOnly();
        return;
      }
    }

    if (tool === 'pan') {
      if (this.imageRenderRect.w === 0) this.drawBaseImage();

      const p = this.pointerToCanvasPosition(e);
      this.isPanning = true;
      this.panStart = { x: p.x, y: p.y };
      const off = this.panOffset();
      this.panStartOffset = { x: off.x, y: off.y };
      this.drawCanvas?.nativeElement.setPointerCapture?.(e.pointerId);
      this.drawBaseImage();
      this.drawAnnotationsOnly();
      return;
    }

    if (!this.canAddVisualItem()) {
      this.clearRemoteFeedback();
      this.draftRectCurrent = null;
      this.draftPolygonCurrent = { points: [], closed: false };
      this.polygonPreview = null;
      this.draftFreehandCurrent = { points: [], drawing: false };
      this.showVisualLimitDialog();
      this.drawAnnotationsOnly();
      return;
    }

    if (this.imageRenderRect.w === 0) this.drawBaseImage();

    const point = this.pixelToNorm(e);
    if (!point) return;

    this.drawCanvas?.nativeElement.setPointerCapture?.(e.pointerId);

    if (tool === 'rect') {
      this.beginShortUndoRedoScope();
      this.clearRemoteFeedback();
      this.draftRectCurrent = { start: point, end: point, dragging: true };
      this.persistWorkspaceState();
      this.drawAnnotationsOnly();
      return;
    }

    if (tool === 'polygon') {
      if (this.draftPolygonCurrent.closed) return;

      if (this.draftPolygonCurrent.points.length === 0) {
        this.beginShortUndoRedoScope();
      }

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

    this.beginShortUndoRedoScope();
    this.clearRemoteFeedback();
    this.pushHistory();
    this.draftFreehandCurrent = { points: [point], drawing: true };
    this.persistWorkspaceState();
    this.drawAnnotationsOnly();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.currentImage()) return;
    if (this.imageRenderRect.w === 0) return;

    if (this.bboxEditState) {
      const point = this.pixelToNorm(e);
      if (!point) return;

      const nextBBox = this.resizeBBoxFromHandle(
        this.bboxEditState.startBBox,
        this.bboxEditState.handle,
        point,
        this.bboxEditState.startPointer,
      );

      this.updateWorkGeometry(this.bboxEditState.workId, { type: 'bbox', data: nextBBox });
      return;
    }

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
    if (!this.currentImage()) return;

    this.drawCanvas?.nativeElement.releasePointerCapture?.(e.pointerId);

    if (this.bboxEditState) {
      this.bboxEditState = null;
      this.persistWorkspaceState();
      this.drawAnnotationsOnly();
      return;
    }

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

  private currentBBoxWorkItem(): KanbanWorkItem | null {
    const current = this.currentWorkItem();
    if (!current || current.geometry.type !== 'bbox') return null;
    return current;
  }

  private currentBBoxData(): BBox | null {
    const item = this.currentBBoxWorkItem();
    return item?.geometry.type === 'bbox' ? item.geometry.data : null;
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private cloneGeometry<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private syncDraftGeometry(workId: string, geometry: Geometry): void {
    const work = this.kanbanItems().find((item) => item.workId === workId);
    if (!work?.draftId) return;
    this.draftShapes = this.draftShapes.map((draft) =>
      draft.id === work.draftId
        ? {
            ...draft,
            geometry: this.cloneGeometry(geometry),
          }
        : draft,
    );
  }

  private updateWorkGeometry(workId: string, geometry: Geometry): void {
    this.kanbanItems.update((items) =>
      items.map((item) =>
        item.workId === workId
          ? {
              ...item,
              dirty: true,
              geometry: this.cloneGeometry(geometry),
            }
          : item,
      ),
    );

    this.syncDraftGeometry(workId, geometry);
    this.persistWorkspaceState();
    this.drawAnnotationsOnly();
  }

  private bboxHandleCenters(bbox: BBox): Record<Exclude<BBoxEditHandle, 'move'>, { x: number; y: number }> {
    const ix = this.imageRenderRect.x;
    const iy = this.imageRenderRect.y;
    const iw = this.imageRenderRect.w;
    const ih = this.imageRenderRect.h;

    const x1 = ix + bbox.nx * iw;
    const y1 = iy + bbox.ny * ih;
    const x2 = ix + (bbox.nx + bbox.nw) * iw;
    const y2 = iy + (bbox.ny + bbox.nh) * ih;

    return {
      nw: { x: x1, y: y1 },
      ne: { x: x2, y: y1 },
      sw: { x: x1, y: y2 },
      se: { x: x2, y: y2 },
    };
  }

  private hitTestCurrentBBoxHandle(e: PointerEvent): BBoxEditHandle | null {
    const bbox = this.currentBBoxData();
    if (!bbox || this.imageRenderRect.w === 0) return null;

    const p = this.pointerToCanvasPosition(e);
    const centers = this.bboxHandleCenters(bbox);

    for (const handle of ['nw', 'ne', 'sw', 'se'] as const) {
      const c = centers[handle];
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d <= this.BBOX_HANDLE_HIT_RADIUS_PX) return handle;
    }

    const ix = this.imageRenderRect.x + bbox.nx * this.imageRenderRect.w;
    const iy = this.imageRenderRect.y + bbox.ny * this.imageRenderRect.h;
    const iw = bbox.nw * this.imageRenderRect.w;
    const ih = bbox.nh * this.imageRenderRect.h;

    if (p.x >= ix && p.x <= ix + iw && p.y >= iy && p.y <= iy + ih) return 'move';
    return null;
  }

  private resizeBBoxFromHandle(start: BBox, handle: BBoxEditHandle, pointer: NormPoint, startPointer: NormPoint): BBox {
    const startX1 = start.nx;
    const startY1 = start.ny;
    const startX2 = start.nx + start.nw;
    const startY2 = start.ny + start.nh;

    const dx = pointer.nx - startPointer.nx;
    const dy = pointer.ny - startPointer.ny;

    if (handle === 'move') {
      const nx = this.clamp01(start.nx + dx);
      const ny = this.clamp01(start.ny + dy);
      const boundedX = Math.min(nx, 1 - start.nw);
      const boundedY = Math.min(ny, 1 - start.nh);
      return { nx: boundedX, ny: boundedY, nw: start.nw, nh: start.nh };
    }

    let x1 = startX1;
    let y1 = startY1;
    let x2 = startX2;
    let y2 = startY2;

    if (handle === 'nw' || handle === 'sw') x1 = this.clamp01(startX1 + dx);
    if (handle === 'ne' || handle === 'se') x2 = this.clamp01(startX2 + dx);
    if (handle === 'nw' || handle === 'ne') y1 = this.clamp01(startY1 + dy);
    if (handle === 'sw' || handle === 'se') y2 = this.clamp01(startY2 + dy);

    if (x2 - x1 < this.BBOX_MIN_SIZE) {
      if (handle === 'nw' || handle === 'sw') x1 = x2 - this.BBOX_MIN_SIZE;
      else x2 = x1 + this.BBOX_MIN_SIZE;
    }

    if (y2 - y1 < this.BBOX_MIN_SIZE) {
      if (handle === 'nw' || handle === 'ne') y1 = y2 - this.BBOX_MIN_SIZE;
      else y2 = y1 + this.BBOX_MIN_SIZE;
    }

    x1 = this.clamp01(x1);
    y1 = this.clamp01(y1);
    x2 = this.clamp01(x2);
    y2 = this.clamp01(y2);

    return {
      nx: x1,
      ny: y1,
      nw: Math.max(this.BBOX_MIN_SIZE, x2 - x1),
      nh: Math.max(this.BBOX_MIN_SIZE, y2 - y1),
    };
  }

  private drawCurrentBBoxHandles(ctx: CanvasRenderingContext2D): void {
    if (!this.isRectGeometryEditable()) return;
    const bbox = this.currentBBoxData();
    if (!bbox) return;

    const centers = this.bboxHandleCenters(bbox);

    ctx.save();
    for (const key of ['nw', 'ne', 'sw', 'se'] as const) {
      const c = centers[key];
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00C7BE';
      ctx.stroke();
    }
    ctx.restore();
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
    const canvas = this.drawCanvas?.nativeElement;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
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

  private annotationExportFileNameBase(image: ImageModel): string {
    const withoutExtension = image.name.replace(/\.[^/.\\]+$/, '');
    const cleaned = withoutExtension
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return cleaned || image.id;
  }

  private escapeCsvCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private downloadTextFile(fileName: string, content: string, mimeType: string): void {
    if (!this.isBrowser) return;

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 0);
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

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x1 - x2)) / den;
    const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / den;

    const eps = 1e-6;
    if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;

    const ix = x1 + t * (x2 - x1);
    const iy = y1 + t * (y2 - y1);
    return { nx: Math.min(1, Math.max(0, ix)), ny: Math.min(1, Math.max(0, iy)) };
  }
}

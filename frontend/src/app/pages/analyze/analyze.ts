import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { AnalyzeService, ImageLibraryItem, SUPPORTED_EXTENSIONS, mimeToFormat } from './analyze.service';

type PickerSlot = 'target' | 'reference';

interface CoherenceIssue {
  field: string;
  target: string;
  reference: string;
}

interface DiffStats {
  maxDiff: number;
  meanDiff: number;
  changedPct: number;
}

@Component({
  selector: 'app-analyze',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './analyze.html',
  styleUrls: ['./analyze.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyzeComponent implements OnInit {
  private readonly service = inject(AnalyzeService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  readonly supportedExtensions = SUPPORTED_EXTENSIONS;

  readonly analysisTabs = [
    'Comparaison Côte à Côte',
    'Superposition (Difference)',
    'Analyse Spectrale (FFT)',
    'Data Augmentation Test',
    'Extraction Contours (Sobel/Canny)',
  ];

  readonly activeTab = signal(this.analysisTabs[0]);

  // Library
  readonly images = signal<ImageLibraryItem[]>([]);
  readonly loading = signal(false);

  // Selected images
  readonly targetImage = signal<ImageLibraryItem | null>(null);
  readonly referenceImage = signal<ImageLibraryItem | null>(null);

  // Image load errors
  readonly targetLoadError = signal(false);
  readonly referenceLoadError = signal(false);

  // Picker state
  readonly showPicker = signal(false);
  readonly pickerSlot = signal<PickerSlot>('target');

  // Local file upload state
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);

  // ── Superposition (Difference) ─────────────────────────────────────────────
  readonly diffImageUrl   = signal<string | null>(null);
  readonly diffStats = signal<DiffStats | null>(null);
  readonly computingDiff = signal(false);
  readonly diffError = signal<string | null>(null);
  readonly diffAmplification = signal(3);
  readonly diffGrayscale = signal(false);

  // Pixel cache (diff) — avoid reloading from API on every slider tick
  private pixelData1: Uint8ClampedArray | null = null;
  private pixelData2: Uint8ClampedArray | null = null;
  private cachedW = 0;
  private cachedH = 0;
  private cachedTargetId: string | null = null;
  private cachedRefId: string | null = null;
  private cachedGrayscale: boolean | null = null;

  // ── Analyse Spectrale (FFT 2D) ────────────────────────────────────────────
  readonly fftImageUrl  = signal<string | null>(null);
  readonly computingFft = signal(false);
  readonly fftError     = signal<string | null>(null);
  readonly fftSlot      = signal<'target' | 'reference'>('target');
  readonly fftSize      = signal<number>(256);

  // ── Extraction Contours (Sobel / Canny) ───────────────────────────────────
  readonly contourImageUrl  = signal<string | null>(null);
  readonly computingContour = signal(false);
  readonly contourError     = signal<string | null>(null);
  readonly contourMethod    = signal<'sobel' | 'canny'>('sobel');
  readonly contourThreshold = signal(80);
  readonly contourSlot      = signal<'target' | 'reference'>('target');

  // Pixel cache (contour) — single image
  private contourPixels: Uint8ClampedArray | null = null;
  private contourW = 0;
  private contourH = 0;
  private contourCachedId: string | null = null;

  // Coherence validation
  readonly coherenceIssues = computed<CoherenceIssue[]>(() => {
    const t = this.targetImage();
    const r = this.referenceImage();
    if (!t || !r) return [];

    const issues: CoherenceIssue[] = [];
    if (t.width !== r.width || t.height !== r.height) {
      issues.push({
        field: 'Dimensions',
        target: `${t.width}×${t.height}px`,
        reference: `${r.width}×${r.height}px`,
      });
    }
    if (t.format !== r.format) {
      issues.push({ field: 'Format', target: t.format, reference: r.format });
    }
    return issues;
  });

  constructor() {
    // Effect 1: reload images when images or grayscale change (network round-trip)
    effect(() => {
      const onDiffTab = this.activeTab() === this.analysisTabs[1];
      const target = this.targetImage();
      const ref = this.referenceImage();
      const gray = this.diffGrayscale();

      if (!onDiffTab) return;

      if (!target || !ref) {
        this.clearDiffState();
        return;
      }

      // Check if cache is still valid
      if (
        target.id === this.cachedTargetId &&
        ref.id === this.cachedRefId &&
        gray === this.cachedGrayscale &&
        this.pixelData1 && this.pixelData2
      ) {
        // Cache hit — just reapply math
        this.applyDiffMath();
        return;
      }

      if (this.isBrowser) this.loadAndComputeDiff(target, ref, gray);
    });

    // Effect 2: slider changes — reapply math instantly (no network, uses cache)
    effect(() => {
      this.diffAmplification(); // track dependency
      if (this.pixelData1 && this.pixelData2 && this.isBrowser) this.applyDiffMath();
    });

    // Effect 3: FFT tab — load + compute on tab/image/slot/size change
    effect(() => {
      const onTab = this.activeTab() === this.analysisTabs[2];
      const slot  = this.fftSlot();
      const size  = this.fftSize();
      const img   = slot === 'target' ? this.targetImage() : this.referenceImage();

      if (!onTab) return;
      if (!img) { this.fftImageUrl.set(null); this.fftError.set(null); return; }
      if (this.isBrowser) this.loadAndComputeFft(img, size);
    });

    // Effect 4: contour tab — load image and compute on tab/image/slot change
    effect(() => {
      const onTab = this.activeTab() === this.analysisTabs[4];
      const slot  = this.contourSlot();
      const img   = slot === 'target' ? this.targetImage() : this.referenceImage();

      if (!onTab) return;
      if (!img) { this.clearContourState(); return; }

      if (img.id === this.contourCachedId && this.contourPixels && this.isBrowser) {
        this.applyContourMath();
        return;
      }
      if (this.isBrowser) this.loadAndComputeContour(img);
    });

    // Effect 4: method/threshold changes — reapply contour math instantly
    effect(() => {
      this.contourMethod();    // track
      this.contourThreshold(); // track
      if (this.contourPixels && this.isBrowser) this.applyContourMath();
    });
  }

  ngOnInit(): void {
    this.loadLibrary();
  }

  loadLibrary(): void {
    this.loading.set(true);
    this.service.getImages().subscribe({
      next: imgs => { this.images.set(imgs); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  // ── Picker ─────────────────────────────────────────────────────────────────

  openPicker(slot: PickerSlot): void {
    this.pickerSlot.set(slot);
    this.uploadError.set(null);
    this.showPicker.set(true);
  }

  closePicker(): void { this.showPicker.set(false); }

  selectImage(image: ImageLibraryItem): void {
    if (this.pickerSlot() === 'target') {
      this.targetImage.set(image);
      this.targetLoadError.set(false);
    } else {
      this.referenceImage.set(image);
      this.referenceLoadError.set(false);
    }
    this.showPicker.set(false);
  }

  triggerFileInput(): void {
    this.uploadError.set(null);
    this.fileInputRef.nativeElement.value = '';
    this.fileInputRef.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const format = mimeToFormat(file.type);
    if (!format) {
      this.uploadError.set(`Format non supporté : ${file.type || file.name.split('.').pop()}. Utilisez JPG, PNG ou WEBP.`);
      return;
    }

    this.uploading.set(true);
    this.uploadError.set(null);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        this.service.uploadImage({
          name: file.name,
          src: dataUrl,
          format,
          width: img.naturalWidth,
          height: img.naturalHeight,
          size: file.size,
        }).subscribe({
          next: uploaded => {
            this.images.update(list => [uploaded, ...list]);
            this.selectImage(uploaded);
            this.uploading.set(false);
          },
          error: (err) => {
            const msg = err?.error?.backendMessage ?? 'Erreur lors de l\'upload.';
            this.uploadError.set(msg);
            this.uploading.set(false);
          },
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  clearTarget(): void { this.targetImage.set(null); this.targetLoadError.set(false); }
  clearReference(): void { this.referenceImage.set(null); this.referenceLoadError.set(false); }

  onTargetError(): void { this.targetLoadError.set(true); }
  onReferenceError(): void { this.referenceLoadError.set(true); }

  switchTab(tab: string): void { this.activeTab.set(tab); }

  imageUrl(src: string): string { return this.service.imageFileUrl(src); }

  onAmpChange(event: Event): void {
    this.diffAmplification.set(+(event.target as HTMLInputElement).value);
  }

  onGrayscaleChange(event: Event): void {
    this.diffGrayscale.set((event.target as HTMLInputElement).checked);
  }

  onContourThresholdChange(event: Event): void {
    this.contourThreshold.set(+(event.target as HTMLInputElement).value);
  }

  formatSize(bytes: number | null): string {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  // Public: force reload and recompute (Recalculer button)
  computeDifference(): void {
    const t = this.targetImage();
    const r = this.referenceImage();
    if (!t || !r || !this.isBrowser) return;
    this.cachedTargetId = null; // invalidate cache to force reload
    this.loadAndComputeDiff(t, r, this.diffGrayscale());
  }

  // ── Superposition: two-layer diff computation ──────────────────────────────

  // Layer 1 — load images and extract pixel data (network, run once per image pair)
  private async loadAndComputeDiff(
    t: ImageLibraryItem,
    r: ImageLibraryItem,
    gray: boolean
  ): Promise<void> {
    this.computingDiff.set(true);
    this.diffError.set(null);

    try {
      const [img1, img2] = await Promise.all([
        this.loadImageViaBlobUrl(this.imageUrl(t.src)),
        this.loadImageViaBlobUrl(this.imageUrl(r.src)),
      ]);

      const W = img1.naturalWidth;
      const H = img1.naturalHeight;

      const c1 = this.drawOffscreen(img1, W, H, gray);
      const c2 = this.drawOffscreen(img2, W, H, gray);

      this.pixelData1 = c1.getContext('2d')!.getImageData(0, 0, W, H).data;
      this.pixelData2 = c2.getContext('2d')!.getImageData(0, 0, W, H).data;
      this.cachedW = W;
      this.cachedH = H;
      this.cachedTargetId = t.id;
      this.cachedRefId = r.id;
      this.cachedGrayscale = gray;

      this.applyDiffMath();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[Diff]', err);
      this.diffError.set(`Erreur : ${detail}`);
      this.diffImageUrl.set(null);
      this.diffStats.set(null);
    } finally {
      this.computingDiff.set(false);
    }
  }

  // Layer 2 — pixel math only (instant, no network, uses cached data)
  private applyDiffMath(): void {
    if (!this.pixelData1 || !this.pixelData2) return;

    const W = this.cachedW;
    const H = this.cachedH;
    const amp = this.diffAmplification();
    const d1 = this.pixelData1;
    const d2 = this.pixelData2;

    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d')!;
    const imgData = ctx.createImageData(W, H);

    let maxDiff = 0, totalDiff = 0, changedPixels = 0;
    const threshold = 10;

    for (let i = 0; i < d1.length; i += 4) {
      const diff = Math.max(
        Math.abs(d1[i]     - d2[i]),
        Math.abs(d1[i + 1] - d2[i + 1]),
        Math.abs(d1[i + 2] - d2[i + 2]),
      );
      const v = Math.min(255, diff * amp);
      imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = v;
      imgData.data[i + 3] = 255;

      if (diff > maxDiff) maxDiff = diff;
      totalDiff += diff;
      if (diff > threshold) changedPixels++;
    }

    ctx.putImageData(imgData, 0, 0);
    this.diffImageUrl.set(out.toDataURL('image/png'));
    this.diffStats.set({
      maxDiff,
      meanDiff: totalDiff / (W * H),
      changedPct: (changedPixels / (W * H)) * 100,
    });
  }

  private clearDiffState(): void {
    this.pixelData1 = null;
    this.pixelData2 = null;
    this.cachedTargetId = null;
    this.cachedRefId = null;
    this.diffImageUrl.set(null);
    this.diffStats.set(null);
    this.diffError.set(null);
  }

  private drawOffscreen(img: HTMLImageElement, w: number, h: number, grayscale: boolean): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    if (grayscale) ctx.filter = 'grayscale(1)';
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  }

  // Fetch via XHR → blob URL: canvas can read pixel data without CORS taint
  private async loadImageViaBlobUrl(url: string): Promise<HTMLImageElement> {
    const response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(blobUrl); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error(`Impossible de charger : ${url}`)); };
      img.src = blobUrl;
    });
  }

  // ── Analyse Spectrale FFT 2D ──────────────────────────────────────────────

  private async loadAndComputeFft(item: ImageLibraryItem, N: number): Promise<void> {
    this.computingFft.set(true);
    this.fftError.set(null);
    try {
      const img = await this.loadImageViaBlobUrl(this.imageUrl(item.src));
      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;
      const c = this.drawOffscreen(img, srcW, srcH, true);
      const srcData = c.getContext('2d')!.getImageData(0, 0, srcW, srcH).data;

      // Zero-padded N×N real/imag arrays; center the source image
      const re = new Float32Array(N * N);
      const im = new Float32Array(N * N);
      const copyW = Math.min(srcW, N);
      const copyH = Math.min(srcH, N);
      const ox = Math.floor((N - copyW) / 2);
      const oy = Math.floor((N - copyH) / 2);
      for (let y = 0; y < copyH; y++)
        for (let x = 0; x < copyW; x++)
          re[(y + oy) * N + (x + ox)] = srcData[(y * srcW + x) * 4];

      this.fft2D(re, im, N);

      // Log-magnitude spectrum
      const mag = new Float32Array(N * N);
      let maxM = 0;
      for (let i = 0; i < N * N; i++) {
        mag[i] = Math.log1p(Math.sqrt(re[i] * re[i] + im[i] * im[i]));
        if (mag[i] > maxM) maxM = mag[i];
      }

      // fftShift: move DC to center
      const shifted = new Float32Array(N * N);
      const h = N >> 1;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++)
          shifted[((y + h) % N) * N + (x + h) % N] = mag[y * N + x];

      // Render with "hot" color map
      const out = document.createElement('canvas');
      out.width = N; out.height = N;
      const ctx = out.getContext('2d')!;
      const id = ctx.createImageData(N, N);
      for (let i = 0; i < N * N; i++) {
        const v = maxM > 0 ? shifted[i] / maxM : 0;
        id.data[i * 4]     = Math.min(255, v * 3 * 255);
        id.data[i * 4 + 1] = Math.min(255, Math.max(0, v * 3 - 1) * 255);
        id.data[i * 4 + 2] = Math.min(255, Math.max(0, v * 3 - 2) * 255);
        id.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      this.fftImageUrl.set(out.toDataURL('image/png'));
    } catch (err) {
      this.fftError.set(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
      this.fftImageUrl.set(null);
    } finally {
      this.computingFft.set(false);
    }
  }

  private fft2D(re: Float32Array, im: Float32Array, N: number): void {
    const row = new Float32Array(N), rowi = new Float32Array(N);
    for (let y = 0; y < N; y++) {
      row.set(re.subarray(y * N, y * N + N));
      rowi.set(im.subarray(y * N, y * N + N));
      this.fft1D(row, rowi);
      re.set(row, y * N); im.set(rowi, y * N);
    }
    const col = new Float32Array(N), coli = new Float32Array(N);
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) { col[y] = re[y * N + x]; coli[y] = im[y * N + x]; }
      this.fft1D(col, coli);
      for (let y = 0; y < N; y++) { re[y * N + x] = col[y]; im[y * N + x] = coli[y]; }
    }
  }

  private fft1D(re: Float32Array, im: Float32Array): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cRe = 1, cIm = 0;
        for (let j = 0; j < len >> 1; j++) {
          const half = i + j + (len >> 1);
          const tRe = cRe * re[half] - cIm * im[half];
          const tIm = cRe * im[half] + cIm * re[half];
          re[half] = re[i + j] - tRe; im[half] = im[i + j] - tIm;
          re[i + j] += tRe; im[i + j] += tIm;
          const nr = cRe * wRe - cIm * wIm; cIm = cRe * wIm + cIm * wRe; cRe = nr;
        }
      }
    }
  }

  // ── Extraction Contours ────────────────────────────────────────────────────

  private async loadAndComputeContour(item: ImageLibraryItem): Promise<void> {
    this.computingContour.set(true);
    this.contourError.set(null);
    try {
      const img = await this.loadImageViaBlobUrl(this.imageUrl(item.src));
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const c = this.drawOffscreen(img, W, H, true); // always grayscale for edge detection
      this.contourPixels = c.getContext('2d')!.getImageData(0, 0, W, H).data;
      this.contourW = W;
      this.contourH = H;
      this.contourCachedId = item.id;
      this.applyContourMath();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.contourError.set(`Erreur : ${detail}`);
      this.contourImageUrl.set(null);
    } finally {
      this.computingContour.set(false);
    }
  }

  private applyContourMath(): void {
    if (!this.contourPixels) return;
    const W = this.contourW;
    const H = this.contourH;
    const src = this.contourPixels;
    const method = this.contourMethod();
    const threshold = this.contourThreshold();

    // Build grayscale float array from R channel (already grayscale)
    const gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = src[i * 4];

    // Optional Gaussian blur (3×3) to reduce noise before edge detection
    const blurred = this.gaussianBlur3x3(gray, W, H);

    // Sobel kernels
    const KX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const KY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    const gx = new Float32Array(W * H);
    const gy = new Float32Array(W * H);
    let maxMag = 0;

    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let sumX = 0, sumY = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const p = blurred[(y + ky) * W + (x + kx)];
            const ki = (ky + 1) * 3 + (kx + 1);
            sumX += p * KX[ki];
            sumY += p * KY[ki];
          }
        }
        gx[y * W + x] = sumX;
        gy[y * W + x] = sumY;
        const mag = Math.sqrt(sumX * sumX + sumY * sumY);
        if (mag > maxMag) maxMag = mag;
      }
    }

    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d')!;
    const imgData = ctx.createImageData(W, H);
    const scale = maxMag > 0 ? 255 / maxMag : 1;

    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const mag = Math.sqrt(gx[y * W + x] ** 2 + gy[y * W + x] ** 2) * scale;
        const idx = (y * W + x) * 4;

        if (method === 'canny') {
          // Simplified Canny: apply threshold + hysteresis-like step
          const v = mag > threshold ? 255 : (mag > threshold * 0.4 ? 128 : 0);
          imgData.data[idx] = imgData.data[idx + 1] = imgData.data[idx + 2] = v;
        } else {
          imgData.data[idx] = imgData.data[idx + 1] = imgData.data[idx + 2] = Math.min(255, mag);
        }
        imgData.data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this.contourImageUrl.set(out.toDataURL('image/png'));
  }

  private gaussianBlur3x3(src: Float32Array, W: number, H: number): Float32Array {
    const K = [1, 2, 1, 2, 4, 2, 1, 2, 1]; // unnormalized 3×3 Gaussian
    const out = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++)
          for (let kx = -1; kx <= 1; kx++)
            sum += src[(y + ky) * W + (x + kx)] * K[(ky + 1) * 3 + (kx + 1)];
        out[y * W + x] = sum / 16;
      }
    }
    return out;
  }

  private clearContourState(): void {
    this.contourPixels = null;
    this.contourCachedId = null;
    this.contourImageUrl.set(null);
    this.contourError.set(null);
  }
}

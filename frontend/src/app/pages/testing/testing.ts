import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface InferenceRecord {
  frame: string;
  verdict: string;
  verdictClass: string;
  details: string;
  model: string;
  time: string;
}

interface ModelOption {
  name: string;
  metrics: {
    label: string;
    value: string;
    color: string;
  }[];
}

@Component({
  selector: 'app-testing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './testing.html',
  styleUrls: ['./testing.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestingComponent implements AfterViewInit {
  @ViewChild('liveImgCanvas', { static: true }) liveImgCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('liveGradcamCanvas', { static: true }) liveGradcamCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput', { static: true }) fileInput!: ElementRef<HTMLInputElement>;

  selectedModel = signal('YOLOv8_Detect_v3 (mAP: 86.4%)');
  cameraRunning = signal(false);
  inferenceHistory = signal<InferenceRecord[]>([
    {
      frame: 'frame_20412.jpg',
      verdict: 'ANORMAL (2)',
      verdictClass: 'tag-red',
      details: 'Bavure (0.94), Rayure (0.68)',
      model: 'YOLOv8_Detect_v3',
      time: '13:28:45.3',
    },
    {
      frame: 'frame_20411.jpg',
      verdict: 'ANORMAL (1)',
      verdictClass: 'tag-red',
      details: 'Bavure (0.92)',
      model: 'YOLOv8_Detect_v3',
      time: '13:28:45.0',
    },
    {
      frame: 'frame_20410.jpg',
      verdict: 'NORMAL',
      verdictClass: 'tag-green',
      details: '—',
      model: 'YOLOv8_Detect_v3',
      time: '13:28:44.7',
    },
  ]);

  models: ModelOption[] = [
    {
      name: 'YOLOv8_Detect_v3 (mAP: 86.4%)',
      metrics: [
        { label: 'Précision (mAP@50)', value: '86.4%', color: 'var(--green)' },
        { label: 'Latence moy.', value: '18 ms', color: 'var(--cyan)' },
        { label: 'Entraîné sur', value: 'Dataset_Carter_Moteur', color: 'var(--text-secondary)' },
        { label: 'Classes de défauts', value: 'Rayure, Fissure, Tâche, Bavure', color: 'var(--text-secondary)' },
      ],
    },
    {
      name: 'ResNet50_Classif_v1 (Acc: 94.2%)',
      metrics: [
        { label: 'Précision (Acc)', value: '94.2%', color: 'var(--green)' },
        { label: 'Latence moy.', value: '12 ms', color: 'var(--cyan)' },
        { label: 'Entraîné sur', value: 'Mixed_Dataset', color: 'var(--text-secondary)' },
        { label: 'Classes de défauts', value: 'OK, Défaut', color: 'var(--text-secondary)' },
      ],
    },
    {
      name: 'UNet_Segmentation_v2 (IoU: 0.81)',
      metrics: [
        { label: 'Précision (IoU)', value: '0.81', color: 'var(--green)' },
        { label: 'Latence moy.', value: '45 ms', color: 'var(--cyan)' },
        { label: 'Entraîné sur', value: 'Segmentation_Set', color: 'var(--text-secondary)' },
        { label: 'Classes de défauts', value: 'All region types', color: 'var(--text-secondary)' },
      ],
    },
  ];

  private inferenceInterval: any = null;

  ngAfterViewInit() {
    setTimeout(() => {
      this.drawLiveInference();
      this.drawLiveGradCAM();
    }, 100);
  }

  toggleCamera() {
    this.cameraRunning.update(v => !v);

    if (this.cameraRunning()) {
      this.startSimulatedInference();
    } else {
      if (this.inferenceInterval) clearInterval(this.inferenceInterval);
    }
  }

  private startSimulatedInference() {
    this.inferenceInterval = setInterval(() => {
      const frames = Date.now().toString().slice(-4);
      const isAnormal = Math.random() > 0.7;
      const verdict = isAnormal ? 'ANORMAL (1)' : 'NORMAL';
      const verdictClass = isAnormal ? 'tag-red' : 'tag-green';
      const details = isAnormal ? 'Rayure (0.74)' : '—';
      const now = new Date();
      const timeStr = now.toISOString().substring(11, 21);

      const newRecord: InferenceRecord = {
        frame: `frame_${frames}.jpg`,
        verdict,
        verdictClass,
        details,
        model: 'YOLOv8_Detect_v3',
        time: timeStr,
      };

      this.inferenceHistory.update(hist => {
        const updated = [newRecord, ...hist];
        if (updated.length > 10) updated.pop();
        return updated;
      });
    }, 1500);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) {
      // Handle file upload
      console.log('File selected:', input.files[0].name);
      input.value = '';
    }
  }

  openFilePicker() {
    this.fileInput.nativeElement.click();
  }

  private drawLiveInference() {
    const canvas = this.liveImgCanvas.nativeElement;
    const parent = canvas.parentElement;
    if (!parent) return;

    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
    canvas.width = cw;
    canvas.height = ch;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fake image rendering (metal part)
    ctx.fillStyle = '#2A2C3A';
    ctx.fillRect(0, 0, cw, ch);

    ctx.strokeStyle = '#555A7A';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(cw / 2, ch / 2 + 20, 80, 0, Math.PI);
    ctx.stroke();

    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cw / 2, ch / 2 - 20, 40, Math.PI, Math.PI * 2);
    ctx.stroke();

    // BBoxes (Défauts détectés)
    ctx.strokeStyle = '#FF4567'; // Rouge (Bavure, Critique)
    ctx.lineWidth = 2;
    ctx.strokeRect(cw / 2 + 60, ch / 2 + 10, 30, 30);
    ctx.fillStyle = 'rgba(255, 69, 103, 0.2)';
    ctx.fillRect(cw / 2 + 60, ch / 2 + 10, 30, 30);
    ctx.fillStyle = '#FF4567';
    ctx.font = 'bold 10px Inter';
    ctx.fillText('Bavure 0.94', cw / 2 + 60, ch / 2 + 6);

    ctx.strokeStyle = '#FF9500'; // Orange (Rayure, Majeur)
    ctx.strokeRect(cw / 2 - 30, ch / 2 - 50, 60, 20);
    ctx.fillStyle = 'rgba(255, 149, 0, 0.15)';
    ctx.fillRect(cw / 2 - 30, ch / 2 - 50, 60, 20);
    ctx.fillStyle = '#FF9500';
    ctx.fillText('Rayure 0.68', cw / 2 - 30, ch / 2 - 54);
  }

  private drawLiveGradCAM() {
    const canvas = this.liveGradcamCanvas.nativeElement;
    const parent = canvas.parentElement;
    if (!parent) return;

    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
    canvas.width = cw;
    canvas.height = ch;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw base shape desaturated
    ctx.fillStyle = '#1A1C25';
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = '#4A4C5A';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(cw / 2, ch / 2 + 20, 80, 0, Math.PI);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cw / 2, ch / 2 - 20, 40, Math.PI, Math.PI * 2);
    ctx.stroke();

    // Heatmap Overlay
    for (let x = 0; x < cw; x += 3) {
      for (let y = 0; y < ch; y += 3) {
        const d1 = Math.pow(x - (cw / 2 + 75), 2) + Math.pow(y - (ch / 2 + 25), 2);
        const val1 = Math.exp(-d1 / 1500) * 0.95;

        const d2 = Math.pow(x - cw / 2, 2) + Math.pow(y - (ch / 2 - 40), 2);
        const val2 = Math.exp(-d2 / 2000) * 0.6;

        const hotspot = val1 + val2;

        if (hotspot > 0.1) {
          const r = Math.round(Math.min(255, hotspot * 350));
          const g = Math.round(Math.max(0, Math.min(255, (1 - hotspot) * 200)));
          const b = Math.round(Math.max(0, (1 - hotspot * 2) * 80));
          ctx.fillStyle = `rgba(${r},${g},${b},${hotspot * 0.8})`;
          ctx.fillRect(x, y, 3, 3);
        }
      }
    }
  }
}

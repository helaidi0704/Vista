import { Component, signal, ViewChild, ElementRef, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface DeployedModel {
  name: string;
  status: 'Actif' | 'Arrêté';
  statusClass: string;
  statusDot: string;
  accuracy: string;
  requests: string;
  target: string;
  uptime: string;
}

interface MonitoringMetric {
  label: string;
  value: string;
  trend: string;
  color: string;
}

@Component({
  selector: 'app-deployment',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './deployment.html',
  styleUrl: './deployment.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeploymentComponent implements OnInit {
  @ViewChild('monitorCanvas') monitorCanvas!: ElementRef<HTMLCanvasElement>;

  deployedModels = signal<DeployedModel[]>([
    {
      name: 'YOLOv8_Detect_v3',
      status: 'Actif',
      statusClass: 'tag-green',
      statusDot: '--green',
      accuracy: '86.4% mAP',
      requests: '5,284 / jour',
      target: 'Edge (TensorRT)',
      uptime: '99.9%',
    },
    {
      name: 'ResNet50_Classif_v1',
      status: 'Actif',
      statusClass: 'tag-green',
      statusDot: '--green',
      accuracy: '94.2% Acc',
      requests: '1,432 / jour',
      target: 'API REST',
      uptime: '100%',
    },
    {
      name: 'UNet_Segmentation_v2',
      status: 'Arrêté',
      statusClass: 'tag-orange',
      statusDot: '--orange',
      accuracy: '0.81 IoU',
      requests: '—',
      target: 'Docker',
      uptime: '—',
    },
  ]);

  selectedModel = signal('YOLOv8_Detect_v3');
  selectedDeployType = signal('API REST (JSON)');
  selectedTimeRange = signal('24h');

  deploymentEndpoint = signal('/api/vision/v1/detect');
  imageFormat = signal('JSON (Base64 JPEG/PNG)');
  resolutionMax = signal('640x640');
  maxBatchSize = signal(8);
  includeGradCAM = signal(true);
  autoAlignment = signal(true);

  deploymentInProgress = signal(false);
  deploymentMessage = signal('');

  monitoringMetrics = signal<MonitoringMetric[]>([
    { label: 'Requêtes / heure', value: '220.3', trend: '+4%', color: '--cyan' },
    { label: 'Latence Inférence', value: '18 ms', trend: '-2 ms', color: '--green' },
    { label: 'Taux False Postives', value: '1.2%', trend: 'stable', color: '--orange' },
    { label: 'Pièces Rejetées', value: '4.8%', trend: '+0.5%', color: '--red' },
  ]);

  deploymentTypeOptions = ['API REST (JSON)', 'TensorRT (Edge)', 'ONNX', 'TFLite', 'Docker Image'];

  ngOnInit(): void {
    setTimeout(() => {
      this.drawMonitorChart();
    }, 100);
  }

  selectDeployType(type: string): void {
    this.selectedDeployType.set(type);
  }

  selectTimeRange(range: string): void {
    this.selectedTimeRange.set(range);
  }

  deployModel(): void {
    this.deploymentInProgress.set(true);
    this.deploymentMessage.set('⏳ Création de l\'API REST…');

    setTimeout(() => {
      this.deploymentMessage.set('✅ API Prête à l\'emploi');
      this.deploymentInProgress.set(false);
    }, 2000);
  }

  private drawMonitorChart(): void {
    const canvas = this.monitorCanvas?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (H * i) / 4);
      ctx.lineTo(W, (H * i) / 4);
      ctx.stroke();
    }

    // Main line chart
    const pts: [number, number][] = [];
    for (let x = 0; x <= W; x += 4) {
      const t = x / W;
      const y = H * 0.6 - Math.sin(t * 12) * H * 0.25 + (Math.random() - 0.5) * H * 0.05;
      pts.push([x, y]);
    }

    // Draw line
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(0,212,255,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Fill area under line
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,212,255,0.05)';
    ctx.fill();

    // Anomaly spikes
    [[200, 0.25], [520, 0.45], [780, 0.18]].forEach(([px, intensity]) => {
      ctx.fillStyle = `rgba(255,69,103,${intensity})`;
      ctx.fillRect(px - 2, 0, 4, H);
    });
  }
}

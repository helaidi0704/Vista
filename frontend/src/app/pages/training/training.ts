import { AfterViewInit, ChangeDetectionStrategy, Component, signal, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface PaletteBlock {
  label: string;
  color: string;
  icon: string;
}

interface TrainingConfig {
  label: string;
  type: 'select' | 'number' | 'range' | 'check' | 'text';
  value: string;
  options?: string[];
  min?: string;
  max?: string;
  step?: string;
}

@Component({
  selector: 'app-training',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './training.html',
  styleUrls: ['./training.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingComponent implements AfterViewInit {
  @ViewChild('pipelineSvg', { static: true }) pipelineSvg!: ElementRef<SVGElement>;

  inputBlocks: PaletteBlock[] = [
    { label: 'Image RGB', color: '#6C63FF', icon: '🖼️' },
    { label: 'Grayscale', color: '#00D4FF', icon: '⚫' },
    { label: 'Masque (Seg)', color: '#00D4FF', icon: '🎭' },
    { label: 'Image Multi-spec', color: '#00D4FF', icon: '🌈' },
  ];

  preprocessBlocks: PaletteBlock[] = [
    { label: 'Resize / Crop', color: '#FF9500', icon: '✂️' },
    { label: 'Normalisation', color: '#FF9500', icon: '⚖️' },
    { label: 'Filtre Sobel/Canny', color: '#FF9500', icon: '🖊️' },
    { label: 'Mixup / Cutmix', color: '#FF9500', icon: '🔀' },
    { label: 'Rotations & Flips', color: '#FF9500', icon: '🔄' },
  ];

  modelBlocks: PaletteBlock[] = [
    { label: 'CNN Custom', color: '#00E5A0', icon: '🧠' },
    { label: 'ResNet50 / 101', color: '#00E5A0', icon: '🌲' },
    { label: 'YOLOv8', color: '#00E5A0', icon: '🎯' },
    { label: 'Vision Transformer', color: '#00E5A0', icon: '⚡' },
    { label: 'U-Net (Seg)', color: '#00E5A0', icon: '🌊' },
    { label: 'Autoencoder', color: '#00E5A0', icon: '🔄' },
  ];

  datasets = ['Dataset_Carter_Moteur (14,247 img)', 'Dataset_Pistons_X (8,300 img)', 'Dataset_Soudures_Laser (21,400 img)'];
  selectedDataset = signal(this.datasets[0]);

  epochs = signal(100);
  batchSize = signal(16);
  learningRate = signal('1e-3');
  modelName = signal('YOLOv8_Detect_v3');

  isTraining = signal(false);
  trainingEpoch = signal(0);
  trainingProgress = signal(23);

  yoloConfig: TrainingConfig[] = [
    { label: 'Variation', type: 'select', value: 'yolov8s', options: ['yolov8n', 'yolov8s', 'yolov8m', 'yolov8l'] },
    { label: 'Classes (Max)', type: 'number', value: '5' },
    { label: 'Init weights', type: 'select', value: 'COCO', options: ['COCO', 'Random', 'Custom'] },
    { label: 'Freezing (Layers)', type: 'number', value: '10' },
    { label: 'Optimizer', type: 'select', value: 'AdamW', options: ['AdamW', 'SGD', 'RMSprop'] },
    { label: 'Mixup Prob', type: 'range', value: '0.2', min: '0', max: '1', step: '0.1' },
    { label: 'Mosaic Prob', type: 'range', value: '0.5', min: '0', max: '1', step: '0.1' },
    { label: 'Warmup Epochs', type: 'number', value: '3' },
    { label: 'Save Checkpoints', type: 'check', value: '1' },
  ];

  ngAfterViewInit() {
    // SVG pipeline will be rendered via template bindings
  }

  launchTraining() {
    this.isTraining.set(true);
    this.trainingEpoch.set(0);
    this.trainingProgress.set(0);

    const interval = setInterval(() => {
      let epoch = this.trainingEpoch() + 2;
      this.trainingEpoch.set(epoch);
      this.trainingProgress.set(epoch);

      if (epoch >= 100) {
        clearInterval(interval);
        this.isTraining.set(false);
      }
    }, 80);
  }

  updateConfigValue(config: TrainingConfig, value: string | boolean) {
    config.value = typeof value === 'boolean' ? (value ? '1' : '0') : value;
  }
}

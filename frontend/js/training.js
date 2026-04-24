/* ==========================================
   Training — Brique 3 (Drag & Drop Pipeline VISTA)
   ========================================== */

function initTraining(container) {
    container.innerHTML = `
  <div class="fade-in" style="display:flex;gap:16px;height:calc(100vh - 120px);">

    <!-- Left: Palette + Config -->
    <div style="display:flex;flex-direction:column;gap:12px;width:260px;flex-shrink:0;overflow-y:auto;">

      <!-- Block palette -->
      <div class="card">
        <div class="card-header" style="margin-bottom:10px;">
          <span class="card-title">🧱 Blocs disponibles</span>
        </div>
        <p class="section-title">Entrée Image</p>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
          ${[
            { label: 'Image RGB', color: '#6C63FF', icon: '🖼️' },
            { label: 'Grayscale', color: '#00D4FF', icon: '⚫' },
            { label: 'Masque (Seg)', color: '#00D4FF', icon: '🎭' },
            { label: 'Image Multi-spec', color: '#00D4FF', icon: '🌈' },
        ].map(b => `
            <div class="palette-block" draggable="true"
              style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;
                border:1px dashed ${b.color}40;background:${b.color}10;cursor:grab;
                font-size:12px;font-weight:500;transition:all 0.15s;"
              onmouseenter="this.style.background='${b.color}25';this.style.borderStyle='solid';"
              onmouseleave="this.style.background='${b.color}10';this.style.borderStyle='dashed';">
              <span>${b.icon}</span>${b.label}
            </div>
          `).join('')}
        </div>
        <p class="section-title">Prétraitement & Augm.</p>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
          ${[
            { label: 'Resize / Crop', color: '#FF9500', icon: '✂️' },
            { label: 'Normalisation', color: '#FF9500', icon: '⚖️' },
            { label: 'Filtre Sobel/Canny', color: '#FF9500', icon: '🖊️' },
            { label: 'Mixup / Cutmix', color: '#FF9500', icon: '🔀' },
            { label: 'Rotations & Flips', color: '#FF9500', icon: '🔄' },
        ].map(b => `
            <div class="palette-block" draggable="true"
              style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;
                border:1px dashed ${b.color}40;background:${b.color}10;cursor:grab;font-size:12px;font-weight:500;transition:all 0.15s;"
              onmouseenter="this.style.background='${b.color}25'"
              onmouseleave="this.style.background='${b.color}10'">
              <span>${b.icon}</span>${b.label}
            </div>
          `).join('')}
        </div>
        <p class="section-title">Modèles Vision</p>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${[
            { label: 'CNN Custom', color: '#00E5A0', icon: '🧠' },
            { label: 'ResNet50 / 101', color: '#00E5A0', icon: '🌲' },
            { label: 'YOLOv8', color: '#00E5A0', icon: '🎯' },
            { label: 'Vision Transformer', color: '#00E5A0', icon: '⚡' },
            { label: 'U-Net (Seg)', color: '#00E5A0', icon: '🌊' },
            { label: 'Autoencoder', color: '#00E5A0', icon: '🔄' },
        ].map(b => `
            <div class="palette-block" draggable="true"
              style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;
                border:1px dashed ${b.color}40;background:${b.color}10;cursor:grab;font-size:12px;font-weight:500;transition:all 0.15s;"
              onmouseenter="this.style.background='${b.color}25'"
              onmouseleave="this.style.background='${b.color}10'">
              <span>${b.icon}</span>${b.label}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Dataset selection -->
      <div class="card">
        <div class="card-header" style="margin-bottom:10px;">
          <span class="card-title">💾 Dataset Image</span>
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">Sélectionner un dataset</label>
          <select class="form-select" style="font-size:12px;">
            <option>Dataset_Carter_Moteur (14,247 img)</option>
            <option>Dataset_Pistons_X (8,300 img)</option>
            <option>Dataset_Soudures_Laser (21,400 img)</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">Split Train / Val / Test</label>
          <div style="display:flex;gap:6px;align-items:center;font-size:12px;">
            <span style="color:var(--accent);">70%</span>
            <div class="progress-bar" style="flex:1;"><div class="progress-fill" style="width:70%;"></div></div>
            <span style="color:var(--cyan);">20%</span>
            <span style="color:var(--text-muted);">10%</span>
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          <span class="tag tag-green">OK: 10,240</span>
          <span class="tag tag-red">Défauts: 4,007</span>
        </div>
      </div>
    </div>

    <!-- Center: Canvas pipeline builder -->
    <div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0;">
      <div class="card" style="flex:1;position:relative;overflow:hidden;">
        <div class="card-header">
          <span class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/></svg>
            Pipeline — Glisser-déposer les blocs
          </span>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm btn-secondary">Effacer</button>
            <button class="btn btn-sm btn-secondary">Importer JSON</button>
            <button class="btn btn-sm btn-secondary">Exporter JSON</button>
          </div>
        </div>
        <!-- SVG pipeline canvas -->
        <svg id="pipeline-svg" style="width:100%;height:calc(100% - 50px);background:var(--bg-input);border-radius:8px;overflow:visible;cursor:move;">
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="rgba(108,99,255,0.8)"/>
            </marker>
          </defs>
          <!-- Grid dots -->
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="rgba(255,255,255,0.05)"/>
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)"/>

          <!-- Block: Image Input -->
          <g transform="translate(30,80)" class="pipeline-block">
            <rect width="130" height="56" rx="10" fill="#1A1D35" stroke="#6C63FF" stroke-width="1.5"/>
            <text x="18" y="22" fill="#8B85FF" font-size="11" font-weight="600" font-family="Inter">🖼️ Image RGB</text>
            <text x="18" y="38" fill="#555A7A" font-size="9" font-family="Inter">W, H = Auto</text>
            <!-- output port -->
            <circle cx="130" cy="28" r="5" fill="#6C63FF" stroke="#0D0E1A" stroke-width="2"/>
          </g>

          <!-- Block: Resize -->
          <g transform="translate(220,40)">
            <rect width="130" height="56" rx="10" fill="#1A1D35" stroke="#FF9500" stroke-width="1.5"/>
            <text x="18" y="22" fill="#FF9500" font-size="11" font-weight="600" font-family="Inter">✂️ Resize</text>
            <text x="18" y="38" fill="#555A7A" font-size="9" font-family="Inter">640x640px</text>
            <circle cx="0" cy="28" r="5" fill="#FF9500" stroke="#0D0E1A" stroke-width="2"/>
            <circle cx="130" cy="28" r="5" fill="#FF9500" stroke="#0D0E1A" stroke-width="2"/>
          </g>

          <!-- Block: Data Aug -->
          <g transform="translate(220,130)">
            <rect width="130" height="56" rx="10" fill="#1A1D35" stroke="#FF9500" stroke-width="1.5"/>
            <text x="18" y="22" fill="#FF9500" font-size="11" font-weight="600" font-family="Inter">🔄 Augmentation</text>
            <text x="18" y="38" fill="#555A7A" font-size="9" font-family="Inter">RandRot, Flip, Hue</text>
            <circle cx="0" cy="28" r="5" fill="#FF9500" stroke="#0D0E1A" stroke-width="2"/>
            <circle cx="130" cy="28" r="5" fill="#FF9500" stroke="#0D0E1A" stroke-width="2"/>
          </g>

          <!-- Block: YOLOv8 -->
          <g transform="translate(420,80)">
            <rect width="150" height="70" rx="10" fill="#1A1D35" stroke="#00E5A0" stroke-width="1.5"/>
            <text x="18" y="22" fill="#00E5A0" font-size="11" font-weight="600" font-family="Inter">🎯 YOLOv8</text>
            <text x="18" y="38" fill="#555A7A" font-size="9" font-family="Inter">Object Detection</text>
            <text x="18" y="52" fill="#555A7A" font-size="9" font-family="Inter">Pretrained yolov8s.pt</text>
            <circle cx="0" cy="35" r="5" fill="#00E5A0" stroke="#0D0E1A" stroke-width="2"/>
            <circle cx="150" cy="35" r="5" fill="#00E5A0" stroke="#0D0E1A" stroke-width="2"/>
          </g>

          <!-- Block: Output Bbox -->
          <g transform="translate(640,80)">
            <rect width="130" height="56" rx="10" fill="#1A1D35" stroke="#FF4567" stroke-width="1.5"/>
            <text x="18" y="22" fill="#FF4567" font-size="11" font-weight="600" font-family="Inter">🚀 NMS & Sorties</text>
            <text x="18" y="38" fill="#555A7A" font-size="9" font-family="Inter">BBox, Conf, Classes</text>
            <circle cx="0" cy="28" r="5" fill="#FF4567" stroke="#0D0E1A" stroke-width="2"/>
          </g>

          <!-- Connections -->
          <line x1="160" y1="108" x2="220" y2="68" stroke="rgba(108,99,255,0.6)" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow)"/>
          <line x1="160" y1="108" x2="220" y2="158" stroke="rgba(108,99,255,0.6)" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow)"/>
          <line x1="350" y1="68" x2="420" y2="108" stroke="rgba(255,149,0,0.6)" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow)"/>
          <line x1="350" y1="158" x2="420" y2="108" stroke="rgba(255,149,0,0.6)" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow)"/>
          <line x1="570" y1="115" x2="640" y2="108" stroke="rgba(0,229,160,0.6)" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow)"/>
        </svg>
      </div>

      <!-- Launch bar -->
      <div class="card" style="padding:16px;">
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <div class="form-group" style="flex-direction:row;align-items:center;gap:8px;flex:0 0 auto;">
            <label class="form-label" style="white-space:nowrap;">Epochs:</label>
            <input type="number" class="form-input" value="100" style="width:70px;font-size:12px;">
          </div>
          <div class="form-group" style="flex-direction:row;align-items:center;gap:8px;flex:0 0 auto;">
            <label class="form-label" style="white-space:nowrap;">Batch size:</label>
            <input type="number" class="form-input" value="16" style="width:70px;font-size:12px;">
          </div>
          <div class="form-group" style="flex-direction:row;align-items:center;gap:8px;flex:0 0 auto;">
            <label class="form-label" style="white-space:nowrap;">Learning rate:</label>
            <input type="text" class="form-input" value="1e-3" style="width:80px;font-size:12px;">
          </div>
          <div class="form-group" style="flex-direction:row;align-items:center;gap:8px;flex:0 0 auto;">
            <label class="form-label" style="white-space:nowrap;">Nom du modèle:</label>
            <input type="text" class="form-input" value="YOLOv8_Detect_v3" style="width:140px;font-size:12px;">
          </div>
          <button class="btn btn-primary" style="margin-left:auto;" onclick="launchTraining(this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Lancer l'entraînement
          </button>
        </div>
        <!-- Progress (shown during training) -->
        <div id="training-progress" style="display:none;margin-top:14px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:6px;">
            <span>Epoch <span id="ep-cur">23</span> / 100</span>
            <span>Box Loss: <span style="color:var(--accent);">0.84</span> · Val mAP50: <span style="color:var(--green);">82.4%</span></span>
            <span>ETA: 1h 42m</span>
          </div>
          <div class="progress-bar" style="height:8px;">
            <div class="progress-fill" id="train-bar" style="width:23%;"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Right: Model config panel -->
    <div class="card" style="width:220px;flex-shrink:0;overflow-y:auto;">
      <div class="card-header" style="margin-bottom:12px;">
        <span class="card-title">⚙️ Config: YOLOv8</span>
      </div>
      ${[
            { label: 'Variation', type: 'select', val: 'yolov8s', opts: ['yolov8n', 'yolov8s', 'yolov8m', 'yolov8l'] },
            { label: 'Classes (Max)', type: 'number', val: '5' },
            { label: 'Init weights', type: 'select', val: 'COCO', opts: ['COCO', 'Random', 'Custom'] },
            { label: 'Freezing (Layers)', type: 'number', val: '10' },
            { label: 'Optimizer', type: 'select', val: 'AdamW', opts: ['AdamW', 'SGD', 'RMSprop'] },
            { label: 'Mixup Prob', type: 'range', val: '0.2' },
            { label: 'Mosaic Prob', type: 'range', val: '0.5' },
            { label: 'Warmup Epochs', type: 'number', val: '3' },
            { label: 'Save Checkpoints', type: 'check', val: 'true' },
        ].map(c => `
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">${c.label}</label>
          ${c.type === 'select'
                ? `<select class="form-select" style="font-size:12px;">${c.opts.map(o => `<option${o === c.val ? ' selected' : ''}>${o}</option>`).join('')}</select>`
                : c.type === 'range'
                    ? `<div style="display:flex;gap:8px;align-items:center;"><input type="range" min="0" max="1" step="0.1" value="${c.val}" style="flex:1;accent-color:var(--accent);"><span style="font-size:11px;color:var(--text-secondary);width:28px;">${c.val}</span></div>`
                    : c.type === 'check'
                        ? `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" ${c.val === 'true' ? 'checked' : ''} style="accent-color:var(--accent);"><span style="font-size:12px;">${c.val === 'true' ? 'Oui' : 'Non'}</span></label>`
                        : `<input type="${c.type}" class="form-input" value="${c.val}" style="font-size:12px;">`
            }
        </div>
      `).join('')}
    </div>
  </div>`;
}

function launchTraining(btn) {
    const prog = document.getElementById('training-progress');
    if (prog) {
        prog.style.display = 'block';
        btn.disabled = true;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Entraînement en cours…';
        let ep = 0;
        const bar = document.getElementById('train-bar');
        const epEl = document.getElementById('ep-cur');
        const iv = setInterval(() => {
            ep+=2; epEl && (epEl.textContent = ep);
            bar && (bar.style.width = (ep) + '%');
            if (ep >= 100) { clearInterval(iv); btn.disabled = false; btn.innerHTML = '✅ Terminé — Sauvegardé'; }
        }, 80);
    }
}

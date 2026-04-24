/* ==========================================
   Deployment — Brique 5 (VISTA)
   ========================================== */

function initDeployment(container) {
    container.innerHTML = `
  <div class="fade-in">

    <!-- Deployed models overview -->
    <div class="grid-3" style="margin-bottom:20px;">
      ${[
            { name: 'YOLOv8_Detect_v3', status: 'Actif', cls: 'tag-green', sdot: '--green', acc: '86.4% mAP', req: '5,284 / jour', target: 'Edge (TensorRT)', uptime: '99.9%' },
            { name: 'ResNet50_Classif_v1', status: 'Actif', cls: 'tag-green', sdot: '--green', acc: '94.2% Acc', req: '1,432 / jour', target: 'API REST', uptime: '100%' },
            { name: 'UNet_Segmentation_v2', status: 'Arrêté', cls: 'tag-orange', sdot: '--orange', acc: '0.81 IoU', req: '—', target: 'Docker', uptime: '—' },
        ].map(m => `
        <div class="card">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;">
            <div>
              <div style="font-size:14px;font-weight:700;margin-bottom:4px;">${m.name}</div>
              <span class="tag ${m.cls}">${m.status}</span>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-sm btn-secondary">Logs</button>
              <button class="btn btn-sm btn-secondary">⋮</button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-secondary);">
            <div style="display:flex;justify-content:space-between;"><span>Précision</span><span style="color:var(--green);font-weight:600;">${m.acc}</span></div>
            <div style="display:flex;justify-content:space-between;"><span>Requêtes</span><span>${m.req}</span></div>
            <div style="display:flex;justify-content:space-between;"><span>Format / Cible</span><span>${m.target}</span></div>
            <div style="display:flex;justify-content:space-between;"><span>Uptime</span><span style="color:var(${m.sdot});font-weight:600;">${m.uptime}</span></div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="grid-2" style="margin-bottom:16px;">

      <!-- Deploy new model -->
      <div class="card">
        <div class="card-header" style="margin-bottom:16px;">
          <span class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            Déployer un modèle Vision
          </span>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Modèle à packager / déployer</label>
          <select class="form-select">
            <option>YOLOv8_Detect_v3 (recommandé)</option>
            <option>UNet_Segmentation_v2</option>
            <option>ResNet50_Classif_v1</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Format de sortie (Déploiement cible)</label>
          <div class="toggle-group" style="margin-top:4px;">
            ${['API REST (JSON)', 'TensorRT (Edge)', 'ONNX', 'TFLite', 'Docker Image'].map((t, i) => `
              <span class="toggle-chip${i === 0 ? ' active' : ''}" onclick="selectDeplType(this)">${t}</span>
            `).join('')}
          </div>
        </div>

        <!-- API REST config -->
        <div id="deploy-config-api" style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
          <div class="form-group">
            <label class="form-label">Endpoint URL généré</label>
            <input type="text" class="form-input" value="/api/vision/v1/detect" style="font-size:12px;font-family:monospace;">
          </div>
          <div class="form-group">
            <label class="form-label">Format d'Image en Entrée</label>
            <select class="form-select" style="font-size:12px;">
              <option>JSON (Base64 JPEG/PNG)</option>
              <option>Multipart File Upload</option>
            </select>
          </div>
          <div style="display:flex;gap:8px;">
            <div class="form-group" style="flex:1;">
              <label class="form-label">Résolution max supportée</label>
              <select class="form-select" style="font-size:12px;">
                <option>640x640</option><option>1024x1024</option><option>Original (Auto-resize)</option>
              </select>
            </div>
            <div class="form-group" style="width:100px;">
              <label class="form-label">Max batch size</label>
              <input type="number" class="form-input" value="8" style="font-size:12px;">
            </div>
          </div>
          <div style="display:flex;gap:10px;margin-top:6px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
              <input type="checkbox" checked style="accent-color:var(--accent);"> Inclure masque Grad-CAM
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
              <input type="checkbox" checked style="accent-color:var(--accent);"> Auto-alignement (GPU)
            </label>
          </div>
        </div>

        <button class="btn btn-primary" style="width:100%;" onclick="deployModel(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
          Générer / Déployer
        </button>
      </div>

      <!-- API documentation preview -->
      <div class="card">
        <div class="card-header" style="margin-bottom:12px;">
          <span class="card-title">📄 Exemple de Requête & Réponse</span>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm btn-secondary">Copier</button>
            <button class="btn btn-sm btn-secondary">Swagger UI</button>
          </div>
        </div>
        <div style="background:var(--bg-input);border-radius:8px;padding:14px;font-family:monospace;font-size:11px;color:var(--text-secondary);max-height:280px;overflow-y:auto;line-height:1.7;">
          <span style="color:#FF9500;">POST</span> <span style="color:#00D4FF;">/api/vision/v1/detect</span><br>
          <span style="color:var(--text-muted);">Content-Type: application/json</span><br>
          <span style="color:var(--text-muted);">Authorization: ApiKey &lt;your-key&gt;</span><br><br>
          <span style="color:#6C63FF;">// Request body</span><br>
          {<br>
          &nbsp;&nbsp;<span style="color:#00E5A0;">"image_b64"</span>: <span style="color:#FFD60A;">"/9j/4AAQSkZJRgABA..."</span>,<br>
          &nbsp;&nbsp;<span style="color:#00E5A0;">"return_gradcam"</span>: <span style="color:#FF9500;">true</span>,<br>
          &nbsp;&nbsp;<span style="color:#00E5A0;">"threshold"</span>: <span style="color:#FF9500;">0.50</span><br>
          }<br><br>
          <span style="color:#6C63FF;">// Response (200 OK)</span><br>
          {<br>
          &nbsp;&nbsp;<span style="color:#00E5A0;">"status"</span>: <span style="color:#FFD60A;">"SUCCESS"</span>,<br>
          &nbsp;&nbsp;<span style="color:#00E5A0;">"detections"</span>: [<br>
          &nbsp;&nbsp;&nbsp;&nbsp;{<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#00E5A0;">"class"</span>: <span style="color:#FFD60A;">"Bavure"</span>,<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#00E5A0;">"confidence"</span>: <span style="color:#FF9500;">0.942</span>,<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#00E5A0;">"bbox"</span>: [<span style="color:#FF9500;">120</span>, <span style="color:#FF9500;">340</span>, <span style="color:#FF9500;">160</span>, <span style="color:#FF9500;">380</span>]<br>
          &nbsp;&nbsp;&nbsp;&nbsp;}<br>
          &nbsp;&nbsp;],<br>
          &nbsp;&nbsp;<span style="color:#00E5A0;">"explanation_heatmap"</span>: <span style="color:#FFD60A;">"iVBORw0KGgoAAA..."</span>,<br>
          &nbsp;&nbsp;<span style="color:#00E5A0;">"latency_ms"</span>: <span style="color:#FF9500;">18</span><br>
          }
        </div>
      </div>
    </div>

    <!-- Monitoring dashboard -->
    <div class="card">
      <div class="card-header" style="margin-bottom:16px;">
        <span class="card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Supervision — YOLOv8_Detect_v3
        </span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${['1h', '24h', '7j', '30j'].map((t, i) => `
            <span class="toggle-chip${i === 1 ? ' active' : ''}" onclick="selectTimeRange(this)">${t}</span>
          `).join('')}
        </div>
      </div>
      <div class="grid-4" style="margin-bottom:16px;">
        ${[
            { label: 'Requêtes / heure', val: '220.3', trend: '+4%', color: '--cyan' },
            { label: 'Latence Inférence', val: '18 ms', trend: '-2 ms', color: '--green' },
            { label: 'Taux False Postives', val: '1.2%', trend: 'stable', color: '--orange' },
            { label: 'Pièces Rejetées', val: '4.8%', trend: '+0.5%', color: '--red' },
        ].map(k => `
          <div style="background:var(--bg-input);border-radius:10px;padding:14px;">
            <div style="font-size:20px;font-weight:800;color:var(${k.color});">${k.val}</div>
            <div style="font-size:12px;font-weight:500;margin-top:4px;">${k.label}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${k.trend}</div>
          </div>
        `).join('')}
      </div>
      <!-- Monitoring chart -->
      <canvas id="monitor-canvas" width="1000" height="120" style="width:100%;border-radius:8px;"></canvas>
    </div>
  </div>`;

    drawMonitorChart();
}

function drawMonitorChart() {
    const canvas = document.getElementById('monitor-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(0, H * i / 4); ctx.lineTo(W, H * i / 4); ctx.stroke(); }
    // Fill area
    ctx.beginPath();
    const pts = [];
    for (let x = 0; x <= W; x += 4) {
        const t = x / W;
        const y = H * 0.6 - Math.sin(t * 12) * H * 0.25 + (Math.random() - 0.5) * H * 0.05;
        pts.push([x, y]);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(0,212,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
    // Fill under
    ctx.beginPath();
    pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = 'rgba(0,212,255,0.05)'; ctx.fill();

    // Anomaly spikes (Defect alarms)
    [[200, 0.25], [520, 0.45], [780, 0.18]].forEach(([px, intensity]) => {
        ctx.fillStyle = `rgba(255,69,103,${intensity})`;
        ctx.fillRect(px - 2, 0, 4, H);
    });
}

function deployModel(btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Création de l\'API REST…';
    setTimeout(() => {
        btn.innerHTML = '✅ API Prête à l\'emploi';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        btn.disabled = false;
    }, 2000);
}

function selectDeplType(el) {
    el.closest('.toggle-group').querySelectorAll('.toggle-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
}

function selectTimeRange(el) {
    el.closest('div').querySelectorAll('.toggle-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
}

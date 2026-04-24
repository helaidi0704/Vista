/* ==========================================
   Image Analysis & Comparaison — VISTA
   ========================================== */

function initImageAnalysis(container) {
    container.innerHTML = `
  <div class="fade-in">
    <!-- Image selection bar -->
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">
      <div style="display:flex;gap:8px;flex:1;flex-wrap:wrap;">
        ${[
            { name: 'carter_moteur_082.jpg', tag: 'Défaut: Rayure', cls: 'tag-red' },
            { name: 'ref_template_gold.jpg', tag: 'Golden Reference', cls: 'tag-green' },
        ].map((f, i) => `
          <div class="card" style="display:flex;align-items:center;gap:10px;padding:10px 14px;flex:1;min-width:200px;">
            <div style="width:28px;height:28px;background:${i === 0 ? 'rgba(255,69,103,0.1)' : 'rgba(0,229,160,0.1)'};border:1px solid ${i === 0 ? 'var(--red)' : 'var(--green)'};border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;">🖼️</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</div>
            </div>
            <span class="tag ${f.cls}">${f.tag}</span>
          </div>
        `).join('')}
        <button class="btn btn-secondary">+ Comparer une image</button>
      </div>
    </div>

    <!-- Feature tabs -->
    <div style="display:flex;gap:4px;margin-bottom:16px;background:var(--bg-secondary);border-radius:var(--radius-sm);padding:4px;width:fit-content;">
      ${['Comparaison Côte à Côte', 'Superposition (DIfference)', 'Analyse Spectrale (FFT)', 'Data Augmentation Test', 'Extraction Contours (Sobel/Canny)'].map((t, i) => `
        <button class="toggle-chip${i === 0 ? ' active' : ''}" onclick="switchAnalysisTab(this,'${t}')" style="border-radius:6px;">${t}</button>
      `).join('')}
    </div>

    <!-- Content Area: Side by Side Comparison -->
    <div id="analysis-content">
      
      <!-- Toolbox for Image Processing -->
      <div class="card" style="margin-bottom:16px;padding:12px 16px;">
        <div style="display:flex;gap:16px;align-items:center;">
          <strong style="font-size:12px;color:var(--text-secondary);">Filtres synchrones:</strong>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox"> Grayscale</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox"> Equaliser Histogramme</label>
          <div style="width:1px;height:16px;background:var(--border);"></div>
          <strong style="font-size:12px;color:var(--text-secondary);">Luminosité/Contraste:</strong>
          <input type="range" style="width:80px;accent-color:var(--accent);">
        </div>
      </div>

      <div class="grid-2" style="margin-bottom:16px;">
        <!-- Image 1 -->
        <div class="card" style="padding:10px;">
          <div class="card-header" style="margin-bottom:8px;">
            <span class="card-title" style="font-size:12px;">Image cible (carter_moteur_082)</span>
          </div>
          <div class="viz-placeholder" style="height:280px;position:relative;">
            <canvas id="img-target-canvas" style="width:100%;height:100%;"></canvas>
            <div style="position:absolute;top:40%;left:35%;border:2px dashed var(--red);width:80px;height:60px;background:rgba(255,69,103,0.15);"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:var(--text-muted);">
            <span>Max intensité: 245</span><span>Sharpness: 4.2</span>
          </div>
        </div>
        
        <!-- Image 2 -->
        <div class="card" style="padding:10px;">
          <div class="card-header" style="margin-bottom:8px;">
            <span class="card-title" style="font-size:12px;">Golden Reference</span>
          </div>
          <div class="viz-placeholder" style="height:280px;">
            <canvas id="img-ref-canvas" style="width:100%;height:100%;"></canvas>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:var(--text-muted);">
            <span>Max intensité: 242</span><span>Sharpness: 4.5</span>
          </div>
        </div>
      </div>

      <!-- Data Augmentation Testing Preview -->
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header">
          <span class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
            Simulation Data Augmentation (Transformation Batch)
          </span>
          <button class="btn btn-sm btn-primary">Générer aperçus</button>
        </div>
        
        <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <label style="font-size:12px;color:var(--accent);border:1px solid var(--border-accent);padding:4px 8px;border-radius:4px;"><input type="checkbox" checked> Crop (Aléatoire)</label>
          <label style="font-size:12px;color:var(--accent);border:1px solid var(--border-accent);padding:4px 8px;border-radius:4px;"><input type="checkbox" checked> Rotation (-15°..15°)</label>
          <label style="font-size:12px;color:var(--accent);border:1px solid var(--border-accent);padding:4px 8px;border-radius:4px;"><input type="checkbox" checked> Mixup (alpha 0.2)</label>
          <label style="font-size:12px;border:1px solid var(--border);padding:4px 8px;border-radius:4px;"><input type="checkbox"> Cutout</label>
        </div>

        <div class="grid-4">
          ${[
            { t: 'Origine', fl: '' },
            { t: 'Crop + Rot 12°', fl: 'brightness(90%)' },
            { t: 'Mixup avec BG_1', fl: 'contrast(120%)' },
            { t: 'Crop + Rot -5°', fl: 'hue-rotate(10deg)' }
          ].map(aug => `
            <div>
              <div class="viz-placeholder" style="height:120px;margin-bottom:6px;filter:${aug.fl}">
                <canvas class="aug-preview-canvas" width="200" height="120" style="width:100%;height:100%;"></canvas>
              </div>
              <div style="font-size:11px;text-align:center;color:var(--text-secondary);">${aug.t}</div>
            </div>
          `).join('')}
        </div>
      </div>
      
    </div>
  </div>`;

    setTimeout(() => {
        drawFakeImageContent('img-target-canvas', true);
        drawFakeImageContent('img-ref-canvas', false);
        
        document.querySelectorAll('.aug-preview-canvas').forEach(c => {
           drawFakeImageContent(c.id, true, c); 
        });
    }, 100);
}

function drawFakeImageContent(id, hasDefect, canvasElem) {
    const canvas = canvasElem || document.getElementById(id);
    if (!canvas) return;
    
    // Si c'est un canvas de taille fixe, ne pas écraser
    if(!canvasElem) {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
    }
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    
    // Fond metallique
    ctx.fillStyle = '#2A2C3A';
    ctx.fillRect(0,0,W,H);
    
    // Engrenage/pièce centrale
    ctx.strokeStyle = '#555A7A';
    ctx.lineWidth = W*0.03;
    ctx.beginPath();
    ctx.arc(W/2, H/2, Math.min(W,H)*0.3, 0, Math.PI*2);
    ctx.stroke();

    // Features récurrentes pour "ressembler" à la même image
    ctx.fillStyle = '#44485D';
    ctx.beginPath(); ctx.arc(W/2 - 20, H/2 - 20, 10, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(W/2 + 20, H/2 + 20, 10, 0, Math.PI*2); ctx.fill();

    // Defect only on target
    if(hasDefect) {
        ctx.strokeStyle = '#8B91B5'; // couleur du scratch metal clair
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(W/2 + 10, H/2 - 40);
        ctx.lineTo(W/2 + 35, H/2 - 15);
        ctx.stroke();
    }
}

function switchAnalysisTab(el, tab) {
    el.closest('div').querySelectorAll('.toggle-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
}

/* ==========================================
   Image Viewer & Annotation — VISTA
   ========================================== */

function initImageViewer(container) {
  container.innerHTML = `
  <div class="fade-in">
    <!-- File picker row -->
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">
      <div class="card" style="flex:1;min-width:260px;padding:14px 18px;display:flex;align-items:center;gap:12px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;">carter_moteur_082.jpg</div>
          <div style="font-size:11px;color:var(--text-muted);">RGB · 1920x1080 · 2.4 MB</div>
        </div>
        <span class="tag tag-orange">À Inspecter</span>
      </div>
      <button class="btn btn-secondary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
        Importer image
      </button>
      <button class="btn btn-secondary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        Bibliothèque
      </button>
    </div>

    <div class="grid-3">
      <!-- Image Canvas Area (Span 2) -->
      <div class="card col-span-2" style="display:flex;flex-direction:column;">
        <div class="card-header">
          <span class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            Éditeur Interactif
          </span>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-sm btn-secondary" title="Outil Main (Pan)" onclick="setTool(this, 'pan')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 00-12 0v7h12V8z"/><path d="M9 15v4m6-4v4"/></svg>
            </button>
            <button class="btn btn-sm btn-primary" title="BBox (Rectangle)" onclick="setTool(this, 'rect')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            </button>
            <button class="btn btn-sm btn-secondary" title="Tracé Libre (Crayon)" onclick="setTool(this, 'draw')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
            </button>
            <div style="width:1px;height:20px;background:var(--border);margin:0 4px;"></div>
            <span id="zoom-label" style="font-size:11px;color:var(--text-muted);">Zoom: 100%</span>
            <input type="range" id="zoom-slider" min="0.5" max="3" value="1" step="0.1"
              style="width:80px;accent-color:var(--accent);">
            <button class="btn btn-sm btn-secondary">Reset</button>
          </div>
        </div>

        <!-- Canvas Container -->
        <div class="viz-placeholder" style="flex:1;min-height:380px;cursor:crosshair;position:relative;overflow:hidden;background:#0D0E1A;" id="image-container">
          <canvas id="image-canvas" style="position:absolute;top:0;left:0;"></canvas>
          <canvas id="draw-canvas" style="position:absolute;top:0;left:0;"></canvas>
        </div>
      </div>

      <!-- Annotation Panel -->
      <div class="card" style="display:flex;flex-direction:column;">
        <div class="card-header">
          <span class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
            Propriétés d'Annotation
          </span>
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Type de défaut</label>
          <select class="form-select" id="annot-type">
            <option>Rayure profonde</option>
            <option>Fissure (micro)</option>
            <option>Décoloration / Tâche</option>
            <option>Défaut d'usinage (Bavure)</option>
            <option>Pièce manquante</option>
          </select>
        </div>
        
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Sévérité du défaut</label>
          <div style="display:flex;gap:8px;" id="annot-severity-container">
            ${[
      { label: 'Critique', cls: 'btn-danger' },
      { label: 'Majeur', cls: 'btn-secondary' },
      { label: 'Mineur', cls: 'btn-secondary' },
    ].map(b => `<button class="btn btn-sm ${b.cls}" onclick="setSeverity(this)" style="flex:1">${b.label}</button>`).join('')}
          </div>
        </div>

        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Description détaillée contextuelle</label>
          <textarea class="form-textarea" id="annot-desc" placeholder="Ex: Rayure longitudinale causée par un frottement outil sur l'axe X...">Rayure profonde orientée à 45° sur la zone d'épaulement droite.</textarea>
        </div>

        <div class="form-group" style="margin-bottom:16px;">
          <label class="form-label">Calque courant</label>
          <div style="display:flex;gap:8px;align-items:center;background:var(--bg-input);padding:8px 12px;border-radius:6px;">
            <div style="width:12px;height:12px;border:2px solid var(--accent);border-radius:2px;"></div>
            <span style="font-size:12px;flex:1;">Shape_04 (BBox)</span>
            <button class="btn btn-sm" style="padding:4px;background:none;border:none;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </div>

        <button class="btn btn-primary" style="width:100%;margin-top:auto;" onclick="saveAnnotation()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Enregistrer les annotations
        </button>
      </div>
    </div>

    <!-- Annotation history / Objects list -->
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <span class="card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Liste des objets annotés sur cette image
        </span>
        <span style="font-size:12px;color:var(--text-muted);" id="annotations-count">0 annotation trouvée</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="color:var(--text-muted);">
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);">Type de Forme</th>
            <th style="padding:8px 12px;border-bottom:1px solid var(--border);">Classe (Défaut)</th>
            <th style="padding:8px 12px;border-bottom:1px solid var(--border);">Sévérité</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);">Description textuelle</th>
            <th style="padding:8px 12px;border-bottom:1px solid var(--border);">Action</th>
          </tr>
        </thead>
        <tbody id="annotations-tbody">
        </tbody>
      </table>
    </div>
  </div>`;

  setTimeout(() => {
    loadRealImageAndDraw();
    setupDrawingInteraction();
    renderAnnotations();
  }, 100);
}

function setTool(btn, tool) {
  btn.parentElement.querySelectorAll('.btn').forEach(b => {
    b.classList.remove('btn-primary');
    b.classList.add('btn-secondary');
  });
  btn.classList.add('btn-primary');
  btn.classList.remove('btn-secondary');
  const container = document.getElementById('image-container');
  if (container) {
    if (tool === 'pan') container.style.cursor = 'grab';
    if (tool === 'rect') container.style.cursor = 'crosshair';
    if (tool === 'draw') container.style.cursor = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%236C63FF' stroke-width='2'><circle cx='8' cy='8' r='4'/></svg>") 8 8, auto`;
  }
}

function setSeverity(btn) {
  btn.parentElement.querySelectorAll('.btn').forEach(b => {
    if (b.classList.contains('btn-danger')) b.classList.replace('btn-danger', 'btn-secondary');
    else if (b.classList.contains('btn-orange')) b.classList.replace('btn-orange', 'btn-secondary');
    else if (b.classList.contains('btn-success')) b.classList.replace('btn-success', 'btn-secondary');
    else if (b.classList.contains('btn-primary')) b.classList.replace('btn-primary', 'btn-secondary');
  });

  btn.classList.remove('btn-secondary');
  if (btn.textContent === 'Critique') btn.classList.add('btn-danger');
  else if (btn.textContent === 'Majeur') btn.classList.add('btn-orange');
  else btn.classList.add('btn-success');
}

let imageAnnotations = [
  { id: 1, type: 'bbox', shape: '🟥 BBox', def: 'Rayure profonde', sev: 'Critique', scls: 'tag-red', desc: "Rayure importante sur la surface principale.", coords: { nx: 0.45, ny: 0.35, nw: 0.15, nh: 0.30 } },
  { id: 2, type: 'poly', shape: '〰️ Tracé libre', def: 'Fissure', sev: 'Majeur', scls: 'tag-orange', desc: "Micro-fissure en périphérie (zone B).", coords: { points: [{ nx: 0.38, ny: 0.35 }, { nx: 0.42, ny: 0.45 }, { nx: 0.40, ny: 0.55 }] } },
];

let hoveredAnnotId = null;

function renderAnnotations() {
  const tbody = document.getElementById('annotations-tbody');
  const countSpan = document.getElementById('annotations-count');
  if (!tbody || !countSpan) return;

  countSpan.textContent = imageAnnotations.length + " annotation(s) trouvée(s)";

  tbody.innerHTML = imageAnnotations.map(r => `
        <tr style="border-bottom:1px solid var(--border); transition:background 0.2s; cursor:pointer;" 
            onmouseenter="hoverAnnotation(${r.id}, true)" 
            onmouseleave="hoverAnnotation(${r.id}, false)">
            <td style="padding:10px 12px;color:var(--cyan);font-family:monospace;">${r.shape}</td>
            <td style="padding:10px 12px;text-align:center;"><span style="color:var(--text-primary);font-weight:600;">${r.def}</span></td>
            <td style="padding:10px 12px;text-align:center;"><span class="tag ${r.scls}">${r.sev}</span></td>
            <td style="padding:10px 12px;color:var(--text-secondary);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.desc}</td>
            <td style="padding:10px 12px;text-align:center;">
            <button class="btn btn-sm btn-secondary" style="margin-right:4px;">Éditer</button>
            <button class="btn btn-sm btn-danger" onclick="deleteAnnotation(${r.id})">🗑</button>
            </td>
        </tr>
    `).join('');
}

function hoverAnnotation(id, isEnter) {
  if (isEnter) {
    hoveredAnnotId = id;
  } else {
    if (hoveredAnnotId === id) hoveredAnnotId = null;
  }
  const tbody = document.getElementById('annotations-tbody');
  if (tbody) {
    Array.from(tbody.children).forEach((tr, idx) => {
      const ann = imageAnnotations[idx];
      if (ann && ann.id === hoveredAnnotId) {
        tr.style.background = 'var(--bg-card-hover)';
      } else {
        tr.style.background = 'transparent';
      }
    });
  }
  drawAnnotationsOnly();
}

function saveAnnotation() {
  const typeSelect = document.getElementById('annot-type');
  const descInput = document.getElementById('annot-desc');

  const sevContainer = document.getElementById('annot-severity-container');
  let activeBtn = Array.from(sevContainer.querySelectorAll('.btn')).find(b => !b.classList.contains('btn-secondary'));
  let sevText = 'Mineur';
  let scls = 'tag-cyan';
  if (activeBtn) {
    sevText = activeBtn.textContent;
    if (sevText === 'Critique') scls = 'tag-red';
    else if (sevText === 'Majeur') scls = 'tag-orange';
  }

  const valType = typeSelect ? typeSelect.value : 'Inconnu';
  const valDesc = descInput ? descInput.value : '';

  const newAnnot = {
    id: Date.now(),
    type: Math.random() > 0.5 ? 'bbox' : 'poly',
    shape: Math.random() > 0.5 ? '🟥 BBox' : '〰️ Tracé libre',
    def: valType,
    sev: sevText,
    scls: scls,
    desc: valDesc,
    coords: { nx: 0.1 + Math.random() * 0.8, ny: 0.1 + Math.random() * 0.8, nw: 0.1, nh: 0.1 }
  };

  imageAnnotations.push(newAnnot);
  renderAnnotations();
  drawAnnotationsOnly();
  if (descInput) descInput.value = '';
}

function deleteAnnotation(id) {
  imageAnnotations = imageAnnotations.filter(a => a.id !== id);
  if (hoveredAnnotId === id) hoveredAnnotId = null;
  renderAnnotations();
  drawAnnotationsOnly();
}

let loadedImageObj = null;

function loadRealImageAndDraw() {
  const imgObj = new Image();
  imgObj.src = 'assets/carter_moteur.png';
  imgObj.onload = () => {
    loadedImageObj = imgObj;
    drawBaseImage();
    drawAnnotationsOnly();
  };
  imgObj.onerror = () => {
    console.error("Failed to load image. Falling back to styling...");
    // Placeholder background just in case
    const container = document.getElementById('image-container');
    if (container) container.style.background = '#2A2C3A';
  };
}

let imageRenderRect = { x: 0, y: 0, w: 0, h: 0 };

function drawBaseImage() {
  const container = document.getElementById('image-container');
  const imgCanvas = document.getElementById('image-canvas');
  if (!container || !imgCanvas || !loadedImageObj) return;

  // Resize canvases to container
  const W = container.clientWidth;
  const H = container.clientHeight;
  imgCanvas.width = W;
  imgCanvas.height = H;

  const drawCanvas = document.getElementById('draw-canvas');
  if (drawCanvas) {
    drawCanvas.width = W;
    drawCanvas.height = H;
  }

  const ctx = imgCanvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Fit image exactly covering with aspect ratio (object-fit: contain logic)
  const imgRatio = loadedImageObj.width / loadedImageObj.height;
  const cvRatio = W / H;

  let drawW = W, drawH = H;
  if (imgRatio > cvRatio) {
    drawH = W / imgRatio;
  } else {
    drawW = H * imgRatio;
  }
  imageRenderRect = {
    x: (W - drawW) / 2,
    y: (H - drawH) / 2,
    w: drawW,
    h: drawH
  };

  ctx.drawImage(loadedImageObj, imageRenderRect.x, imageRenderRect.y, imageRenderRect.w, imageRenderRect.h);
}

function drawAnnotationsOnly() {
  const drawCanvas = document.getElementById('draw-canvas');
  if (!drawCanvas) return;
  const dtx = drawCanvas.getContext('2d');
  dtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

  if (imageRenderRect.w === 0) return; // not rendered yet

  const ix = imageRenderRect.x, iy = imageRenderRect.y, iw = imageRenderRect.w, ih = imageRenderRect.h;

  imageAnnotations.forEach(ann => {
    const isHovered = (ann.id === hoveredAnnotId);

    let colorMain = '#00C7BE'; // default success
    let colorFill = 'rgba(0,199,190,0.15)';
    if (ann.scls === 'tag-red') { colorMain = '#FF453A'; colorFill = 'rgba(255, 69, 58, 0.2)'; }
    if (ann.scls === 'tag-orange') { colorMain = '#FFD60A'; colorFill = 'rgba(255, 214, 10, 0.2)'; }

    if (isHovered) {
      dtx.shadowColor = colorMain;
      dtx.shadowBlur = 10;
      colorFill = colorFill.replace('0.2)', '0.4)').replace('0.15)', '0.3)');
    } else {
      dtx.shadowBlur = 0;
    }

    dtx.lineWidth = isHovered ? 3 : 2;
    dtx.strokeStyle = colorMain;

    if (ann.type === 'bbox' && ann.coords.nw) {
      const rx = ix + ann.coords.nx * iw;
      const ry = iy + ann.coords.ny * ih;
      const rw = ann.coords.nw * iw;
      const rh = ann.coords.nh * ih;

      dtx.strokeRect(rx, ry, rw, rh);
      dtx.fillStyle = colorFill;
      dtx.fillRect(rx, ry, rw, rh);

      // Label box
      dtx.shadowBlur = 0;
      dtx.fillStyle = colorMain;
      const txt = ann.def;
      const tw = dtx.measureText(txt).width + 8;
      dtx.fillRect(rx, ry - 16, tw, 16);
      dtx.fillStyle = '#121316';
      dtx.font = 'bold 10px Inter, sans-serif';
      dtx.fillText(txt, rx + 4, ry - 4);
    }
    else if (ann.type === 'poly' && ann.coords.points) {
      dtx.beginPath();
      ann.coords.points.forEach((pt, idx) => {
        const px = ix + pt.nx * iw;
        const py = iy + pt.ny * ih;
        if (idx === 0) dtx.moveTo(px, py);
        else dtx.lineTo(px, py);
      });
      dtx.closePath();
      dtx.stroke();
      dtx.fillStyle = colorFill;
      dtx.fill();
    }
  });

  dtx.shadowBlur = 0;
}

function setupDrawingInteraction() {
  const drawCanvas = document.getElementById('draw-canvas');
  if (!drawCanvas) return; // Keep same interaction but maybe adjust

  let isDrawing = false;
  let dtx = drawCanvas.getContext('2d');

  drawCanvas.addEventListener('mousedown', e => {
    isDrawing = true;
  });

  drawCanvas.addEventListener('mousemove', e => {
    if (!isDrawing) return;
    const rect = drawCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Freehand draw mockup effect
    dtx.strokeStyle = '#E06C00'; // Accent color
    dtx.lineWidth = 2;
    dtx.lineTo(x, y);
    dtx.stroke();
  });

  drawCanvas.addEventListener('mouseup', () => {
    isDrawing = false;
    dtx.beginPath();
    // Force redraw existing to clear or keep the doodle?
    // Let's clear and re-draw clean annotations
    setTimeout(drawAnnotationsOnly, 500);
  });

  // Resize listener
  window.addEventListener('resize', () => {
    if (loadedImageObj) {
      drawBaseImage();
      drawAnnotationsOnly();
    }
  });
}


/* ==========================================
   Live Testing & Explicabilité — VISTA
   ========================================== */

function initLiveTesting(container) {
    container.innerHTML = `
  <div class="fade-in">
    <div class="grid-3" style="margin-bottom:16px;">

      <!-- Model + Input selection -->
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="card">
          <div class="card-header"><span class="card-title">🧠 Sélection du modèle</span></div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label">Modèle entraîné</label>
            <select class="form-select" style="font-size:12px;">
              <option>YOLOv8_Detect_v3 (mAP: 86.4%)</option>
              <option>ResNet50_Classif_v1 (Acc: 94.2%)</option>
              <option>UNet_Segmentation_v2 (IoU: 0.81)</option>
            </select>
          </div>
          <div style="background:var(--bg-input);border-radius:8px;padding:12px;font-size:11px;color:var(--text-secondary);">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>Précision (mAP@50)</span><span style="color:var(--green);font-weight:600;">86.4%</span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>Latence moy.</span><span style="color:var(--cyan);font-weight:600;">18 ms</span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>Entraîné sur</span><span>Dataset_Carter_Moteur</span></div>
            <div style="display:flex;justify-content:space-between;"><span>Classes de défauts</span><span>Rayure, Fissure, Tâche, Bavure</span></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">🎥 Source Image / Flux</span></div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <button class="btn btn-secondary" id="cam-btn" onclick="toggleCam(this)" style="width:100%;justify-content:center;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
              Lancer la Caméra (Inspection ligne)
            </button>
            <div id="cam-indicator" style="display:none;text-align:center;padding:12px;background:rgba(0,229,160,0.1);border:1px solid rgba(0,229,160,0.3);border-radius:8px;">
              <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px;">
                <span class="status-dot" style="background:#00E5A0;"></span>
                <span style="font-size:12px;color:#00E5A0;font-weight:600;">Flux actif… 30 FPS</span>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;color:var(--text-muted);">
              <div style="flex:1;height:1px;background:var(--border);"></div><span style="font-size:11px;">ou</span><div style="flex:1;height:1px;background:var(--border);"></div>
            </div>
            <label style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:20px;
              border:2px dashed var(--border);border-radius:8px;cursor:pointer;transition:all 0.2s;min-height:80px;"
              onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" width="24" height="24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
              <span style="font-size:12px;color:var(--text-secondary);">Glisser une image .jpg / .png</span>
              <input type="file" accept="image/*" style="display:none;">
            </label>
          </div>
        </div>
      </div>

      <!-- Result panel -->
      <div class="card col-span-2">
        <div class="card-header">
          <span class="card-title">🎯 Résultat d'inférence (Temps réel)</span>
          <span class="tag tag-red" id="inference-label">DÉFAUTS DÉTECTÉS (2)</span>
        </div>

        <!-- Visual output (original + GradCAM overlay) -->
        <div class="grid-2">
          
          <div style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-size:11px;color:var(--text-secondary);">Détection (Bounding Boxes)</span>
            <div class="viz-placeholder" style="height:260px;position:relative;" id="live-target-canvas-container">
              <canvas id="live-img-canvas" style="width:100%;height:100%;position:absolute;top:0;left:0;"></canvas>
            </div>
          </div>
          
          <div style="display:flex;flex-direction:column;gap:6px;">
            <span style="font-size:11px;color:var(--text-secondary);">Explicabilité (Heatmap Grad-CAM)</span>
            <div class="viz-placeholder" style="height:260px;position:relative;">
              <canvas id="live-gradcam-canvas" style="width:100%;height:100%;position:absolute;top:0;left:0;"></canvas>
            </div>
          </div>

        </div>

        <!-- Explicability specifics -->
        <div style="border:1px solid var(--border-accent);border-radius:10px;padding:14px;background:rgba(108,99,255,0.05);margin-top:16px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            <span style="font-size:13px;font-weight:700;">Analyse des défauts</span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);line-height:1.7;background:var(--bg-input);border-radius:8px;padding:12px;">
            <p style="margin-bottom:6px;">🔴 <strong style="color:var(--red);">Objet #1 - BAVURE (Confiance: 94.2%)</strong></p>
            <p style="margin-bottom:6px;">La zone rouge intense sur l'explicabilité indique des <strong>gradients très forts</strong> localisés sur la courbure interne de la pièce, caractéristique typique d'un défaut d'usinage ou résidu matériel.</p>
            <div class="divider"></div>
            <p style="margin-bottom:6px;">🟠 <strong style="color:var(--orange);">Objet #2 - MICRO-RAYURE (Confiance: 68.1%)</strong></p>
            <p>Contours fins anormaux détectés. Confiance modérée en raison du faible contraste par rapport au revêtement ambiant.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- History table -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">📋 Historique des inférences</span>
        <span style="font-size:12px;color:var(--text-muted);">Session courante (Dernières 10.0s)</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="color:var(--text-muted);">
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);">Image / Frame</th>
            <th style="padding:8px 12px;border-bottom:1px solid var(--border);">Verdict global</th>
            <th style="padding:8px 12px;border-bottom:1px solid var(--border);">Détail (Défauts)</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);">Modèle actif</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);">Heure</th>
          </tr>
        </thead>
        <tbody id="live-history-body">
          ${[
            { f: 'frame_20412.jpg', v: 'ANORMAL (2)', vc: '--red', d: 'Bavure (0.94), Rayure (0.68)', m: 'YOLOv8_Detect_v3', t: '13:28:45.3' },
            { f: 'frame_20411.jpg', v: 'ANORMAL (1)', vc: '--red', d: 'Bavure (0.92)', m: 'YOLOv8_Detect_v3', t: '13:28:45.0' },
            { f: 'frame_20410.jpg', v: 'NORMAL', vc: '--green', d: '—', m: 'YOLOv8_Detect_v3', t: '13:28:44.7' },
        ].map(r => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:9px 12px;font-weight:500;">${r.f}</td>
              <td style="padding:9px 12px;text-align:center;"><span class="tag ${r.vc === '--green' ? 'tag-green' : 'tag-red'}">${r.v}</span></td>
              <td style="padding:9px 12px;text-align:center;color:var(--text-secondary);">${r.d}</td>
              <td style="padding:9px 12px;color:var(--text-secondary);">${r.m}</td>
              <td style="padding:9px 12px;color:var(--text-muted);font-family:monospace;">${r.t}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>`;

    setTimeout(() => {
        drawLiveInference();
        drawLiveGradCAM();
    }, 100);
}

function drawLiveInference() {
    const canvas = document.getElementById('live-img-canvas');
    if (!canvas) return;
    
    const cw = canvas.parentElement.clientWidth;
    const ch = canvas.parentElement.clientHeight;
    canvas.width = cw; canvas.height = ch;
    
    const ctx = canvas.getContext('2d');
    
    // Fake image rendering (metal part)
    ctx.fillStyle = '#2A2C3A';
    ctx.fillRect(0,0,cw,ch);
    
    ctx.strokeStyle = '#555A7A';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(cw/2, ch/2 + 20, 80, 0, Math.PI);
    ctx.stroke();
    
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cw/2, ch/2 - 20, 40, Math.PI, Math.PI*2);
    ctx.stroke();

    // BBoxes (Défauts détectés)
    ctx.strokeStyle = '#FF4567'; // Rouge (Bavure, Critique)
    ctx.lineWidth = 2;
    ctx.strokeRect(cw/2 + 60, ch/2 + 10, 30, 30);
    ctx.fillStyle = 'rgba(255, 69, 103, 0.2)';
    ctx.fillRect(cw/2 + 60, ch/2 + 10, 30, 30);
    ctx.fillStyle = '#FF4567';
    ctx.font = 'bold 10px Inter';
    ctx.fillText('Bavure 0.94', cw/2 + 60, ch/2 + 6);
    
    ctx.strokeStyle = '#FF9500'; // Orange (Rayure, Majeur)
    ctx.strokeRect(cw/2 - 30, ch/2 - 50, 60, 20);
    ctx.fillStyle = 'rgba(255, 149, 0, 0.15)';
    ctx.fillRect(cw/2 - 30, ch/2 - 50, 60, 20);
    ctx.fillStyle = '#FF9500';
    ctx.fillText('Rayure 0.68', cw/2 - 30, ch/2 - 54);
}

function drawLiveGradCAM() {
    const canvas = document.getElementById('live-gradcam-canvas');
    if (!canvas) return;
    
    const cw = canvas.parentElement.clientWidth;
    const ch = canvas.parentElement.clientHeight;
    canvas.width = cw; canvas.height = ch;
    
    const ctx = canvas.getContext('2d');
    
    // Draw base shape desaturated
    ctx.fillStyle = '#1A1C25';
    ctx.fillRect(0,0,cw,ch);
    ctx.strokeStyle = '#4A4C5A';
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(cw/2, ch/2 + 20, 80, 0, Math.PI); ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cw/2, ch/2 - 20, 40, Math.PI, Math.PI*2); ctx.stroke();

    // Heatmap Overlay
    for (let x = 0; x < cw; x+=3) {
        for (let y = 0; y < ch; y+=3) {
            const tx = x / cw, ty = y / ch;
            // Hotspot 1 : Bavure (fort)
            const d1 = Math.pow(x - (cw/2 + 75), 2) + Math.pow(y - (ch/2 + 25), 2);
            const val1 = Math.exp(-d1 / 1500) * 0.95;
            
            // Hotspot 2 : Rayure (modéré)
            const d2 = Math.pow(x - (cw/2), 2) + Math.pow(y - (ch/2 - 40), 2);
            const val2 = Math.exp(-d2 / 2000) * 0.6;
            
            const hotspot = val1 + val2;
            
            if(hotspot > 0.1) {
                const r = Math.round(Math.min(255, hotspot * 350));
                const g = Math.round(Math.max(0, Math.min(255, (1 - hotspot) * 200)));
                const b = Math.round(Math.max(0, (1 - hotspot * 2) * 80));
                ctx.fillStyle = `rgba(${r},${g},${b},${hotspot*0.8})`;
                ctx.fillRect(x, y, 3, 3);
            }
        }
    }
}

let camRunning = false;
let inferenceInterval = null;

function toggleCam(btn) {
    camRunning = !camRunning;
    const ind = document.getElementById('cam-indicator');
    if (ind) ind.style.display = camRunning ? 'block' : 'none';
    
    if (camRunning) {
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Arrêter l\'inspection continue';
        
        // Simuler des inférences qui arrivent dans l'historique
        inferenceInterval = setInterval(() => {
            const tbody = document.getElementById('live-history-body');
            if(tbody) {
                const frames = Date.now().toString().slice(-4);
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--border)';
                
                // Randomly generate Normal or Anormal
                const isAnorm = Math.random() > 0.7;
                const v = isAnorm ? 'ANORMAL (1)' : 'NORMAL';
                const tag = isAnorm ? 'tag-red' : 'tag-green';
                const d = isAnorm ? 'Rayure (0.74)' : '—';
                
                const timeStr = new Date().toISOString().substring(11, 21);
                
                tr.innerHTML = `
                  <td style="padding:9px 12px;font-weight:500;">frame_${frames}.jpg</td>
                  <td style="padding:9px 12px;text-align:center;"><span class="tag ${tag}">${v}</span></td>
                  <td style="padding:9px 12px;text-align:center;color:var(--text-secondary);">${d}</td>
                  <td style="padding:9px 12px;color:var(--text-secondary);">YOLOv8_Detect_v3</td>
                  <td style="padding:9px 12px;color:var(--text-muted);font-family:monospace;">${timeStr}</td>
                `;
                tbody.insertBefore(tr, tbody.firstChild);
                
                // Keep only top 10 rows
                if (tbody.children.length > 10) {
                    tbody.removeChild(tbody.lastChild);
                }
            }
        }, 1500);

    } else {
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> Lancer la Caméra (Inspection ligne)';
        if(inferenceInterval) clearInterval(inferenceInterval);
    }
}

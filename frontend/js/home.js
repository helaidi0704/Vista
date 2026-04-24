/* ==========================================
   Home Page — VISTA (Vision)
   ========================================== */

function initHome(container) {
    container.innerHTML = `
  <div class="fade-in">
    <!-- Hero -->
    <div class="card" style="background:linear-gradient(135deg,var(--bg-card),var(--bg-primary));margin-bottom:24px;padding:36px 32px;position:relative;overflow:hidden;">
      <div style="position:absolute;top:-60px;right:-60px;width:280px;height:280px;background:radial-gradient(circle,rgba(224,108,0,0.15),transparent 70%);border-radius:50%;"></div>
      <div style="position:absolute;bottom:-40px;left:200px;width:200px;height:200px;background:radial-gradient(circle,rgba(0,199,190,0.1),transparent 70%);border-radius:50%;"></div>
      <div style="position:relative;z-index:1;">
        <div style="display:flex;gap:10px;margin-bottom:16px;">
          <span class="tag tag-accent">v1.0 Beta</span>
          <span class="tag tag-cyan">Computer Vision & IA</span>
        </div>
        <h2 style="font-size:28px;font-weight:800;margin-bottom:10px;background:linear-gradient(135deg,#F2F2F7,var(--accent-light));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
          Inspection Visuelle des Défauts Industriels
        </h2>
        <p style="color:var(--text-secondary);font-size:14px;max-width:540px;line-height:1.7;">
          Visualisez, annotez, et comparez vos images de production. Augmentez vos données, concevez des modèles de segmentation/détection, et testez-les en direct avec explicabilité.
        </p>
        <div style="display:flex;gap:10px;margin-top:24px;">
          <button class="btn btn-primary" onclick="navigate('viewer')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            Commencer l'inspection
          </button>
          <button class="btn btn-secondary" onclick="navigate('training')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
            Construire un modèle
          </button>
        </div>
      </div>
    </div>

    <!-- KPI row -->
    <div class="grid-4" style="margin-bottom:24px;">
      ${[
            { label: 'Images inspectées', value: '14 247', delta: '+1.4k ce mois', icon: '📷', color: '--accent' },
            { label: 'Modèles vision', value: '18', delta: '5 en prod (YOLO/ResNet)', icon: '👁️', color: '--cyan' },
            { label: 'Défauts détectés', value: '942', delta: '96.2% précision', icon: '⚠️', color: '--orange' },
            { label: 'BBox / Calques', value: '38 680', delta: 'sur 12 datasets', icon: '🏷️', color: '--green' },
        ].map(k => `
        <div class="card" style="padding:20px;">
          <div style="font-size:26px;margin-bottom:8px;">${k.icon}</div>
          <div style="font-size:24px;font-weight:800;color:var(${k.color});">${k.value}</div>
          <div style="font-size:13px;font-weight:600;margin-top:2px;">${k.label}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${k.delta}</div>
        </div>
      `).join('')}
    </div>

    <!-- Briques grid -->
    <p class="section-title">Modules de la plateforme Framework</p>
    <div class="grid-3" style="margin-bottom:24px;">
      ${[
            { id: 'viewer', num: '01', name: 'Visualiseur & Annotation', desc: 'Chargez, zoomez et annotez vos images (sélection carrée, outils de contour au crayon). Descriptions textuelles.', color: '#E06C00', icon: '✏️' },
            { id: 'analysis', num: '02', name: 'Analyse & Comparaison', desc: 'Comparez des images, testez filtres, analyses spectrales (FFT), ou Data Aug. (Crop, Mixup) en masse.', color: '#00C7BE', icon: '🔍' },
            { id: 'training', num: '03', name: 'Entraînement', desc: 'Pipeline Drag & Drop pour chaîner vos traitements et modèles de Computer Vision (CNN, ViT, YOLO).', color: '#FFD60A', icon: '⚙️' },
            { id: 'testing', num: '04', name: 'Test en live', desc: "Uploadez ou capturez via webcam. Explicabilité de chaque décision (Grad-CAM, Visualisation d'activations).", color: '#32D74B', icon: '🎥' },
            { id: 'deployment', num: '05', name: 'Déploiement', desc: 'Exportez sous différents formats (ONNX, TensorRT, API) pour intégration immédiate sur lignes.', color: '#FF453A', icon: '🚀' },
        ].map(b => `
        <div class="card" style="cursor:pointer;transition:all 0.2s ease;border-color:transparent;" 
             onclick="navigate('${b.id}')"
             onmouseenter="this.style.borderColor='${b.color}40';this.style.transform='translateY(-3px)'"
             onmouseleave="this.style.borderColor='transparent';this.style.transform='translateY(0)'">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            <div style="width:42px;height:42px;background:${b.color}20;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;">${b.icon}</div>
            <div>
              <div style="font-size:10px;color:${b.color};font-weight:700;letter-spacing:0.1em;">BRIQUE ${b.num}</div>
              <div style="font-size:15px;font-weight:700;">${b.name}</div>
            </div>
          </div>
          <p style="font-size:12.5px;color:var(--text-secondary);line-height:1.6;">${b.desc}</p>
          <div style="margin-top:14px;display:flex;align-items:center;gap:4px;color:${b.color};font-size:12px;font-weight:600;">
            Accéder <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </div>
        </div>
      `).join('')}

      <!-- Recent activity card -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Activité récente
          </span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${[
            { text: 'Tracé libre (fissure) sur carter_moteur_082.jpg', time: 'Il y a 5 min', dot: '--accent' },
            { text: 'Modèle YOLOv8_Detect_v3 affiné (mAP: 86.4%)', time: 'Il y a 1h', dot: '--green' },
            { text: 'Export ONNX finalisé pour Edge Deployment', time: 'Il y a 3h', dot: '--cyan' },
            { text: '200 images augmentées générées (Crop + Mixup)', time: 'Il y a 6h', dot: '--orange' },
        ].map(a => `
            <div style="display:flex;align-items:flex-start;gap:10px;">
              <div style="width:8px;height:8px;border-radius:50%;background:var(${a.dot});margin-top:5px;flex-shrink:0;"></div>
              <div>
                <div style="font-size:12px;">${a.text}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${a.time}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

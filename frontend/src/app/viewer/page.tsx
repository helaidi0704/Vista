"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import type { Dataset, VImage, Annotation } from "@/lib/types";
import { SEVERITY_CONFIG, DEFAULT_DEFECT_CLASSES } from "@/lib/types";

export default function ViewerPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDs, setSelectedDs] = useState<Dataset | null>(null);
  const [images, setImages] = useState<VImage[]>([]);
  const [selectedImg, setSelectedImg] = useState<VImage | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [tool, setTool] = useState<"pan" | "rect" | "draw">("rect");
  const [defectType, setDefectType] = useState("Rayure profonde");
  const [severity, setSeverity] = useState("Critique");
  const [description, setDescription] = useState("Rayure profonde orientée à 45° sur la zone d'épaulement droite.");
  const [hoveredAnnot, setHoveredAnnot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const imgCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedImgRef = useRef<HTMLImageElement | null>(null);
  const imgRectRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Fetch datasets
  useEffect(() => {
    api.get("/api/v1/datasets").then(({ data }) => {
      setDatasets(data);
      if (data.length > 0) setSelectedDs(data[0]);
    }).catch(() => {});
  }, []);

  // Fetch images
  useEffect(() => {
    if (!selectedDs) return;
    api.get(`/api/v1/images?dataset_id=${selectedDs.id}`).then(({ data }) => {
      setImages(data);
      if (data.length > 0) setSelectedImg(data[0]);
    }).catch(() => {});
  }, [selectedDs]);

  // Fetch annotations
  useEffect(() => {
    if (!selectedImg) { setAnnotations([]); return; }
    api.get(`/api/v1/annotations/${selectedImg.id}`).then(({ data }) => {
      setAnnotations(data.map((a: any) => ({ ...a, _saved: true, _fabricId: a.id })));
    }).catch(() => setAnnotations([]));
  }, [selectedImg]);

  // Draw image + annotations on canvas
  const drawAll = useCallback(() => {
    const container = containerRef.current;
    const imgCanvas = imgCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    if (!container || !imgCanvas || !drawCanvas) return;

    const W = container.clientWidth;
    const H = container.clientHeight;
    imgCanvas.width = W; imgCanvas.height = H;
    drawCanvas.width = W; drawCanvas.height = H;

    const ctx = imgCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const img = loadedImgRef.current;
    if (img) {
      const ratio = img.width / img.height;
      const cRatio = W / H;
      let dw = W, dh = H;
      if (ratio > cRatio) dh = W / ratio; else dw = H * ratio;
      const ir = { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
      imgRectRef.current = ir;
      ctx.drawImage(img, ir.x, ir.y, ir.w, ir.h);
    }

    // Draw annotations
    const dtx = drawCanvas.getContext("2d");
    if (!dtx) return;
    dtx.clearRect(0, 0, W, H);
    const ir = imgRectRef.current;
    if (ir.w === 0) return;

    annotations.forEach((ann) => {
      const isHovered = ann._fabricId === hoveredAnnot || ann.id === hoveredAnnot;
      let colorMain = "#00C7BE", colorFill = "rgba(0,199,190,0.15)";
      if (ann.severity === "critical" || ann.severity === "high") { colorMain = "#FF453A"; colorFill = "rgba(255,69,58,0.2)"; }
      if (ann.severity === "medium") { colorMain = "#FFD60A"; colorFill = "rgba(255,214,10,0.2)"; }

      if (isHovered) { dtx.shadowColor = colorMain; dtx.shadowBlur = 10; colorFill = colorFill.replace("0.2)", "0.4)").replace("0.15)", "0.3)"); }
      else dtx.shadowBlur = 0;

      dtx.lineWidth = isHovered ? 3 : 2;
      dtx.strokeStyle = colorMain;

      if (ann.shape === "bbox" && ann.coordinates) {
        const c = ann.coordinates as any;
        const rx = ir.x + (c.nx || 0) * ir.w;
        const ry = ir.y + (c.ny || 0) * ir.h;
        const rw = (c.nw || 0.1) * ir.w;
        const rh = (c.nh || 0.1) * ir.h;
        dtx.strokeRect(rx, ry, rw, rh);
        dtx.fillStyle = colorFill;
        dtx.fillRect(rx, ry, rw, rh);
        // Label
        dtx.shadowBlur = 0;
        dtx.fillStyle = colorMain;
        const txt = ann.defect_class || "Défaut";
        const tw = dtx.measureText(txt).width + 8;
        dtx.fillRect(rx, ry - 16, tw, 16);
        dtx.fillStyle = "#121316";
        dtx.font = "bold 10px Inter, sans-serif";
        dtx.fillText(txt, rx + 4, ry - 4);
      } else if (ann.shape === "freehand" && (ann.coordinates as any)?.points) {
        dtx.beginPath();
        (ann.coordinates as any).points.forEach((pt: any, idx: number) => {
          const px = ir.x + pt.nx * ir.w;
          const py = ir.y + pt.ny * ir.h;
          idx === 0 ? dtx.moveTo(px, py) : dtx.lineTo(px, py);
        });
        dtx.closePath();
        dtx.stroke();
        dtx.fillStyle = colorFill;
        dtx.fill();
      }
    });
    dtx.shadowBlur = 0;
  }, [annotations, hoveredAnnot]);

  // Load image file
  useEffect(() => {
    if (!selectedImg) { loadedImgRef.current = null; drawAll(); return; }
    // Try loading from MinIO or use placeholder
    if (selectedImg.thumbnail_url) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = selectedImg.thumbnail_url;
      img.onload = () => { loadedImgRef.current = img; drawAll(); };
      img.onerror = () => { loadedImgRef.current = null; drawAll(); };
    } else {
      // Try loading demo asset
      const img = new Image();
      img.src = "/assets/carter_moteur.png";
      img.onload = () => { loadedImgRef.current = img; drawAll(); };
      img.onerror = () => { loadedImgRef.current = null; drawAll(); };
    }
  }, [selectedImg, drawAll]);

  useEffect(() => { drawAll(); }, [drawAll]);
  useEffect(() => {
    const handler = () => drawAll();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [drawAll]);

  // Drawing interaction
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    let isDrawing = false;
    const dtx = canvas.getContext("2d");
    if (!dtx) return;

    const onDown = () => { isDrawing = true; };
    const onMove = (e: MouseEvent) => {
      if (!isDrawing) return;
      const rect = canvas.getBoundingClientRect();
      dtx.strokeStyle = "#E06C00";
      dtx.lineWidth = 2;
      dtx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
      dtx.stroke();
    };
    const onUp = () => { isDrawing = false; dtx.beginPath(); setTimeout(drawAll, 500); };

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseup", onUp);
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseup", onUp);
    };
  }, [drawAll]);

  // Save annotation
  async function saveAnnotation() {
    if (!selectedImg) return;
    setSaving(true);
    try {
      const sevMap: Record<string, string> = { Critique: "critical", Majeur: "high", Mineur: "low" };
      await api.post("/api/v1/annotations", {
        image_id: selectedImg.id,
        shape: "bbox",
        coordinates: { nx: 0.1 + Math.random() * 0.6, ny: 0.1 + Math.random() * 0.6, nw: 0.15, nh: 0.2 },
        defect_class: defectType,
        severity: sevMap[severity] || "medium",
        description,
      });
      // Refresh
      const { data } = await api.get(`/api/v1/annotations/${selectedImg.id}`);
      setAnnotations(data.map((a: any) => ({ ...a, _saved: true, _fabricId: a.id })));
    } catch (e) { console.error(e); }
    setSaving(false);
  }

  function deleteAnnotation(id: string) {
    setAnnotations((prev) => prev.filter((a) => a.id !== id && a._fabricId !== id));
  }

  const sevLabel = (s: string) => {
    if (s === "critical" || s === "high") return "Critique";
    if (s === "medium") return "Majeur";
    return "Mineur";
  };
  const sevCls = (s: string) => {
    if (s === "critical" || s === "high") return "tag-red";
    if (s === "medium") return "tag-orange";
    return "tag-green";
  };

  return (
    <div className="fade-in">
      {/* File picker row */}
      <div className="flex gap-3 items-center flex-wrap" style={{ marginBottom: 20 }}>
        <div className="card flex items-center gap-3" style={{ flex: 1, minWidth: 260, padding: "14px 18px" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedImg?.filename || "Aucune image"}</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>
              {selectedImg ? `${selectedImg.format.toUpperCase()} · ${selectedImg.width || "?"}x${selectedImg.height || "?"} ` : "Sélectionnez une image"}
            </div>
          </div>
          <span className="tag tag-orange">À Inspecter</span>
        </div>
        <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
          Importer image
          <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
            if (!selectedDs || !e.target.files?.[0]) return;
            const fd = new FormData(); fd.append("files", e.target.files[0]);
            await api.post(`/api/v1/images/upload?dataset_id=${selectedDs.id}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
            const { data } = await api.get(`/api/v1/images?dataset_id=${selectedDs.id}`);
            setImages(data); if (data.length) setSelectedImg(data[0]);
          }} />
        </label>
        <select className="form-select" style={{ width: 220, fontSize: 12 }}
          value={selectedDs?.id || ""} onChange={(e) => setSelectedDs(datasets.find(d => d.id === e.target.value) || null)}>
          {datasets.map(d => <option key={d.id} value={d.id}>{d.name} ({d.image_count} img)</option>)}
        </select>
      </div>

      {/* Main grid: canvas (2/3) + annotation panel (1/3) */}
      <div className="grid grid-cols-3 gap-4">
        {/* Canvas area */}
        <div className="card col-span-2 flex flex-col">
          <div className="card-header">
            <span className="card-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              Éditeur Interactif
            </span>
            <div className="flex gap-2 items-center">
              {[
                { id: "pan", label: "Main", svg: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 00-12 0v7h12V8z"/><path d="M9 15v4m6-4v4"/></svg> },
                { id: "rect", label: "BBox", svg: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> },
                { id: "draw", label: "Crayon", svg: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg> },
              ].map(t => (
                <button key={t.id} className={`btn btn-sm ${tool === t.id ? "btn-primary" : "btn-secondary"}`}
                  title={t.label} onClick={() => setTool(t.id as any)}>
                  {t.svg}
                </button>
              ))}
              <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
              <span style={{ fontSize: 11, color: "var(--text3)" }}>Zoom: 100%</span>
              <input type="range" min="0.5" max="3" defaultValue="1" step="0.1" style={{ width: 80, accentColor: "var(--accent)" }} />
            </div>
          </div>
          <div ref={containerRef} className="viz-placeholder"
            style={{ flex: 1, minHeight: 380, cursor: tool === "pan" ? "grab" : tool === "draw" ? "crosshair" : "crosshair", position: "relative", overflow: "hidden", background: "#0D0E1A" }}>
            <canvas ref={imgCanvasRef} style={{ position: "absolute", top: 0, left: 0 }} />
            <canvas ref={drawCanvasRef} style={{ position: "absolute", top: 0, left: 0 }} />
          </div>
        </div>

        {/* Annotation panel */}
        <div className="card flex flex-col">
          <div className="card-header">
            <span className="card-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
              Propriétés d&apos;Annotation
            </span>
          </div>

          <div className="flex flex-col gap-3" style={{ marginBottom: 12 }}>
            <label className="form-label">Type de défaut</label>
            <select className="form-select" value={defectType} onChange={e => setDefectType(e.target.value)}>
              {["Rayure profonde", "Fissure (micro)", "Décoloration / Tâche", "Défaut d'usinage (Bavure)", "Pièce manquante"].map(o => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5" style={{ marginBottom: 12 }}>
            <label className="form-label">Sévérité du défaut</label>
            <div className="flex gap-2">
              {["Critique", "Majeur", "Mineur"].map(s => (
                <button key={s} onClick={() => setSeverity(s)}
                  className={`btn btn-sm ${severity === s ? (s === "Critique" ? "btn-danger" : s === "Majeur" ? "" : "btn-success") : "btn-secondary"}`}
                  style={{ flex: 1, ...(severity === s && s === "Majeur" ? { background: "rgba(255,214,10,0.15)", color: "var(--orange)", border: "1px solid rgba(255,214,10,0.3)" } : {}) }}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5" style={{ marginBottom: 12 }}>
            <label className="form-label">Description détaillée contextuelle</label>
            <textarea className="form-textarea" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Ex: Rayure longitudinale causée par un frottement outil sur l'axe X..."
              style={{ minHeight: 80, resize: "vertical", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)", fontSize: 13, padding: "9px 12px", fontFamily: "inherit" }} />
          </div>

          <div className="flex flex-col gap-1.5" style={{ marginBottom: 16 }}>
            <label className="form-label">Calque courant</label>
            <div className="flex gap-2 items-center" style={{ background: "var(--bg-input)", padding: "8px 12px", borderRadius: 6 }}>
              <div style={{ width: 12, height: 12, border: "2px solid var(--accent)", borderRadius: 2 }} />
              <span style={{ fontSize: 12, flex: 1 }}>Shape_{String(annotations.length + 1).padStart(2, "0")} (BBox)</span>
              <button style={{ padding: 4, background: "none", border: "none", cursor: "pointer" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </div>
          </div>

          <button className="btn btn-primary" style={{ width: "100%", marginTop: "auto" }} onClick={saveAnnotation} disabled={saving}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {saving ? "Sauvegarde..." : "Enregistrer les annotations"}
          </button>
        </div>
      </div>

      {/* Annotations table */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <span className="card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Liste des objets annotés sur cette image
          </span>
          <span style={{ fontSize: 12, color: "var(--text3)" }}>{annotations.length} annotation(s) trouvée(s)</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "var(--text3)" }}>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>Type de Forme</th>
              <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>Classe (Défaut)</th>
              <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>Sévérité</th>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>Description textuelle</th>
              <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {annotations.map((ann) => (
              <tr key={ann.id || ann._fabricId} style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={() => { setHoveredAnnot(ann.id || ann._fabricId || null); setTimeout(drawAll, 10); }}
                onMouseLeave={() => { setHoveredAnnot(null); setTimeout(drawAll, 10); }}>
                <td style={{ padding: "9px 12px", fontWeight: 500 }}>
                  {ann.shape === "bbox" ? "🟥 BBox" : "〰️ Tracé libre"}
                </td>
                <td style={{ padding: "9px 12px", textAlign: "center" }}>{ann.defect_class}</td>
                <td style={{ padding: "9px 12px", textAlign: "center" }}>
                  <span className={`tag ${sevCls(ann.severity)}`}>{sevLabel(ann.severity)}</span>
                </td>
                <td style={{ padding: "9px 12px", color: "var(--text2)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ann.description || "—"}
                </td>
                <td style={{ padding: "9px 12px", textAlign: "center" }}>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteAnnotation(ann.id || ann._fabricId || "")}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
                  </button>
                </td>
              </tr>
            ))}
            {annotations.length === 0 && (
              <tr><td colSpan={5} style={{ padding: "20px 12px", textAlign: "center", color: "var(--text3)" }}>Aucune annotation — dessinez sur l&apos;image pour commencer</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import type { Dataset, VImage, Annotation, BBoxCoords } from "@/lib/types";

export default function ViewerPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDs, setSelectedDs] = useState<Dataset | null>(null);
  const [images, setImages] = useState<VImage[]>([]);
  const [selectedImg, setSelectedImg] = useState<VImage | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [tool, setTool] = useState<"pan" | "rect" | "draw">("rect");
  const [defectType, setDefectType] = useState("Defaut surface");
  const [severity, setSeverity] = useState("critical");
  const [description, setDescription] = useState("");
  const [hoveredAnnot, setHoveredAnnot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [imgPage, setImgPage] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedImgRef = useRef<HTMLImageElement | null>(null);
  const irRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const drawingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const curRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    api.get("/api/v1/datasets").then(({ data }) => {
      setDatasets(data);
      if (data.length > 0) setSelectedDs(data[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedDs) return;
    api.get("/api/v1/images?dataset_id=" + selectedDs.id).then(({ data }) => {
      setImages(data);
      setSelectedImg(data.length > 0 ? data[0] : null);
      setImgPage(0);
    }).catch(() => {});
  }, [selectedDs]);

  useEffect(() => {
    if (!selectedImg) { setImageUrl(null); setAnnotations([]); return; }
    api.get("/api/v1/analysis/image-url/" + selectedImg.id)
      .then(({ data }) => setImageUrl(data.url || data.thumbnail_url))
      .catch(() => setImageUrl(null));
    api.get("/api/v1/annotations/" + selectedImg.id)
      .then(({ data }) => setAnnotations(data.map((a: any) => ({ ...a, _saved: true, _fabricId: a.id }))))
      .catch(() => setAnnotations([]));
  }, [selectedImg]);

  useEffect(() => {
    if (!imageUrl) { loadedImgRef.current = null; redraw(); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { loadedImgRef.current = img; redraw(); };
    img.onerror = () => { loadedImgRef.current = null; redraw(); };
    img.src = imageUrl;
  }, [imageUrl]);

  const redraw = useCallback(() => {
    const c = canvasRef.current, ct = containerRef.current;
    if (!c || !ct) return;
    const W = ct.clientWidth, H = ct.clientHeight;
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    if (!x) return;
    x.fillStyle = "#0D0E1A"; x.fillRect(0, 0, W, H);
    const img = loadedImgRef.current;
    if (img) {
      const s = (zoom / 100) * Math.min(W / img.width, H / img.height);
      const dw = img.width * s, dh = img.height * s;
      const ir = { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
      irRef.current = ir;
      x.drawImage(img, ir.x, ir.y, ir.w, ir.h);
    } else {
      x.fillStyle = "#636366"; x.font = "14px Inter"; x.textAlign = "center";
      x.fillText(selectedImg ? "Chargement..." : "Selectionnez une image", W / 2, H / 2);
      x.textAlign = "left"; return;
    }
    const ir = irRef.current;
    annotations.forEach(a => {
      if (a.shape !== "bbox") return;
      const co = a.coordinates as BBoxCoords;
      const rx = ir.x + co.nx * ir.w, ry = ir.y + co.ny * ir.h;
      const rw = co.nw * ir.w, rh = co.nh * ir.h;
      const hov = (a.id || a._fabricId) === hoveredAnnot;
      let col = "#00C7BE";
      if (a.severity === "critical" || a.severity === "high") col = "#FF453A";
      else if (a.severity === "medium") col = "#FFD60A";
      if (hov) { x.shadowColor = col; x.shadowBlur = 12; }
      x.strokeStyle = col; x.lineWidth = hov ? 3 : 2;
      x.setLineDash(a._saved === false ? [6, 3] : []);
      x.strokeRect(rx, ry, rw, rh);
      x.fillStyle = col + (hov ? "30" : "15");
      x.fillRect(rx, ry, rw, rh);
      x.shadowBlur = 0; x.setLineDash([]);
      const lb = a.defect_class + " (" + a.severity + ")";
      x.font = "bold 10px Inter";
      const tw = x.measureText(lb).width + 8;
      x.fillStyle = col; x.fillRect(rx, ry - 16, tw, 16);
      x.fillStyle = "#121316"; x.fillText(lb, rx + 4, ry - 4);
    });
    if (curRectRef.current) {
      const r = curRectRef.current;
      x.strokeStyle = "#E06C00"; x.lineWidth = 2; x.setLineDash([6, 3]);
      x.strokeRect(r.x, r.y, r.w, r.h);
      x.fillStyle = "rgba(224,108,0,0.1)"; x.fillRect(r.x, r.y, r.w, r.h);
      x.setLineDash([]);
    }
  }, [annotations, hoveredAnnot, zoom, selectedImg, imageUrl]);

  useEffect(() => { redraw(); }, [redraw]);
  useEffect(() => {
    const h = () => redraw();
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [redraw]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || tool !== "rect") return;
    c.style.cursor = "crosshair";
    const dn = (e: MouseEvent) => {
      if (!loadedImgRef.current) return;
      const r = c.getBoundingClientRect();
      drawingRef.current = true;
      startRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      curRectRef.current = { x: startRef.current.x, y: startRef.current.y, w: 0, h: 0 };
    };
    const mv = (e: MouseEvent) => {
      if (!drawingRef.current) return;
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      curRectRef.current = {
        x: Math.min(startRef.current.x, mx), y: Math.min(startRef.current.y, my),
        w: Math.abs(mx - startRef.current.x), h: Math.abs(my - startRef.current.y),
      };
      redraw();
    };
    const up = () => {
      if (!drawingRef.current || !curRectRef.current) return;
      drawingRef.current = false;
      const r = curRectRef.current; curRectRef.current = null;
      if (r.w < 10 || r.h < 10) { redraw(); return; }
      const ir = irRef.current;
      if (ir.w === 0) return;
      const nx = Math.max(0, Math.min(1, (r.x - ir.x) / ir.w));
      const ny = Math.max(0, Math.min(1, (r.y - ir.y) / ir.h));
      const nw = Math.max(0, Math.min(1 - nx, r.w / ir.w));
      const nh = Math.max(0, Math.min(1 - ny, r.h / ir.h));
      setAnnotations(p => [...p, {
        image_id: selectedImg?.id || "", shape: "bbox",
        coordinates: { nx, ny, nw, nh }, defect_class: defectType,
        severity: severity as any, description: description || undefined,
        _fabricId: "ann_" + Date.now(), _saved: false,
      }]);
    };
    c.addEventListener("mousedown", dn);
    c.addEventListener("mousemove", mv);
    c.addEventListener("mouseup", up);
    return () => { c.removeEventListener("mousedown", dn); c.removeEventListener("mousemove", mv); c.removeEventListener("mouseup", up); };
  }, [tool, defectType, severity, description, selectedImg, redraw]);

  useEffect(() => {
    const c = canvasRef.current;
    if (c) c.style.cursor = tool === "pan" ? "grab" : "crosshair";
  }, [tool]);

  async function save() {
    if (!selectedImg) return;
    const us = annotations.filter(a => !a._saved);
    if (!us.length) return;
    setSaving(true);
    try {
      for (const a of us) {
        const { data } = await api.post("/api/v1/annotations", {
          image_id: selectedImg.id, shape: a.shape, coordinates: a.coordinates,
          defect_class: a.defect_class, severity: a.severity, description: a.description,
        });
        setAnnotations(p => p.map(x => x._fabricId === a._fabricId ? { ...x, id: data.id, _saved: true } : x));
      }
    } catch (e) { console.error(e); }
    setSaving(false);
  }

  async function upload(files: FileList | File[]) {
    if (!selectedDs) return;
    setUploading(true);
    const fd = new FormData();
    Array.from(files).forEach(f => fd.append("files", f));
    try {
      await api.post("/api/v1/images/upload?dataset_id=" + selectedDs.id, fd, { headers: { "Content-Type": "multipart/form-data" } });
      const { data } = await api.get("/api/v1/images?dataset_id=" + selectedDs.id);
      setImages(data);
      if (data.length > 0 && !selectedImg) setSelectedImg(data[0]);
    } catch (e) { console.error(e); }
    setUploading(false);
  }

  const sevL = (s: string) => ({ critical: "Critique", high: "Majeur", medium: "Majeur", low: "Mineur" }[s] || s);
  const sevC = (s: string) => s === "critical" || s === "high" ? "tag-red" : s === "medium" ? "tag-orange" : "tag-green";
  const unsaved = annotations.filter(a => !a._saved).length;
  const PP = 10, paged = images.slice(imgPage * PP, (imgPage + 1) * PP), pages = Math.ceil(images.length / PP);

  return (
    <div className="fade-in">
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <div className="card" style={{ flex: 1, minWidth: 260, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedImg?.filename || "Aucune image"}</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>{selectedImg ? selectedImg.format.toUpperCase() + " - " + (selectedImg.width || 512) + "x" + (selectedImg.height || 512) : "Selectionnez une image"}</div>
          </div>
          <span className="tag tag-orange">A Inspecter</span>
        </div>
        <select className="form-select" style={{ width: 240, fontSize: 12 }} value={selectedDs?.id || ""} onChange={e => { const d = datasets.find(x => x.id === e.target.value); if (d) { setSelectedDs(d); setImgPage(0); } }}>
          {datasets.map(d => <option key={d.id} value={d.id}>{d.name} ({d.image_count})</option>)}
        </select>
        <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>
          {uploading ? "Upload..." : "Importer"}
          <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => e.target.files && upload(e.target.files)} />
        </label>
      </div>

      <div className="card" style={{ padding: "10px 14px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>Images ({images.length})</span>
          {pages > 1 && <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button className="btn btn-sm btn-secondary" disabled={imgPage === 0} onClick={() => setImgPage(p => p - 1)}>&#9664;</button>
            <span style={{ fontSize: 11, color: "var(--text3)", padding: "4px 8px" }}>{imgPage + 1}/{pages}</span>
            <button className="btn btn-sm btn-secondary" disabled={imgPage >= pages - 1} onClick={() => setImgPage(p => p + 1)}>&#9654;</button>
          </div>}
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          {paged.map(img => (
            <div key={img.id} onClick={() => setSelectedImg(img)} style={{ width: 80, height: 70, borderRadius: 6, overflow: "hidden", cursor: "pointer", border: selectedImg?.id === img.id ? "2px solid var(--accent)" : "2px solid transparent", background: "var(--bg-input)", flexShrink: 0 }}>
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "var(--text3)", textAlign: "center", padding: 4, wordBreak: "break-all", background: selectedImg?.id === img.id ? "rgba(224,108,0,0.1)" : "transparent" }}>
                {img.filename.includes("def") ? "\uD83D\uDD34" : img.filename.includes("ok") ? "\uD83D\uDFE2" : "\uD83D\uDCF7"}<br />{img.filename.replace("cast_", "").replace(".jpeg", "")}
              </div>
            </div>
          ))}
          {paged.length === 0 && <div style={{ flex: 1, minHeight: 70, display: "flex", alignItems: "center", justifyContent: "center", border: "2px dashed var(--border)", borderRadius: 8, color: "var(--text3)", fontSize: 12 }}>Aucune image</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-header">
            <span className="card-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>Editeur Interactif</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {(["pan", "rect", "draw"] as const).map(t => <button key={t} className={"btn btn-sm " + (tool === t ? "btn-primary" : "btn-secondary")} onClick={() => setTool(t)}>{t === "pan" ? "Main" : t === "rect" ? "BBox" : "Crayon"}</button>)}
              <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
              <span style={{ fontSize: 11, color: "var(--text3)" }}>Zoom: {zoom}%</span>
              <input type="range" min="50" max="300" value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ width: 80, accentColor: "var(--accent)" }} />
              <button className="btn btn-sm btn-secondary" onClick={() => setZoom(100)}>Reset</button>
            </div>
          </div>
          <div ref={containerRef} className="viz-placeholder" style={{ flex: 1, minHeight: 420, position: "relative", overflow: "hidden", background: "#0D0E1A" }}>
            <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} />
          </div>
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-header">
            <span className="card-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></svg>Proprietes</span>
            {unsaved > 0 && <span className="tag tag-accent">{unsaved} new</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            <div>
              <label className="form-label">Type de defaut</label>
              <select className="form-select" style={{ marginTop: 6 }} value={defectType} onChange={e => setDefectType(e.target.value)}>
                {(selectedDs?.defect_classes || ["Defaut surface", "OK"]).map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Severite</label>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                {[{ id: "critical", l: "Critique", bg: "rgba(255,69,58,0.15)", c: "var(--red)", bc: "rgba(255,69,58,0.3)" },
                  { id: "medium", l: "Majeur", bg: "rgba(255,214,10,0.15)", c: "var(--orange)", bc: "rgba(255,214,10,0.3)" },
                  { id: "low", l: "Mineur", bg: "rgba(0,199,190,0.15)", c: "var(--green)", bc: "rgba(0,199,190,0.3)" }].map(s =>
                  <button key={s.id} className="btn btn-sm" style={{ flex: 1, background: severity === s.id ? s.bg : "var(--bg-input)", color: severity === s.id ? s.c : "var(--text2)", border: "1px solid " + (severity === s.id ? s.bc : "var(--border)") }} onClick={() => setSeverity(s.id)}>{s.l}</button>
                )}
              </div>
            </div>
            <div>
              <label className="form-label">Description</label>
              <textarea className="form-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: Rayure sur axe X..." style={{ marginTop: 6, minHeight: 70, resize: "vertical", fontFamily: "inherit" }} />
            </div>
            <div>
              <label className="form-label">Calque</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", background: "var(--bg-input)", padding: "8px 12px", borderRadius: 6, marginTop: 6 }}>
                <div style={{ width: 12, height: 12, border: "2px solid var(--accent)", borderRadius: 2 }} />
                <span style={{ fontSize: 12, flex: 1 }}>Shape_{String(annotations.length + 1).padStart(2, "0")} (BBox)</span>
              </div>
            </div>
          </div>
          <button className="btn btn-primary" style={{ width: "100%", marginTop: 16, justifyContent: "center" }} onClick={save} disabled={saving || unsaved === 0}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
            {saving ? "Sauvegarde..." : unsaved > 0 ? "Enregistrer (" + unsaved + ")" : "Tout sauvegarde"}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <span className="card-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>Annotations</span>
          <span style={{ fontSize: 12, color: "var(--text3)" }}>{annotations.length} annotation(s)</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ color: "var(--text3)" }}>
            {["Forme", "Classe", "Severite", "Coordonnees", "Description", ""].map(h => <th key={h} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {annotations.map(a => (
              <tr key={a.id || a._fabricId} style={{ borderBottom: "1px solid var(--border)", background: hoveredAnnot === (a.id || a._fabricId) ? "rgba(224,108,0,0.05)" : "transparent" }}
                onMouseEnter={() => setHoveredAnnot(a.id || a._fabricId || null)} onMouseLeave={() => setHoveredAnnot(null)}>
                <td style={{ padding: "9px 12px", fontWeight: 500 }}>BBox{!a._saved && <span style={{ color: "var(--accent)", marginLeft: 6, fontSize: 10 }}>new</span>}</td>
                <td style={{ padding: "9px 12px" }}>{a.defect_class}</td>
                <td style={{ padding: "9px 12px" }}><span className={"tag " + sevC(a.severity)}>{sevL(a.severity)}</span></td>
                <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 10, color: "var(--text3)" }}>{a.shape === "bbox" ? "[" + Object.values(a.coordinates).map((v: any) => v.toFixed(2)).join(", ") + "]" : ""}</td>
                <td style={{ padding: "9px 12px", color: "var(--text2)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.description || ""}</td>
                <td style={{ padding: "9px 12px" }}><button className="btn btn-sm btn-danger" onClick={() => setAnnotations(p => p.filter(x => (x.id || x._fabricId) !== (a.id || a._fabricId)))}>X</button></td>
              </tr>
            ))}
            {annotations.length === 0 && <tr><td colSpan={6} style={{ padding: "24px 12px", textAlign: "center", color: "var(--text3)" }}>{selectedImg ? "Dessinez un rectangle avec BBox" : "Selectionnez une image"}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

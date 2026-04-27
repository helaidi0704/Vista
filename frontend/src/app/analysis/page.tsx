"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { Dataset, VImage } from "@/lib/types";

const TABS = ["Comparaison Côte à Côte", "Superposition (Difference)", "Analyse Spectrale (FFT)", "Data Augmentation Test", "Extraction Contours (Sobel/Canny)"];
const AUGS = [
  { t: "Origine", fl: "" },
  { t: "Crop + Rot 12°", fl: "brightness(90%)" },
  { t: "Mixup avec BG_1", fl: "contrast(120%)" },
  { t: "Crop + Rot -5°", fl: "hue-rotate(10deg)" },
];

export default function AnalysisPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [imageA, setImageA] = useState<VImage | null>(null);
  const [imageB, setImageB] = useState<VImage | null>(null);
  const [filterResults, setFilterResults] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);
  const targetRef = useRef<HTMLCanvasElement>(null);
  const refCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    api.get("/api/v1/datasets").then(({ data }) => {
      setDatasets(data);
      if (data.length > 0) {
        api.get(`/api/v1/images?dataset_id=${data[0].id}`).then(({ data: imgs }) => {
          if (imgs.length > 0) setImageA(imgs[0]);
          if (imgs.length > 1) setImageB(imgs[1]);
        });
      }
    });
  }, []);

  // Draw synthetic canvas content
  useEffect(() => {
    [targetRef, refCanvasRef].forEach((ref, idx) => {
      const canvas = ref.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      const W = canvas.width, H = canvas.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#2A2C3A"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#555A7A"; ctx.lineWidth = W * 0.03;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.3, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#44485D";
      ctx.beginPath(); ctx.arc(W / 2 - 20, H / 2 - 20, 10, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(W / 2 + 20, H / 2 + 20, 10, 0, Math.PI * 2); ctx.fill();
      if (idx === 0) {
        ctx.strokeStyle = "#8B91B5"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(W / 2 + 10, H / 2 - 40); ctx.lineTo(W / 2 + 35, H / 2 - 15); ctx.stroke();
      }
    });
  }, [activeTab]);

  async function applyFilter(type: string) {
    if (!imageA) return;
    setProcessing(type);
    try {
      const endpoint = type === "fft" ? `/api/v1/analysis/fft?image_id=${imageA.id}` : `/api/v1/analysis/filter?image_id=${imageA.id}&filter_type=${type}`;
      const { data } = await api.post(endpoint);
      setFilterResults(prev => ({ ...prev, [type]: data.result_url }));
    } catch (e) { console.error(e); }
    setProcessing(null);
  }

  return (
    <div className="fade-in">
      {/* Image selection bar */}
      <div className="flex gap-3 items-center flex-wrap" style={{ marginBottom: 20 }}>
        {[
          { name: imageA?.filename || "carter_moteur_082.jpg", tag: "Défaut: Rayure", cls: "tag-red", bg: "rgba(255,69,58,0.1)", bc: "var(--red)" },
          { name: imageB?.filename || "ref_template_gold.jpg", tag: "Golden Reference", cls: "tag-green", bg: "rgba(0,199,190,0.1)", bc: "var(--green)" },
        ].map((f, i) => (
          <div key={i} className="card flex items-center gap-2.5" style={{ flex: 1, minWidth: 200, padding: "10px 14px" }}>
            <div style={{ width: 28, height: 28, background: f.bg, border: `1px solid ${f.bc}`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>🖼️</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
            </div>
            <span className={`tag ${f.cls}`}>{f.tag}</span>
          </div>
        ))}
        <button className="btn btn-secondary">+ Comparer une image</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap" style={{ marginBottom: 16, background: "var(--bg2)", borderRadius: "var(--radius-sm)", padding: 4, width: "fit-content" }}>
        {TABS.map((t, i) => (
          <button key={t} className={`toggle-chip${activeTab === i ? " active" : ""}`} onClick={() => setActiveTab(i)} style={{ borderRadius: 6 }}>
            {t}
          </button>
        ))}
      </div>

      {/* Filter toolbar */}
      <div className="card" style={{ marginBottom: 16, padding: "12px 16px" }}>
        <div className="flex gap-4 items-center flex-wrap">
          <strong style={{ fontSize: 12, color: "var(--text2)" }}>Filtres synchrones:</strong>
          <label className="flex items-center gap-1.5" style={{ fontSize: 12 }}><input type="checkbox" style={{ accentColor: "var(--accent)" }} /> Grayscale</label>
          <label className="flex items-center gap-1.5" style={{ fontSize: 12 }}><input type="checkbox" style={{ accentColor: "var(--accent)" }} /> Equaliser Histogramme</label>
          <div style={{ width: 1, height: 16, background: "var(--border)" }} />
          <strong style={{ fontSize: 12, color: "var(--text2)" }}>Luminosité/Contraste:</strong>
          <input type="range" style={{ width: 80, accentColor: "var(--accent)" }} />
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {["sobel", "canny", "fft"].map(f => (
              <button key={f} className="btn btn-sm btn-secondary" onClick={() => applyFilter(f)} disabled={processing === f}>
                {processing === f ? "..." : f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Side by side canvases */}
      <div className="grid grid-cols-2 gap-4" style={{ marginBottom: 16 }}>
        <div className="card" style={{ padding: 10 }}>
          <div className="card-header" style={{ marginBottom: 8 }}>
            <span className="card-title" style={{ fontSize: 12 }}>Image cible ({imageA?.filename || "carter_moteur_082"})</span>
          </div>
          <div className="viz-placeholder" style={{ height: 280, position: "relative" }}>
            <canvas ref={targetRef} style={{ width: "100%", height: "100%" }} />
            <div style={{ position: "absolute", top: "40%", left: "35%", border: "2px dashed var(--red)", width: 80, height: 60, background: "rgba(255,69,58,0.15)" }} />
          </div>
          <div className="flex justify-between" style={{ marginTop: 8, fontSize: 10, color: "var(--text3)" }}>
            <span>Max intensité: 245</span><span>Sharpness: 4.2</span>
          </div>
        </div>
        <div className="card" style={{ padding: 10 }}>
          <div className="card-header" style={{ marginBottom: 8 }}>
            <span className="card-title" style={{ fontSize: 12 }}>Golden Reference</span>
          </div>
          <div className="viz-placeholder" style={{ height: 280 }}>
            <canvas ref={refCanvasRef} style={{ width: "100%", height: "100%" }} />
          </div>
          <div className="flex justify-between" style={{ marginTop: 8, fontSize: 10, color: "var(--text3)" }}>
            <span>Max intensité: 242</span><span>Sharpness: 4.5</span>
          </div>
        </div>
      </div>

      {/* Data Augmentation */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
            Simulation Data Augmentation (Transformation Batch)
          </span>
          <button className="btn btn-sm btn-primary" onClick={() => imageA && api.post(`/api/v1/analysis/augmentation-preview?image_id=${imageA.id}`, [{ type: "HorizontalFlip", p: 1 }]).catch(() => {})}>
            Générer aperçus
          </button>
        </div>
        <div className="flex gap-3 flex-wrap" style={{ marginBottom: 16 }}>
          {["Crop (Aléatoire)", "Rotation (-15°..15°)", "Mixup (alpha 0.2)", "Cutout"].map((l, i) => (
            <label key={l} style={{ fontSize: 12, color: i < 3 ? "var(--accent)" : "var(--text2)", border: `1px solid ${i < 3 ? "var(--border-accent)" : "var(--border)"}`, padding: "4px 8px", borderRadius: 4 }}>
              <input type="checkbox" defaultChecked={i < 3} style={{ accentColor: "var(--accent)" }} /> {l}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-3">
          {AUGS.map((aug, i) => (
            <div key={i}>
              <div className="viz-placeholder" style={{ height: 120, marginBottom: 6, filter: aug.fl, background: "#2A2C3A" }} />
              <div style={{ fontSize: 11, textAlign: "center", color: "var(--text2)" }}>{aug.t}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

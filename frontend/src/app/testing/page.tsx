"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";

const HISTORY_SEED = [
  { f: "frame_20412.jpg", v: "ANORMAL (2)", vc: "tag-red", d: "Bavure (0.94), Rayure (0.68)", m: "YOLOv8_Detect_v3", t: "13:28:45.3" },
  { f: "frame_20411.jpg", v: "ANORMAL (1)", vc: "tag-red", d: "Bavure (0.92)", m: "YOLOv8_Detect_v3", t: "13:28:45.0" },
  { f: "frame_20410.jpg", v: "NORMAL", vc: "tag-green", d: "—", m: "YOLOv8_Detect_v3", t: "13:28:44.7" },
];

export default function TestingPage() {
  const [camRunning, setCamRunning] = useState(false);
  const [history, setHistory] = useState(HISTORY_SEED);
  const [selectedModel, setSelectedModel] = useState("YOLOv8_Detect_v3");
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const gradcamRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Draw detection canvas
  useEffect(() => {
    const canvas = liveCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth; canvas.height = parent.clientHeight;
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#2A2C3A"; ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = "#555A7A"; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(cw / 2, ch / 2 + 20, 80, 0, Math.PI); ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cw / 2, ch / 2 - 20, 40, Math.PI, Math.PI * 2); ctx.stroke();

    // BBoxes
    ctx.strokeStyle = "#FF4567"; ctx.lineWidth = 2;
    ctx.strokeRect(cw / 2 + 60, ch / 2 + 10, 30, 30);
    ctx.fillStyle = "rgba(255,69,103,0.2)"; ctx.fillRect(cw / 2 + 60, ch / 2 + 10, 30, 30);
    ctx.fillStyle = "#FF4567"; ctx.font = "bold 10px Inter"; ctx.fillText("Bavure 0.94", cw / 2 + 60, ch / 2 + 6);

    ctx.strokeStyle = "#FF9500";
    ctx.strokeRect(cw / 2 - 30, ch / 2 - 50, 60, 20);
    ctx.fillStyle = "rgba(255,149,0,0.15)"; ctx.fillRect(cw / 2 - 30, ch / 2 - 50, 60, 20);
    ctx.fillStyle = "#FF9500"; ctx.fillText("Rayure 0.68", cw / 2 - 30, ch / 2 - 54);
  }, []);

  // Draw Grad-CAM heatmap
  useEffect(() => {
    const canvas = gradcamRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth; canvas.height = parent.clientHeight;
    const cw = canvas.width, ch = canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#1A1C25"; ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = "#4A4C5A"; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(cw / 2, ch / 2 + 20, 80, 0, Math.PI); ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cw / 2, ch / 2 - 20, 40, Math.PI, Math.PI * 2); ctx.stroke();

    for (let x = 0; x < cw; x += 3) {
      for (let y = 0; y < ch; y += 3) {
        const d1 = Math.pow(x - (cw / 2 + 75), 2) + Math.pow(y - (ch / 2 + 25), 2);
        const val1 = Math.exp(-d1 / 1500) * 0.95;
        const d2 = Math.pow(x - cw / 2, 2) + Math.pow(y - (ch / 2 - 40), 2);
        const val2 = Math.exp(-d2 / 2000) * 0.6;
        const hotspot = val1 + val2;
        if (hotspot > 0.1) {
          const r = Math.round(Math.min(255, hotspot * 350));
          const g = Math.round(Math.max(0, Math.min(255, (1 - hotspot) * 200)));
          const b = Math.round(Math.max(0, (1 - hotspot * 2) * 80));
          ctx.fillStyle = `rgba(${r},${g},${b},${hotspot * 0.8})`;
          ctx.fillRect(x, y, 3, 3);
        }
      }
    }
  }, []);

  function toggleCam() {
    if (camRunning) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setCamRunning(false);
    } else {
      setCamRunning(true);
      intervalRef.current = setInterval(() => {
        const frames = Date.now().toString().slice(-4);
        const isAnorm = Math.random() > 0.7;
        setHistory(prev => [{
          f: `frame_${frames}.jpg`,
          v: isAnorm ? "ANORMAL (1)" : "NORMAL",
          vc: isAnorm ? "tag-red" : "tag-green",
          d: isAnorm ? "Rayure (0.74)" : "—",
          m: selectedModel,
          t: new Date().toISOString().substring(11, 21),
        }, ...prev].slice(0, 10));
      }, 1500);
    }
  }

  useEffect(() => { return () => { if (intervalRef.current) clearInterval(intervalRef.current); }; }, []);

  return (
    <div className="fade-in">
      <div className="grid grid-cols-3 gap-4" style={{ marginBottom: 16 }}>
        {/* Left: Model + Source */}
        <div className="flex flex-col gap-3">
          <div className="card">
            <div className="card-header"><span className="card-title">🧠 Sélection du modèle</span></div>
            <div className="flex flex-col gap-1.5" style={{ marginBottom: 12 }}>
              <label className="form-label">Modèle entraîné</label>
              <select className="form-select" style={{ fontSize: 12 }} value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
                <option value="YOLOv8_Detect_v3">YOLOv8_Detect_v3 (mAP: 86.4%)</option>
                <option value="ResNet50_Classif_v1">ResNet50_Classif_v1 (Acc: 94.2%)</option>
                <option value="UNet_Segmentation_v2">UNet_Segmentation_v2 (IoU: 0.81)</option>
              </select>
            </div>
            <div style={{ background: "var(--bg-input)", borderRadius: 8, padding: 12, fontSize: 11, color: "var(--text2)" }}>
              {[
                ["Précision (mAP@50)", "86.4%", "var(--green)"],
                ["Latence moy.", "18 ms", "var(--cyan)"],
                ["Entraîné sur", "Dataset_Carter_Moteur", ""],
                ["Classes de défauts", "Rayure, Fissure, Tâche, Bavure", ""],
              ].map(([l, v, c]) => (
                <div key={l} className="flex justify-between" style={{ marginBottom: 6 }}>
                  <span>{l}</span><span style={{ color: c || undefined, fontWeight: c ? 600 : 400 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">🎥 Source Image / Flux</span></div>
            <div className="flex flex-col gap-2.5">
              <button className="btn btn-secondary" onClick={toggleCam} style={{ width: "100%", justifyContent: "center" }}>
                {camRunning ? (
                  <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Arrêter l&apos;inspection continue</>
                ) : (
                  <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg> Lancer la Caméra (Inspection ligne)</>
                )}
              </button>
              {camRunning && (
                <div style={{ textAlign: "center", padding: 12, background: "rgba(0,199,190,0.1)", border: "1px solid rgba(0,199,190,0.3)", borderRadius: 8 }}>
                  <div className="flex items-center justify-center gap-2" style={{ marginBottom: 8 }}>
                    <span className="status-dot" style={{ background: "var(--green)" }} />
                    <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>Flux actif… 30 FPS</span>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2" style={{ color: "var(--text3)" }}>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} /><span style={{ fontSize: 11 }}>ou</span><div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
              <label className="flex flex-col items-center justify-center gap-2" style={{ padding: 20, border: "2px dashed var(--border)", borderRadius: 8, cursor: "pointer", minHeight: 80 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                <span style={{ fontSize: 12, color: "var(--text2)" }}>Glisser une image .jpg / .png</span>
                <input type="file" accept="image/*" style={{ display: "none" }} />
              </label>
            </div>
          </div>
        </div>

        {/* Center+Right: Results (col-span-2) */}
        <div className="card col-span-2">
          <div className="card-header">
            <span className="card-title">🎯 Résultat d&apos;inférence (Temps réel)</span>
            <span className="tag tag-red">DÉFAUTS DÉTECTÉS (2)</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <span style={{ fontSize: 11, color: "var(--text2)" }}>Détection (Bounding Boxes)</span>
              <div className="viz-placeholder" style={{ height: 260, position: "relative" }}>
                <canvas ref={liveCanvasRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span style={{ fontSize: 11, color: "var(--text2)" }}>Explicabilité (Heatmap Grad-CAM)</span>
              <div className="viz-placeholder" style={{ height: 260, position: "relative" }}>
                <canvas ref={gradcamRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }} />
              </div>
            </div>
          </div>

          {/* Defect analysis */}
          <div style={{ border: "1px solid var(--border-accent)", borderRadius: 10, padding: 14, background: "rgba(108,99,255,0.05)", marginTop: 16 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Analyse des défauts</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7, background: "var(--bg-input)", borderRadius: 8, padding: 12 }}>
              <p style={{ marginBottom: 6 }}>🔴 <strong style={{ color: "var(--red)" }}>Objet #1 - BAVURE (Confiance: 94.2%)</strong></p>
              <p style={{ marginBottom: 6 }}>La zone rouge intense sur l&apos;explicabilité indique des <strong>gradients très forts</strong> localisés sur la courbure interne de la pièce, caractéristique typique d&apos;un défaut d&apos;usinage ou résidu matériel.</p>
              <div style={{ height: 1, background: "var(--border)", margin: "10px 0" }} />
              <p style={{ marginBottom: 6 }}>🟠 <strong style={{ color: "var(--orange)" }}>Objet #2 - MICRO-RAYURE (Confiance: 68.1%)</strong></p>
              <p>Contours fins anormaux détectés. Confiance modérée en raison du faible contraste par rapport au revêtement ambiant.</p>
            </div>
          </div>
        </div>
      </div>

      {/* History table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">📋 Historique des inférences</span>
          <span style={{ fontSize: 12, color: "var(--text3)" }}>Session courante</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "var(--text3)" }}>
              {["Image / Frame", "Verdict global", "Détail (Défauts)", "Modèle actif", "Heure"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "9px 12px", fontWeight: 500 }}>{r.f}</td>
                <td style={{ padding: "9px 12px" }}><span className={`tag ${r.vc}`}>{r.v}</span></td>
                <td style={{ padding: "9px 12px", color: "var(--text2)" }}>{r.d}</td>
                <td style={{ padding: "9px 12px", color: "var(--text2)" }}>{r.m}</td>
                <td style={{ padding: "9px 12px", color: "var(--text3)", fontFamily: "monospace" }}>{r.t}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

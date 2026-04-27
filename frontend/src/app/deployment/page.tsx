"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";

const DEPLOYED = [
  { name: "YOLOv8_Detect_v3", status: "Actif", cls: "tag-green", acc: "86.4% mAP", req: "5,284 / jour", target: "Edge (TensorRT)", uptime: "99.9%", sdot: "--green" },
  { name: "ResNet50_Classif_v1", status: "Actif", cls: "tag-green", acc: "94.2% Acc", req: "1,432 / jour", target: "API REST", uptime: "100%", sdot: "--green" },
  { name: "UNet_Segmentation_v2", status: "Arrêté", cls: "tag-orange", acc: "0.81 IoU", req: "—", target: "Docker", uptime: "—", sdot: "--orange" },
];

const MONITORING_KPIS = [
  { label: "Requêtes / heure", val: "220.3", trend: "+4%", color: "--cyan" },
  { label: "Latence Inférence", val: "18 ms", trend: "-2 ms", color: "--green" },
  { label: "Taux False Positives", val: "1.2%", trend: "stable", color: "--orange" },
  { label: "Pièces Rejetées", val: "4.8%", trend: "+0.5%", color: "--red" },
];

const DEPLOY_FORMATS = ["API REST (JSON)", "TensorRT (Edge)", "ONNX", "TFLite", "Docker Image"];

export default function DeploymentPage() {
  const [activeFormat, setActiveFormat] = useState(0);
  const [activeTimeRange, setActiveTimeRange] = useState(1);
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState(false);
  const chartRef = useRef<HTMLCanvasElement>(null);

  // Draw monitoring chart
  useEffect(() => {
    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(0, H * i / 4); ctx.lineTo(W, H * i / 4); ctx.stroke(); }
    // Line chart
    const pts: [number, number][] = [];
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const t = x / W;
      const y = H * 0.6 - Math.sin(t * 12) * H * 0.25 + (Math.random() - 0.5) * H * 0.05;
      pts.push([x, y]);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(0,212,255,0.8)"; ctx.lineWidth = 2; ctx.stroke();
    // Fill under
    ctx.beginPath();
    pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = "rgba(0,212,255,0.05)"; ctx.fill();
    // Anomaly spikes
    [[200, 0.25], [520, 0.45], [780, 0.18]].forEach(([px, intensity]) => {
      ctx.fillStyle = `rgba(255,69,103,${intensity})`;
      ctx.fillRect(px - 2, 0, 4, H);
    });
  }, [activeTimeRange]);

  async function handleDeploy() {
    setDeploying(true);
    try {
      // Try real API
      await api.post("/api/v1/deployments", { model_id: "00000000-0000-0000-0000-000000000000", format: "api_rest" });
    } catch (e) { /* demo fallback */ }
    setTimeout(() => { setDeploying(false); setDeployed(true); }, 2000);
  }

  return (
    <div className="fade-in">
      {/* Deployed models overview */}
      <div className="grid grid-cols-3 gap-4" style={{ marginBottom: 20 }}>
        {DEPLOYED.map(m => (
          <div key={m.name} className="card">
            <div className="flex items-start justify-between" style={{ marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{m.name}</div>
                <span className={`tag ${m.cls}`}>{m.status}</span>
              </div>
              <div className="flex gap-1.5">
                <button className="btn btn-sm btn-secondary">Logs</button>
                <button className="btn btn-sm btn-secondary">⋮</button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5" style={{ fontSize: 12, color: "var(--text2)" }}>
              {[
                ["Précision", m.acc, "var(--green)"],
                ["Requêtes", m.req, ""],
                ["Format / Cible", m.target, ""],
                ["Uptime", m.uptime, `var(${m.sdot})`],
              ].map(([l, v, c]) => (
                <div key={l} className="flex justify-between">
                  <span>{l}</span><span style={{ color: c || undefined, fontWeight: c ? 600 : 400 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4" style={{ marginBottom: 16 }}>
        {/* Deploy form */}
        <div className="card">
          <div className="card-header" style={{ marginBottom: 16 }}>
            <span className="card-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              Déployer un modèle Vision
            </span>
          </div>
          <div className="flex flex-col gap-3" style={{ marginBottom: 12 }}>
            <label className="form-label">Modèle à packager / déployer</label>
            <select className="form-select">
              <option>YOLOv8_Detect_v3 (recommandé)</option>
              <option>UNet_Segmentation_v2</option>
              <option>ResNet50_Classif_v1</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5" style={{ marginBottom: 12 }}>
            <label className="form-label">Format de sortie (Déploiement cible)</label>
            <div className="flex gap-1.5 flex-wrap" style={{ marginTop: 4 }}>
              {DEPLOY_FORMATS.map((t, i) => (
                <span key={t} className={`toggle-chip${activeFormat === i ? " active" : ""}`} onClick={() => setActiveFormat(i)}>{t}</span>
              ))}
            </div>
          </div>

          {/* API REST config */}
          <div className="flex flex-col gap-2.5" style={{ marginBottom: 16 }}>
            <div className="flex flex-col gap-1"><label className="form-label">Endpoint URL généré</label><input type="text" className="form-input" defaultValue="/api/vision/v1/detect" style={{ fontSize: 12, fontFamily: "monospace" }} /></div>
            <div className="flex flex-col gap-1"><label className="form-label">Format d&apos;Image en Entrée</label><select className="form-select" style={{ fontSize: 12 }}><option>JSON (Base64 JPEG/PNG)</option><option>Multipart File Upload</option></select></div>
            <div className="flex gap-2">
              <div className="flex flex-col gap-1" style={{ flex: 1 }}><label className="form-label">Résolution max supportée</label><select className="form-select" style={{ fontSize: 12 }}><option>640x640</option><option>1024x1024</option><option>Original (Auto-resize)</option></select></div>
              <div className="flex flex-col gap-1" style={{ width: 100 }}><label className="form-label">Max batch size</label><input type="number" className="form-input" defaultValue={8} style={{ fontSize: 12 }} /></div>
            </div>
            <div className="flex gap-2.5" style={{ marginTop: 6 }}>
              <label className="flex items-center gap-1.5" style={{ fontSize: 12, cursor: "pointer" }}><input type="checkbox" defaultChecked style={{ accentColor: "var(--accent)" }} /> Inclure masque Grad-CAM</label>
              <label className="flex items-center gap-1.5" style={{ fontSize: 12, cursor: "pointer" }}><input type="checkbox" defaultChecked style={{ accentColor: "var(--accent)" }} /> Auto-alignement (GPU)</label>
            </div>
          </div>

          <button className={`btn ${deployed ? "btn-success" : "btn-primary"}`} style={{ width: "100%" }} onClick={handleDeploy} disabled={deploying}>
            {deploying ? "⏳ Création de l'API REST…" : deployed ? "✅ API Prête à l'emploi" : (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg> Générer / Déployer</>
            )}
          </button>
        </div>

        {/* API preview */}
        <div className="card">
          <div className="card-header" style={{ marginBottom: 12 }}>
            <span className="card-title">📄 Exemple de Requête & Réponse</span>
            <div className="flex gap-1.5"><button className="btn btn-sm btn-secondary">Copier</button><button className="btn btn-sm btn-secondary">Swagger UI</button></div>
          </div>
          <div style={{ background: "var(--bg-input)", borderRadius: 8, padding: 14, fontFamily: "monospace", fontSize: 11, color: "var(--text2)", maxHeight: 280, overflowY: "auto", lineHeight: 1.7 }}>
            <span style={{ color: "#FF9500" }}>POST</span> <span style={{ color: "#00D4FF" }}>/api/vision/v1/detect</span><br />
            <span style={{ color: "var(--text3)" }}>Content-Type: application/json</span><br />
            <span style={{ color: "var(--text3)" }}>Authorization: ApiKey &lt;your-key&gt;</span><br /><br />
            <span style={{ color: "#6C63FF" }}>{"// Request body"}</span><br />
            {"{"}<br />
            &nbsp;&nbsp;<span style={{ color: "#00E5A0" }}>&quot;image_b64&quot;</span>: <span style={{ color: "#FFD60A" }}>&quot;/9j/4AAQSkZJRgABA...&quot;</span>,<br />
            &nbsp;&nbsp;<span style={{ color: "#00E5A0" }}>&quot;return_gradcam&quot;</span>: <span style={{ color: "#FF9500" }}>true</span>,<br />
            &nbsp;&nbsp;<span style={{ color: "#00E5A0" }}>&quot;threshold&quot;</span>: <span style={{ color: "#FF9500" }}>0.50</span><br />
            {"}"}<br /><br />
            <span style={{ color: "#6C63FF" }}>{"// Response (200 OK)"}</span><br />
            {"{"}<br />
            &nbsp;&nbsp;<span style={{ color: "#00E5A0" }}>&quot;status&quot;</span>: <span style={{ color: "#FFD60A" }}>&quot;SUCCESS&quot;</span>,<br />
            &nbsp;&nbsp;<span style={{ color: "#00E5A0" }}>&quot;detections&quot;</span>: [{"{"}<br />
            &nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: "#00E5A0" }}>&quot;class&quot;</span>: <span style={{ color: "#FFD60A" }}>&quot;Bavure&quot;</span>,<br />
            &nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: "#00E5A0" }}>&quot;confidence&quot;</span>: <span style={{ color: "#FF9500" }}>0.942</span>,<br />
            &nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: "#00E5A0" }}>&quot;bbox&quot;</span>: [<span style={{ color: "#FF9500" }}>120, 340, 160, 380</span>]<br />
            &nbsp;&nbsp;{"}"}],<br />
            &nbsp;&nbsp;<span style={{ color: "#00E5A0" }}>&quot;latency_ms&quot;</span>: <span style={{ color: "#FF9500" }}>18</span><br />
            {"}"}
          </div>
        </div>
      </div>

      {/* Monitoring */}
      <div className="card">
        <div className="card-header" style={{ marginBottom: 16 }}>
          <span className="card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Supervision — YOLOv8_Detect_v3
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {["1h", "24h", "7j", "30j"].map((t, i) => (
              <span key={t} className={`toggle-chip${activeTimeRange === i ? " active" : ""}`} onClick={() => setActiveTimeRange(i)}>{t}</span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4" style={{ marginBottom: 16 }}>
          {MONITORING_KPIS.map(k => (
            <div key={k.label} style={{ background: "var(--bg-input)", borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: `var(${k.color})` }}>{k.val}</div>
              <div style={{ fontSize: 12, fontWeight: 500, marginTop: 4 }}>{k.label}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{k.trend}</div>
            </div>
          ))}
        </div>
        <canvas ref={chartRef} width={1000} height={120} style={{ width: "100%", borderRadius: 8 }} />
      </div>
    </div>
  );
}

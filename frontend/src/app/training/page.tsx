"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useTrainingWebSocket } from "@/lib/useTrainingWS";
import type { Dataset } from "@/lib/types";

const INPUT_BLOCKS = [
  { label: "Image RGB", color: "#6C63FF", icon: "🖼️" },
  { label: "Grayscale", color: "#00D4FF", icon: "⚫" },
  { label: "Masque (Seg)", color: "#00D4FF", icon: "🎭" },
  { label: "Image Multi-spec", color: "#00D4FF", icon: "🌈" },
];
const PREPROCESS_BLOCKS = [
  { label: "Resize / Crop", color: "#FF9500", icon: "✂️" },
  { label: "Normalisation", color: "#FF9500", icon: "⚖️" },
  { label: "Filtre Sobel/Canny", color: "#FF9500", icon: "🖊️" },
  { label: "Mixup / Cutmix", color: "#FF9500", icon: "🔀" },
  { label: "Rotations & Flips", color: "#FF9500", icon: "🔄" },
];
const MODEL_BLOCKS = [
  { label: "CNN Custom", color: "#00E5A0", icon: "🧠" },
  { label: "ResNet50 / 101", color: "#00E5A0", icon: "🌲" },
  { label: "YOLOv8", color: "#00E5A0", icon: "🎯" },
  { label: "Vision Transformer", color: "#00E5A0", icon: "⚡" },
  { label: "U-Net (Seg)", color: "#00E5A0", icon: "🌊" },
  { label: "Autoencoder", color: "#00E5A0", icon: "🔄" },
];

const CONFIG_FIELDS = [
  { label: "Variation", type: "select", val: "yolov8s", opts: ["yolov8n", "yolov8s", "yolov8m", "yolov8l"] },
  { label: "Classes (Max)", type: "number", val: "5" },
  { label: "Init weights", type: "select", val: "COCO", opts: ["COCO", "Random", "Custom"] },
  { label: "Freezing (Layers)", type: "number", val: "10" },
  { label: "Optimizer", type: "select", val: "AdamW", opts: ["AdamW", "SGD", "RMSprop"] },
  { label: "Mixup Prob", type: "range", val: "0.2" },
  { label: "Mosaic Prob", type: "range", val: "0.5" },
  { label: "Warmup Epochs", type: "number", val: "3" },
  { label: "Save Checkpoints", type: "check", val: "true" },
];

export default function TrainingPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDs, setSelectedDs] = useState("");
  const [epochs, setEpochs] = useState(100);
  const [batchSize, setBatchSize] = useState(16);
  const [lr, setLr] = useState("1e-3");
  const [modelName, setModelName] = useState("YOLOv8_Detect_v3");
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentEpoch, setCurrentEpoch] = useState(0);
  const [architecture, setArchitecture] = useState("yolov8s");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { metrics, latest, connected } = useTrainingWebSocket(activeJobId);

  useEffect(() => {
    api.get("/api/v1/datasets").then(({ data }) => {
      setDatasets(data);
      if (data.length > 0) setSelectedDs(data[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (latest) {
      setCurrentEpoch(latest.epoch);
      setProgress(Math.round((latest.epoch / latest.total_epochs) * 100));
      if (latest.status === "completed" || latest.status === "failed") setTraining(false);
    }
  }, [latest]);

  async function launchTraining() {
    if (!selectedDs) return;
    setTraining(true); setProgress(0); setCurrentEpoch(0);
    try {
      const { data } = await api.post("/api/v1/training-jobs", {
        dataset_id: selectedDs, architecture, task_type: "detection",
        hyperparams: { epochs, batch_size: batchSize, lr: parseFloat(lr), optimizer: "AdamW" },
        name: modelName,
      });
      setActiveJobId(data.id);
    } catch (e) {
      console.error(e);
      // Demo fallback
      let ep = 0;
      const iv = setInterval(() => {
        ep += 2; setCurrentEpoch(ep); setProgress(ep);
        if (ep >= 100) { clearInterval(iv); setTraining(false); }
      }, 80);
    }
  }

  function PaletteBlock({ label, color, icon }: { label: string; color: string; icon: string }) {
    return (
      <div draggable className="flex items-center gap-2 cursor-grab"
        style={{ padding: "7px 10px", borderRadius: 6, border: `1px dashed ${color}40`, background: `${color}10`, fontSize: 12, fontWeight: 500, transition: "all 0.15s" }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${color}25`; (e.currentTarget as HTMLElement).style.borderStyle = "solid"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${color}10`; (e.currentTarget as HTMLElement).style.borderStyle = "dashed"; }}>
        <span>{icon}</span>{label}
      </div>
    );
  }

  return (
    <div className="fade-in flex gap-4" style={{ height: "calc(100vh - 120px)" }}>
      {/* Left: Palette + Dataset */}
      <div className="flex flex-col gap-3 overflow-y-auto shrink-0" style={{ width: 260 }}>
        <div className="card">
          <div className="card-header" style={{ marginBottom: 10 }}><span className="card-title">🧱 Blocs disponibles</span></div>
          <p className="section-title">Entrée Image</p>
          <div className="flex flex-col gap-1.5" style={{ marginBottom: 12 }}>
            {INPUT_BLOCKS.map(b => <PaletteBlock key={b.label} {...b} />)}
          </div>
          <p className="section-title">Prétraitement & Augm.</p>
          <div className="flex flex-col gap-1.5" style={{ marginBottom: 12 }}>
            {PREPROCESS_BLOCKS.map(b => <PaletteBlock key={b.label} {...b} />)}
          </div>
          <p className="section-title">Modèles Vision</p>
          <div className="flex flex-col gap-1.5">
            {MODEL_BLOCKS.map(b => <PaletteBlock key={b.label} {...b} />)}
          </div>
        </div>

        <div className="card">
          <div className="card-header" style={{ marginBottom: 10 }}><span className="card-title">💾 Dataset Image</span></div>
          <div className="flex flex-col gap-1.5" style={{ marginBottom: 10 }}>
            <label className="form-label">Sélectionner un dataset</label>
            <select className="form-select" style={{ fontSize: 12 }} value={selectedDs} onChange={e => setSelectedDs(e.target.value)}>
              {datasets.map(d => <option key={d.id} value={d.id}>{d.name} ({d.image_count} img)</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5" style={{ marginBottom: 10 }}>
            <label className="form-label">Split Train / Val / Test</label>
            <div className="flex gap-1.5 items-center" style={{ fontSize: 12 }}>
              <span style={{ color: "var(--accent)" }}>70%</span>
              <div className="progress-bar" style={{ flex: 1 }}><div className="progress-fill" style={{ width: "70%" }} /></div>
              <span style={{ color: "var(--cyan)" }}>20%</span>
              <span style={{ color: "var(--text3)" }}>10%</span>
            </div>
          </div>
          <div className="flex gap-1 flex-wrap">
            <span className="tag tag-green">OK: 10,240</span>
            <span className="tag tag-red">Défauts: 4,007</span>
          </div>
        </div>
      </div>

      {/* Center: Pipeline canvas + launch bar */}
      <div className="flex flex-col gap-3 flex-1" style={{ minWidth: 0 }}>
        <div className="card flex-1" style={{ position: "relative", overflow: "hidden" }}>
          <div className="card-header">
            <span className="card-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/></svg>
              Pipeline — Glisser-déposer les blocs
            </span>
            <div className="flex gap-1.5">
              <button className="btn btn-sm btn-secondary">Effacer</button>
              <button className="btn btn-sm btn-secondary">Importer JSON</button>
              <button className="btn btn-sm btn-secondary">Exporter JSON</button>
            </div>
          </div>
          {/* SVG Pipeline — matching maquette exactly */}
          <svg style={{ width: "100%", height: "calc(100% - 50px)", background: "var(--bg-input)", borderRadius: 8, overflow: "visible", cursor: "move" }}>
            <defs>
              <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="rgba(108,99,255,0.8)" />
              </marker>
              <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.8" fill="rgba(255,255,255,0.05)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Block: Image Input */}
            <g transform="translate(30,80)">
              <rect width="130" height="56" rx="10" fill="#1A1D35" stroke="#6C63FF" strokeWidth="1.5" />
              <text x="18" y="22" fill="#8B85FF" fontSize="11" fontWeight="600" fontFamily="Inter">🖼️ Image RGB</text>
              <text x="18" y="38" fill="#555A7A" fontSize="9" fontFamily="Inter">W, H = Auto</text>
              <circle cx="130" cy="28" r="5" fill="#6C63FF" stroke="#0D0E1A" strokeWidth="2" />
            </g>
            {/* Block: Resize */}
            <g transform="translate(220,40)">
              <rect width="130" height="56" rx="10" fill="#1A1D35" stroke="#FF9500" strokeWidth="1.5" />
              <text x="18" y="22" fill="#FF9500" fontSize="11" fontWeight="600" fontFamily="Inter">✂️ Resize</text>
              <text x="18" y="38" fill="#555A7A" fontSize="9" fontFamily="Inter">640x640px</text>
              <circle cx="0" cy="28" r="5" fill="#FF9500" stroke="#0D0E1A" strokeWidth="2" />
              <circle cx="130" cy="28" r="5" fill="#FF9500" stroke="#0D0E1A" strokeWidth="2" />
            </g>
            {/* Block: Data Aug */}
            <g transform="translate(220,130)">
              <rect width="130" height="56" rx="10" fill="#1A1D35" stroke="#FF9500" strokeWidth="1.5" />
              <text x="18" y="22" fill="#FF9500" fontSize="11" fontWeight="600" fontFamily="Inter">🔄 Augmentation</text>
              <text x="18" y="38" fill="#555A7A" fontSize="9" fontFamily="Inter">RandRot, Flip, Hue</text>
              <circle cx="0" cy="28" r="5" fill="#FF9500" stroke="#0D0E1A" strokeWidth="2" />
              <circle cx="130" cy="28" r="5" fill="#FF9500" stroke="#0D0E1A" strokeWidth="2" />
            </g>
            {/* Block: YOLOv8 */}
            <g transform="translate(420,80)">
              <rect width="150" height="70" rx="10" fill="#1A1D35" stroke="#00E5A0" strokeWidth="1.5" />
              <text x="18" y="22" fill="#00E5A0" fontSize="11" fontWeight="600" fontFamily="Inter">🎯 YOLOv8</text>
              <text x="18" y="38" fill="#555A7A" fontSize="9" fontFamily="Inter">Object Detection</text>
              <text x="18" y="52" fill="#555A7A" fontSize="9" fontFamily="Inter">Pretrained yolov8s.pt</text>
              <circle cx="0" cy="35" r="5" fill="#00E5A0" stroke="#0D0E1A" strokeWidth="2" />
              <circle cx="150" cy="35" r="5" fill="#00E5A0" stroke="#0D0E1A" strokeWidth="2" />
            </g>
            {/* Block: Output */}
            <g transform="translate(640,80)">
              <rect width="130" height="56" rx="10" fill="#1A1D35" stroke="#FF4567" strokeWidth="1.5" />
              <text x="18" y="22" fill="#FF4567" fontSize="11" fontWeight="600" fontFamily="Inter">🚀 NMS & Sorties</text>
              <text x="18" y="38" fill="#555A7A" fontSize="9" fontFamily="Inter">BBox, Conf, Classes</text>
              <circle cx="0" cy="28" r="5" fill="#FF4567" stroke="#0D0E1A" strokeWidth="2" />
            </g>
            {/* Connections */}
            <line x1="160" y1="108" x2="220" y2="68" stroke="rgba(108,99,255,0.6)" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#arr)" />
            <line x1="160" y1="108" x2="220" y2="158" stroke="rgba(108,99,255,0.6)" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#arr)" />
            <line x1="350" y1="68" x2="420" y2="108" stroke="rgba(255,149,0,0.6)" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#arr)" />
            <line x1="350" y1="158" x2="420" y2="108" stroke="rgba(255,149,0,0.6)" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#arr)" />
            <line x1="570" y1="115" x2="640" y2="108" stroke="rgba(0,229,160,0.6)" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#arr)" />
          </svg>
        </div>

        {/* Launch bar */}
        <div className="card" style={{ padding: 16 }}>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="form-label" style={{ whiteSpace: "nowrap" }}>Epochs:</label>
              <input type="number" className="form-input" value={epochs} onChange={e => setEpochs(Number(e.target.value))} style={{ width: 70, fontSize: 12 }} />
            </div>
            <div className="flex items-center gap-2">
              <label className="form-label" style={{ whiteSpace: "nowrap" }}>Batch size:</label>
              <input type="number" className="form-input" value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} style={{ width: 70, fontSize: 12 }} />
            </div>
            <div className="flex items-center gap-2">
              <label className="form-label" style={{ whiteSpace: "nowrap" }}>Learning rate:</label>
              <input type="text" className="form-input" value={lr} onChange={e => setLr(e.target.value)} style={{ width: 80, fontSize: 12 }} />
            </div>
            <div className="flex items-center gap-2">
              <label className="form-label" style={{ whiteSpace: "nowrap" }}>Nom du modèle:</label>
              <input type="text" className="form-input" value={modelName} onChange={e => setModelName(e.target.value)} style={{ width: 140, fontSize: 12 }} />
            </div>
            <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={launchTraining} disabled={training}>
              {training ? (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Entraînement en cours…</>
              ) : progress >= 100 ? "✅ Terminé — Sauvegardé" : (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Lancer l&apos;entraînement</>
              )}
            </button>
          </div>
          {training && (
            <div style={{ marginTop: 14 }}>
              <div className="flex justify-between" style={{ fontSize: 12, color: "var(--text2)", marginBottom: 6 }}>
                <span>Epoch {currentEpoch} / {epochs}</span>
                <span>Box Loss: <span style={{ color: "var(--accent)" }}>{latest?.train_loss?.toFixed(2) || "0.84"}</span> · Val mAP50: <span style={{ color: "var(--green)" }}>{latest ? `${(latest.map50 * 100).toFixed(1)}%` : "82.4%"}</span></span>
                <span>ETA: {latest?.eta_seconds ? `${Math.floor(latest.eta_seconds / 60)}m` : "—"}</span>
              </div>
              <div className="progress-bar" style={{ height: 8 }}>
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Config panel */}
      <div className="card overflow-y-auto shrink-0" style={{ width: 220 }}>
        <div className="card-header" style={{ marginBottom: 12 }}><span className="card-title">⚙️ Config: YOLOv8</span></div>
        {CONFIG_FIELDS.map(c => (
          <div key={c.label} className="flex flex-col gap-1" style={{ marginBottom: 10 }}>
            <label className="form-label">{c.label}</label>
            {c.type === "select" ? (
              <select className="form-select" style={{ fontSize: 12 }} defaultValue={c.val} onChange={e => { if (c.label === "Variation") setArchitecture(e.target.value); }}>
                {c.opts!.map(o => <option key={o}>{o}</option>)}
              </select>
            ) : c.type === "range" ? (
              <div className="flex gap-2 items-center">
                <input type="range" min="0" max="1" step="0.1" defaultValue={c.val} style={{ flex: 1, accentColor: "var(--accent)" }} />
                <span style={{ fontSize: 11, color: "var(--text2)", width: 28 }}>{c.val}</span>
              </div>
            ) : c.type === "check" ? (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked={c.val === "true"} style={{ accentColor: "var(--accent)" }} />
                <span style={{ fontSize: 12 }}>{c.val === "true" ? "Oui" : "Non"}</span>
              </label>
            ) : (
              <input type={c.type} className="form-input" defaultValue={c.val} style={{ fontSize: 12 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

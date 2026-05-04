"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";

interface MLModel {
  id: string;
  name: string;
  architecture: string;
  task_type: string;
  map50: number;
  precision_val: number;
  recall_val: number;
  status: string;
}

interface Detection {
  class: string;
  confidence: number;
  bbox: number[];
}

interface InferenceResult {
  detections: Detection[];
  gradcam_url: string | null;
  latency_ms: number;
  verdict: string;
}

interface HistoryRow {
  filename: string;
  verdict: string;
  detections: string;
  model: string;
  latency: number;
  time: string;
}

export default function TestingPage() {
  const [models, setModels] = useState<MLModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<MLModel | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [result, setResult] = useState<InferenceResult | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [modelStats, setModelStats] = useState<any>(null);
  const detCanvasRef = useRef<HTMLCanvasElement>(null);
  const loadedImgRef = useRef<HTMLImageElement | null>(null);

  // Fetch models
  useEffect(() => {
    api.get("/api/v1/models").then(({ data }) => {
      setModels(data);
      if (data.length > 0) setSelectedModel(data[0]);
    }).catch(() => {});
  }, []);

  // Fetch model stats when model changes
  useEffect(() => {
    if (!selectedModel) return;
    api.get("/api/v1/models/" + selectedModel.id + "/stats")
      .then(({ data }) => setModelStats(data))
      .catch(() => setModelStats(null));
  }, [selectedModel]);

  // Draw detections on canvas
  const drawDetections = useCallback(() => {
    const canvas = detCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const W = parent.clientWidth, H = parent.clientHeight;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0D0E1A";
    ctx.fillRect(0, 0, W, H);

    const img = loadedImgRef.current;
    if (!img) {
      ctx.fillStyle = "#636366"; ctx.font = "14px Inter"; ctx.textAlign = "center";
      ctx.fillText("Uploadez une image pour lancer l'inference", W / 2, H / 2);
      ctx.textAlign = "left";
      return;
    }

    // Draw image
    const scale = Math.min(W / img.width, H / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    ctx.drawImage(img, ox, oy, dw, dh);

    // Draw detections
    if (result && result.detections) {
      result.detections.forEach((det, i) => {
        const [x1, y1, x2, y2] = det.bbox;
        const rx = ox + (x1 / img.width) * dw;
        const ry = oy + (y1 / img.height) * dh;
        const rw = ((x2 - x1) / img.width) * dw;
        const rh = ((y2 - y1) / img.height) * dh;

        const color = det.confidence > 0.8 ? "#FF453A" : det.confidence > 0.5 ? "#FFD60A" : "#00C7BE";

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.fillStyle = color + "20";
        ctx.fillRect(rx, ry, rw, rh);

        // Label
        const label = det.class + " " + (det.confidence * 100).toFixed(1) + "%";
        ctx.font = "bold 11px Inter";
        const tw = ctx.measureText(label).width + 8;
        ctx.fillStyle = color;
        ctx.fillRect(rx, ry - 18, tw, 18);
        ctx.fillStyle = "#121316";
        ctx.fillText(label, rx + 4, ry - 4);
      });
    }
  }, [result]);

  useEffect(() => { drawDetections(); }, [drawDetections]);
  useEffect(() => {
    const h = () => drawDetections();
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [drawDetections]);

  // Handle file selection
  function handleFileSelect(file: File) {
    setImageFile(file);
    setResult(null);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    const img = new Image();
    img.onload = () => { loadedImgRef.current = img; drawDetections(); };
    img.src = url;
  }

  // Run inference
  async function runInference() {
    if (!imageFile || !selectedModel) return;
    setRunning(true);
    try {
      const fd = new FormData();
      fd.append("image", imageFile);
      const { data } = await api.post(
        "/api/v1/inference?model_id=" + selectedModel.id + "&return_gradcam=true",
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setResult(data);

      // Add to history
      const detStr = data.detections.length > 0
        ? data.detections.map((d: Detection) => d.class + " (" + (d.confidence * 100).toFixed(0) + "%)").join(", ")
        : "Aucun defaut";
      setHistory(prev => [{
        filename: imageFile.name,
        verdict: data.verdict === "anomaly" ? "ANORMAL (" + data.detections.length + ")" : "NORMAL",
        detections: detStr,
        model: selectedModel.name,
        latency: data.latency_ms,
        time: new Date().toLocaleTimeString(),
      }, ...prev].slice(0, 20));

      // Refresh model stats
      api.get("/api/v1/models/" + selectedModel.id + "/stats")
        .then(({ data }) => setModelStats(data))
        .catch(() => {});

    } catch (e) { console.error("Inference failed:", e); }
    setRunning(false);
  }

  // Run inference on image from dataset
  async function testDatasetImage(imageId: string, filename: string) {
    if (!selectedModel) return;
    setRunning(true);
    try {
      // Get presigned URL and load the image
      const { data: urlData } = await api.get("/api/v1/analysis/image-url/" + imageId);
      const imgUrl = urlData.url || urlData.thumbnail_url;

      // Load image
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        loadedImgRef.current = img;

        // Convert to blob for inference
        const canvas = document.createElement("canvas");
        canvas.width = img.width; canvas.height = img.height;
        canvas.getContext("2d")!.drawImage(img, 0, 0);
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          const fd = new FormData();
          fd.append("image", blob, filename);
          const { data } = await api.post(
            "/api/v1/inference?model_id=" + selectedModel.id,
            fd,
            { headers: { "Content-Type": "multipart/form-data" } }
          );
          setResult(data);

          const detStr = data.detections.length > 0
            ? data.detections.map((d: Detection) => d.class + " (" + (d.confidence * 100).toFixed(0) + "%)").join(", ")
            : "Aucun defaut";
          setHistory(prev => [{
            filename, verdict: data.verdict === "anomaly" ? "ANORMAL (" + data.detections.length + ")" : "NORMAL",
            detections: detStr, model: selectedModel.name, latency: data.latency_ms,
            time: new Date().toLocaleTimeString(),
          }, ...prev].slice(0, 20));

          setRunning(false);
        }, "image/jpeg");
      };
      img.src = imgUrl;
    } catch (e) { console.error(e); setRunning(false); }
  }

  const verdictColor = result ? (result.verdict === "anomaly" ? "tag-red" : "tag-green") : "";
  const verdictLabel = result ? (result.verdict === "anomaly" ? "DEFAUTS DETECTES (" + result.detections.length + ")" : "PIECE CONFORME") : "";

  return (
    <div className="fade-in">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16, marginBottom: 16 }}>
        {/* Left: Model + Source */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Model selector */}
          <div className="card">
            <div className="card-header"><span className="card-title">Model selection</span></div>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Modele entraine</label>
              <select className="form-select" style={{ fontSize: 12, marginTop: 6 }}
                value={selectedModel?.id || ""}
                onChange={e => setSelectedModel(models.find(m => m.id === e.target.value) || null)}>
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.name} (mAP: {(m.map50 * 100).toFixed(1)}%)</option>
                ))}
              </select>
            </div>
            {selectedModel && (
              <div style={{ background: "var(--bg-input)", borderRadius: 8, padding: 12, fontSize: 12, color: "var(--text2)" }}>
                {[
                  ["Architecture", selectedModel.architecture, ""],
                  ["Precision (mAP@50)", (selectedModel.map50 * 100).toFixed(1) + "%", "var(--green)"],
                  ["Precision val", (selectedModel.precision_val * 100).toFixed(1) + "%", ""],
                  ["Recall val", (selectedModel.recall_val * 100).toFixed(1) + "%", ""],
                  ["Statut", selectedModel.status, "var(--cyan)"],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span>{l}</span><span style={{ color: c || undefined, fontWeight: c ? 600 : 400 }}>{v}</span>
                  </div>
                ))}
                {modelStats?.usage && (
                  <>
                    <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />
                    {[
                      ["Total inferences", modelStats.usage.total_inferences, ""],
                      ["Latence moy.", modelStats.usage.avg_latency_ms?.toFixed(1) + " ms", "var(--cyan)"],
                      ["Verdicts OK", modelStats.usage.ok_count, "var(--green)"],
                      ["Verdicts anomalie", modelStats.usage.anomaly_count, "var(--red)"],
                    ].map(([l, v, c]) => (
                      <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span>{l}</span><span style={{ color: c || undefined, fontWeight: c ? 600 : 400 }}>{v}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Image source */}
          <div className="card">
            <div className="card-header"><span className="card-title">Source image</span></div>
            {/* Upload */}
            <label style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              padding: 20, border: "2px dashed var(--border)", borderRadius: 8, cursor: "pointer", marginBottom: 12,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>
              <span style={{ fontSize: 12, color: "var(--text2)" }}>{imageFile ? imageFile.name : "Glisser ou cliquer pour uploader"}</span>
              <input type="file" accept="image/*" style={{ display: "none" }}
                onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
            </label>

            {/* Run inference button */}
            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}
              onClick={runInference} disabled={running || !imageFile || !selectedModel}>
              {running ? "Inference en cours..." : "Lancer l'inference"}
            </button>

            {/* Quick test from dataset */}
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text3)", marginBottom: 8 }}>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} /><span style={{ fontSize: 11 }}>ou tester depuis le dataset</span><div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {["Test defective", "Test OK"].map(label => (
                  <button key={label} className="btn btn-sm btn-secondary" style={{ flex: 1 }}
                    onClick={async () => {
                      const { data: imgs } = await api.get("/api/v1/images?dataset_id=650e1981-b5ef-49a8-aca8-778d29c60e2b");
                      const target = label.includes("defective")
                        ? imgs.find((i: any) => i.filename.includes("def"))
                        : imgs.find((i: any) => i.filename.includes("ok"));
                      if (target) testDatasetImage(target.id, target.filename);
                    }}>
                    {label.includes("defective") ? "\uD83D\uDD34" : "\uD83D\uDFE2"} {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Results */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Resultat d'inference</span>
            {result && <span className={"tag " + verdictColor}>{verdictLabel}</span>}
          </div>

          {/* Detection canvas */}
          <div className="viz-placeholder" style={{ height: 380, position: "relative", marginBottom: 12 }}>
            <canvas ref={detCanvasRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }} />
          </div>

          {/* Detection details */}
          {result && (
            <div style={{ border: "1px solid var(--border-accent)", borderRadius: 10, padding: 14, background: "rgba(108,99,255,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Analyse des defauts</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text3)" }}>Latence: {result.latency_ms.toFixed(1)} ms</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7, background: "var(--bg-input)", borderRadius: 8, padding: 12 }}>
                {result.detections.length === 0 ? (
                  <p style={{ color: "var(--green)" }}>Aucun defaut detecte — piece conforme.</p>
                ) : (
                  result.detections.map((det, i) => (
                    <div key={i} style={{ marginBottom: i < result.detections.length - 1 ? 8 : 0 }}>
                      <span style={{ color: det.confidence > 0.8 ? "var(--red)" : det.confidence > 0.5 ? "var(--orange)" : "var(--green)" }}>
                        {det.confidence > 0.8 ? "\uD83D\uDD34" : det.confidence > 0.5 ? "\uD83D\uDFE1" : "\uD83D\uDFE2"}{" "}
                        <strong>{det.class}</strong> — Confiance: {(det.confidence * 100).toFixed(1)}%
                      </span>
                      <span style={{ color: "var(--text3)", marginLeft: 8 }}>
                        BBox: [{det.bbox.join(", ")}]
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Inference history table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Historique des inferences</span>
          <span style={{ fontSize: 12, color: "var(--text3)" }}>{history.length} resultat(s)</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "var(--text3)" }}>
              {["Image", "Verdict", "Defauts detectes", "Modele", "Latence", "Heure"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "9px 12px", fontWeight: 500 }}>{r.filename}</td>
                <td style={{ padding: "9px 12px" }}>
                  <span className={"tag " + (r.verdict.includes("ANORMAL") ? "tag-red" : "tag-green")}>{r.verdict}</span>
                </td>
                <td style={{ padding: "9px 12px", color: "var(--text2)" }}>{r.detections}</td>
                <td style={{ padding: "9px 12px", color: "var(--text2)" }}>{r.model}</td>
                <td style={{ padding: "9px 12px", fontFamily: "monospace", color: "var(--text3)" }}>{r.latency.toFixed(1)} ms</td>
                <td style={{ padding: "9px 12px", fontFamily: "monospace", color: "var(--text3)" }}>{r.time}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "24px 12px", textAlign: "center", color: "var(--text3)" }}>
                Lancez une inference pour voir les resultats ici
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

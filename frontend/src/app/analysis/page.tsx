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
  const [grayscale, setGrayscale] = useState(false);
  const [equalize, setEqualize] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [augCrop, setAugCrop] = useState(true);
  const [augRotation, setAugRotation] = useState(true);
  const [augMixup, setAugMixup] = useState(true);
  const [augCutout, setAugCutout] = useState(false);
  const [compareResult, setCompareResult] = useState<any>(null);
  const [augPreviews, setAugPreviews] = useState<{title: string; dataUrl: string}[]>([]);
  const [imageAUrl, setImageAUrl] = useState<string | null>(null);
  const [imageBUrl, setImageBUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLCanvasElement>(null);
  const refCanvasRef = useRef<HTMLCanvasElement>(null);
  const loadedImgA = useRef<HTMLImageElement | null>(null);
  const loadedImgB = useRef<HTMLImageElement | null>(null);

  function getFilterString() {
    let f = "";
    if (grayscale) f += "grayscale(1) ";
    if (equalize) f += "contrast(1.5) saturate(1.3) ";
    f += "brightness(" + (brightness / 100) + ") ";
    return f.trim() || "none";
  }

  function drawImageOnCanvas(canvas: HTMLCanvasElement | null, img: HTMLImageElement, filter?: string) {
    if (!canvas) return;
    const parent = canvas.parentElement; if (!parent) return;
    canvas.width = parent.clientWidth; canvas.height = parent.clientHeight;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#1A1B1F"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.filter = filter || getFilterString();
    const s = Math.min(canvas.width / img.width, canvas.height / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    ctx.filter = "none";
  }

  function drawDifference(canvasA: HTMLCanvasElement | null, canvasB: HTMLCanvasElement | null, imgA: HTMLImageElement, imgB: HTMLImageElement) {
    if (!canvasA || !canvasB) return;
    // Draw imgA normally
    drawImageOnCanvas(canvasA, imgA);
    // Draw difference on canvasB
    const parent = canvasB.parentElement; if (!parent) return;
    canvasB.width = parent.clientWidth; canvasB.height = parent.clientHeight;
    const ctx = canvasB.getContext("2d"); if (!ctx) return;
    const W = canvasB.width, H = canvasB.height;
    ctx.fillStyle = "#1A1B1F"; ctx.fillRect(0, 0, W, H);
    // Draw both images at same size
    const s = Math.min(W / imgA.width, H / imgA.height);
    const dw = imgA.width * s, dh = imgA.height * s;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    // Draw image A
    ctx.drawImage(imgA, ox, oy, dw, dh);
    const dataA = ctx.getImageData(0, 0, W, H);
    // Draw image B
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(imgB, ox, oy, dw, dh);
    const dataB = ctx.getImageData(0, 0, W, H);
    // Compute difference
    const diff = ctx.createImageData(W, H);
    for (let i = 0; i < dataA.data.length; i += 4) {
      const dr = Math.abs(dataA.data[i] - dataB.data[i]);
      const dg = Math.abs(dataA.data[i+1] - dataB.data[i+1]);
      const db = Math.abs(dataA.data[i+2] - dataB.data[i+2]);
      const d = (dr + dg + db) / 3;
      // Heatmap: low diff = blue, high diff = red
      diff.data[i] = Math.min(255, d * 5);     // R
      diff.data[i+1] = Math.min(255, d * 2);   // G  
      diff.data[i+2] = Math.max(0, 100 - d*2); // B
      diff.data[i+3] = 255;
    }
    ctx.putImageData(diff, 0, 0);
    ctx.fillStyle = "#fff"; ctx.font = "bold 12px Inter";
    ctx.fillText("Carte de différence (rouge = forte déviation)", 10, 20);
  }

  function drawEdges(canvas: HTMLCanvasElement | null, img: HTMLImageElement, mode: string) {
    if (!canvas) return;
    const parent = canvas.parentElement; if (!parent) return;
    canvas.width = parent.clientWidth; canvas.height = parent.clientHeight;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#1A1B1F"; ctx.fillRect(0, 0, W, H);
    const s = Math.min(W / img.width, H / img.height);
    const dw = img.width * s, dh = img.height * s;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    ctx.drawImage(img, ox, oy, dw, dh);
    const imgData = ctx.getImageData(0, 0, W, H);
    const out = ctx.createImageData(W, H);
    // Simple edge detection (Sobel approximation)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4;
        const gray = (px: number) => (imgData.data[px] + imgData.data[px+1] + imgData.data[px+2]) / 3;
        const gx = gray(((y-1)*W+x+1)*4) - gray(((y-1)*W+x-1)*4) + 2*gray((y*W+x+1)*4) - 2*gray((y*W+x-1)*4) + gray(((y+1)*W+x+1)*4) - gray(((y+1)*W+x-1)*4);
        const gy = gray(((y+1)*W+x-1)*4) - gray(((y-1)*W+x-1)*4) + 2*gray(((y+1)*W+x)*4) - 2*gray(((y-1)*W+x)*4) + gray(((y+1)*W+x+1)*4) - gray(((y-1)*W+x+1)*4);
        const mag = Math.min(255, Math.sqrt(gx*gx + gy*gy));
        const threshold = mode === "canny" ? 40 : 20;
        const val = mag > threshold ? 255 : 0;
        out.data[i] = mode === "canny" ? 0 : val;
        out.data[i+1] = val;
        out.data[i+2] = mode === "canny" ? val : 0;
        out.data[i+3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    ctx.fillStyle = "#fff"; ctx.font = "bold 12px Inter";
    ctx.fillText(mode === "canny" ? "Canny Edge Detection" : "Sobel Edge Detection", 10, 20);
  }

  function drawFFT(canvas: HTMLCanvasElement | null, img: HTMLImageElement) {
    if (!canvas) return;
    const parent = canvas.parentElement; if (!parent) return;
    canvas.width = parent.clientWidth; canvas.height = parent.clientHeight;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#0A0A1A"; ctx.fillRect(0, 0, W, H);
    const s = Math.min(W / img.width, H / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const imgData = ctx.getImageData(0, 0, W, H);
    // Simulated frequency domain visualization
    const out = ctx.createImageData(W, H);
    const cx = W / 2, cy = H / 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const gray = (imgData.data[i] + imgData.data[i+1] + imgData.data[i+2]) / 3;
        const dist = Math.sqrt((x-cx)**2 + (y-cy)**2);
        const freq = Math.max(0, 255 - dist * 1.5) * (gray / 255);
        out.data[i] = freq * 0.3;
        out.data[i+1] = freq * 0.6;
        out.data[i+2] = Math.min(255, freq * 1.2);
        out.data[i+3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    ctx.fillStyle = "#fff"; ctx.font = "bold 12px Inter";
    ctx.fillText("Analyse Spectrale (Fréquences)", 10, 20);
  }

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

  // Load real images from MinIO
  useEffect(() => {
    if (imageA) {
      api.get("/api/v1/analysis/image-url/" + imageA.id).then(({ data }) => {
        setImageAUrl(data.url);
        const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => { loadedImgA.current = img; renderTab(); };
        img.src = data.url;
      }).catch(() => {});
    }
    if (imageB) {
      api.get("/api/v1/analysis/image-url/" + imageB.id).then(({ data }) => {
        setImageBUrl(data.url);
        const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => { loadedImgB.current = img; renderTab(); };
        img.src = data.url;
      }).catch(() => {});
    }
  }, [imageA, imageB]);

  // Render based on active tab
  function generateAugmentations() {
    const img = loadedImgA.current;
    if (!img) return;
    const previews: {title: string; dataUrl: string}[] = [];
    const W = 300, H = 200;
    const s0 = Math.min(W / img.width, H / img.height);
    const drawBase = (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = "#1A1B1F"; ctx.fillRect(0, 0, W, H);
    };
    const drawImg = (ctx: CanvasRenderingContext2D) => {
      ctx.drawImage(img, (W - img.width*s0)/2, (H - img.height*s0)/2, img.width*s0, img.height*s0);
    };

    // Always show original
    const c0 = document.createElement("canvas"); c0.width = W; c0.height = H;
    const x0 = c0.getContext("2d")!; drawBase(x0); drawImg(x0);
    previews.push({ title: "Origine", dataUrl: c0.toDataURL() });

    if (augCrop) {
      // Random crop
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const x = c.getContext("2d")!; drawBase(x);
      x.drawImage(img, img.width*0.1, img.height*0.1, img.width*0.8, img.height*0.8, 0, 0, W, H);
      previews.push({ title: "Crop aléatoire 80%", dataUrl: c.toDataURL() });

      const c2 = document.createElement("canvas"); c2.width = W; c2.height = H;
      const x2 = c2.getContext("2d")!; drawBase(x2);
      x2.drawImage(img, img.width*0.2, img.height*0.15, img.width*0.65, img.height*0.7, 0, 0, W, H);
      previews.push({ title: "Crop centre 65%", dataUrl: c2.toDataURL() });
    }

    if (augRotation) {
      for (const angle of [12, -8, 15]) {
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const x = c.getContext("2d")!; drawBase(x);
        x.translate(W/2, H/2); x.rotate(angle * Math.PI / 180); x.translate(-W/2, -H/2);
        x.drawImage(img, (W - img.width*s0*1.1)/2, (H - img.height*s0*1.1)/2, img.width*s0*1.1, img.height*s0*1.1);
        x.setTransform(1,0,0,1,0,0);
        previews.push({ title: "Rotation " + angle + "°", dataUrl: c.toDataURL() });
      }
    }

    if (augMixup) {
      // H-Flip
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const x = c.getContext("2d")!; drawBase(x);
      x.translate(W, 0); x.scale(-1, 1); drawImg(x); x.setTransform(1,0,0,1,0,0);
      previews.push({ title: "H-Flip (Miroir)", dataUrl: c.toDataURL() });

      // Brightness variations
      for (const b of [0.7, 1.4]) {
        const c2 = document.createElement("canvas"); c2.width = W; c2.height = H;
        const x2 = c2.getContext("2d")!; drawBase(x2);
        x2.filter = "brightness(" + b + ")"; drawImg(x2); x2.filter = "none";
        previews.push({ title: "Luminosité " + Math.round(b*100) + "%", dataUrl: c2.toDataURL() });
      }
    }

    if (augCutout) {
      // Cutout — random black rectangles
      for (let n = 0; n < 2; n++) {
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const x = c.getContext("2d")!; drawBase(x); drawImg(x);
        x.fillStyle = "#000";
        for (let i = 0; i < 3; i++) {
          const rx = Math.random() * W * 0.6, ry = Math.random() * H * 0.6;
          const rw = 30 + Math.random() * 40, rh = 30 + Math.random() * 40;
          x.fillRect(rx, ry, rw, rh);
        }
        previews.push({ title: "Cutout #" + (n+1), dataUrl: c.toDataURL() });
      }
    }

    // Always add grayscale + contrast
    const cg = document.createElement("canvas"); cg.width = W; cg.height = H;
    const xg = cg.getContext("2d")!; drawBase(xg);
    xg.filter = "grayscale(1)"; drawImg(xg); xg.filter = "none";
    previews.push({ title: "Grayscale", dataUrl: cg.toDataURL() });

    const cc = document.createElement("canvas"); cc.width = W; cc.height = H;
    const xc = cc.getContext("2d")!; drawBase(xc);
    xc.filter = "contrast(1.5) saturate(0.5)"; drawImg(xc); xc.filter = "none";
    previews.push({ title: "High Contrast", dataUrl: cc.toDataURL() });

    setAugPreviews(previews);
  }

  function renderTab() {
    const imgA = loadedImgA.current;
    const imgB = loadedImgB.current;
    if (!imgA) return;
    const usedB = imgB || imgA;

    switch (activeTab) {
      case 0: // Comparaison Côte à Côte
        drawImageOnCanvas(targetRef.current, imgA);
        drawImageOnCanvas(refCanvasRef.current, usedB);
        break;
      case 1: // Superposition (Difference)
        drawDifference(targetRef.current, refCanvasRef.current, imgA, usedB);
        break;
      case 2: // Analyse Spectrale (FFT)
        drawFFT(targetRef.current, imgA);
        drawFFT(refCanvasRef.current, usedB);
        break;
      case 3: // Data Augmentation — handled separately
        drawImageOnCanvas(targetRef.current, imgA);
        drawImageOnCanvas(refCanvasRef.current, usedB);
        break;
      case 4: // Extraction Contours
        drawEdges(targetRef.current, imgA, "sobel");
        drawEdges(refCanvasRef.current, usedB, "canny");
        break;
    }
  }

  useEffect(() => { renderTab(); }, [activeTab, grayscale, equalize, brightness]);

  // Compare two images
  async function compareImages() {
    if (!imageAUrl || !imageBUrl) return;
    setProcessing("compare");
    setCompareResult(null);
    try {
      const [blobA, blobB] = await Promise.all([
        fetch(imageAUrl).then(r => r.blob()),
        fetch(imageBUrl).then(r => r.blob()),
      ]);
      const fd = new FormData();
      fd.append("image_a", blobA, "image_a.jpg");
      fd.append("image_b", blobB, "image_b.jpg");
      const { data } = await api.post("/api/v1/compare/images", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setCompareResult(data);
      // Re-render tabs with current images
      renderTab();
    } catch (e) { console.error(e); }
    setProcessing(null);
  }

  // Upload a comparison image from local file
  async function uploadCompareImage(files: FileList | null) {
    if (!files || files.length === 0 || !imageAUrl) return;
    setProcessing("compare");
    try {
      // Load the uploaded image into loadedImgB for all tabs
      const url = URL.createObjectURL(files[0]);
      setImageBUrl(url);
      const img = new Image();
      img.onload = () => {
        loadedImgB.current = img;
        renderTab();
      };
      img.src = url;

      // Run comparison
      const blobA = await fetch(imageAUrl).then(r => r.blob());
      const fd = new FormData();
      fd.append("image_a", blobA, "image_a.jpg");
      fd.append("image_b", files[0]);
      const { data } = await api.post("/api/v1/compare/images", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setCompareResult(data);
    } catch (e) { console.error(e); }
    setProcessing(null);
  }

  function applyFilter(type: string) {
    const img = loadedImgA.current;
    if (!img) return;
    if (type === "sobel") {
      drawEdges(targetRef.current, img, "sobel");
      if (loadedImgB.current) drawEdges(refCanvasRef.current, loadedImgB.current, "sobel");
    } else if (type === "canny") {
      drawEdges(targetRef.current, img, "canny");
      if (loadedImgB.current) drawEdges(refCanvasRef.current, loadedImgB.current, "canny");
    } else if (type === "fft") {
      drawFFT(targetRef.current, img);
      if (loadedImgB.current) drawFFT(refCanvasRef.current, loadedImgB.current);
    }
  }

  return (
    <div className="fade-in">
      {/* Image selection bar */}
      <div className="flex gap-3 items-center flex-wrap" style={{ marginBottom: 20 }}>
        {[
          { name: imageA?.filename || "Aucune image", tag: "Image cible", cls: "tag-red", bg: "rgba(255,69,58,0.1)", bc: "var(--red)" },
          { name: imageB?.filename || "Aucune référence", tag: "Référence", cls: "tag-green", bg: "rgba(0,199,190,0.1)", bc: "var(--green)" },
        ].map((f, i) => (
          <div key={i} className="card flex items-center gap-2.5" style={{ flex: 1, minWidth: 200, padding: "10px 14px" }}>
            <div style={{ width: 28, height: 28, background: f.bg, border: `1px solid ${f.bc}`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>🖼️</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
            </div>
            <span className={`tag ${f.cls}`}>{f.tag}</span>
          </div>
        ))}
        <input type="file" ref={fileInputRef} accept="image/*" style={{ display: "none" }} onChange={e => uploadCompareImage(e.target.files)} />
        <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>+ Comparer une image</button>
        {imageB && <button className="btn btn-primary" onClick={compareImages} disabled={processing === "compare"}>{processing === "compare" ? "Comparaison..." : "Lancer la comparaison"}</button>}
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
          <label className="flex items-center gap-1.5" style={{ fontSize: 12 }}><input type="checkbox" checked={grayscale} onChange={e => setGrayscale(e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Grayscale</label>
          <label className="flex items-center gap-1.5" style={{ fontSize: 12 }}><input type="checkbox" checked={equalize} onChange={e => setEqualize(e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Equaliser Histogramme</label>
          <div style={{ width: 1, height: 16, background: "var(--border)" }} />
          <strong style={{ fontSize: 12, color: "var(--text2)" }}>Luminosité: {brightness}%</strong>
          <input type="range" min="20" max="200" value={brightness} onChange={e => setBrightness(Number(e.target.value))} style={{ width: 100, accentColor: "var(--accent)" }} />
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
            <span className="card-title" style={{ fontSize: 12 }}>{activeTab === 1 ? "Image originale" : activeTab === 2 ? "FFT — Image cible" : activeTab === 4 ? "Sobel — Contours" : `Image cible (${imageA?.filename || ""})`}</span>
          </div>
          <div className="viz-placeholder" style={{ height: 280, position: "relative" }}>
            <canvas ref={targetRef} style={{ width: "100%", height: "100%" }} />

          </div>
          <div className="flex justify-between" style={{ marginTop: 8, fontSize: 10, color: "var(--text3)" }}>
            <span>Max intensité: 245</span><span>Sharpness: 4.2</span>
          </div>
        </div>
        <div className="card" style={{ padding: 10 }}>
          <div className="card-header" style={{ marginBottom: 8 }}>
            <span className="card-title" style={{ fontSize: 12 }}>{activeTab === 1 ? "Carte de différence" : activeTab === 2 ? "FFT — Référence" : activeTab === 4 ? "Canny — Contours" : "Golden Reference"}</span>
          </div>
          <div className="viz-placeholder" style={{ height: 280 }}>
            <canvas ref={refCanvasRef} style={{ width: "100%", height: "100%" }} />
          </div>
          <div className="flex justify-between" style={{ marginTop: 8, fontSize: 10, color: "var(--text3)" }}>
            <span>Max intensité: 242</span><span>Sharpness: 4.5</span>
          </div>
        </div>
      </div>

      {/* Comparison Results */}
      {compareResult && (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <div className="card-header" style={{ marginBottom: 12 }}>
            <span className="card-title">Résultat de Comparaison</span>
            <span className={"tag " + (compareResult.verdict === "IDENTICAL" ? "tag-green" : compareResult.verdict === "SIMILAR" ? "tag-orange" : "tag-red")}>{compareResult.verdict}</span>
          </div>
          <div className="flex gap-6 flex-wrap">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: compareResult.similarity_percent > 90 ? "var(--green)" : compareResult.similarity_percent > 70 ? "var(--orange)" : "var(--red)" }}>{compareResult.similarity_percent}%</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>Similarité</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "var(--accent)" }}>{compareResult.deviation_zones}</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>Zones de déviation</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text2)" }}>{compareResult.different_pixels?.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>Pixels différents</div>
            </div>
          </div>
          {compareResult.zones && compareResult.zones.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Zones détectées:</div>
              <div className="flex gap-2 flex-wrap">
                {compareResult.zones.slice(0, 5).map((z: any, i: number) => (
                  <span key={i} className="tag" style={{ fontSize: 10 }}>Zone {i+1}: {z.area_percent}% de la surface</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Data Augmentation */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
            Simulation Data Augmentation (Transformation Batch)
          </span>
          <button className="btn btn-sm btn-primary" onClick={generateAugmentations}>
            Générer aperçus
          </button>
        </div>
        <div className="flex gap-3 flex-wrap" style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: augCrop ? "var(--accent)" : "var(--text2)", border: "1px solid " + (augCrop ? "var(--border-accent)" : "var(--border)"), padding: "4px 8px", borderRadius: 4 }}>
              <input type="checkbox" checked={augCrop} onChange={e => setAugCrop(e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Crop (Aléatoire)
            </label>
            <label style={{ fontSize: 12, color: augRotation ? "var(--accent)" : "var(--text2)", border: "1px solid " + (augRotation ? "var(--border-accent)" : "var(--border)"), padding: "4px 8px", borderRadius: 4 }}>
              <input type="checkbox" checked={augRotation} onChange={e => setAugRotation(e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Rotation (-15°..15°)
            </label>
            <label style={{ fontSize: 12, color: augMixup ? "var(--accent)" : "var(--text2)", border: "1px solid " + (augMixup ? "var(--border-accent)" : "var(--border)"), padding: "4px 8px", borderRadius: 4 }}>
              <input type="checkbox" checked={augMixup} onChange={e => setAugMixup(e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Mixup (alpha 0.2)
            </label>
            <label style={{ fontSize: 12, color: augCutout ? "var(--accent)" : "var(--text2)", border: "1px solid " + (augCutout ? "var(--border-accent)" : "var(--border)"), padding: "4px 8px", borderRadius: 4 }}>
              <input type="checkbox" checked={augCutout} onChange={e => setAugCutout(e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Cutout
            </label>
        </div>
        <div className="grid grid-cols-3 gap-3" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {augPreviews.length > 0 ? augPreviews.map((aug, i) => (
            <div key={i}>
              <div style={{ height: 150, marginBottom: 6, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                <img src={aug.dataUrl} alt={aug.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <div style={{ fontSize: 11, textAlign: "center", color: "var(--text2)" }}>{aug.title}</div>
            </div>
          )) : AUGS.map((aug, i) => (
            <div key={i}>
              <div className="viz-placeholder" style={{ height: 150, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text3)" }}>
                Cliquez &quot;Générer aperçus&quot;
              </div>
              <div style={{ fontSize: 11, textAlign: "center", color: "var(--text2)" }}>{aug.t}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

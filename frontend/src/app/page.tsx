"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const KPIS = [
  { label: "Images inspectées", value: "14 247", delta: "+1.4k ce mois", icon: "📷", color: "--accent" },
  { label: "Modèles vision", value: "18", delta: "5 en prod (YOLO/ResNet)", icon: "👁️", color: "--cyan" },
  { label: "Défauts détectés", value: "942", delta: "96.2% précision", icon: "⚠️", color: "--orange" },
  { label: "BBox / Calques", value: "38 680", delta: "sur 12 datasets", icon: "🏷️", color: "--green" },
];

const MODULES = [
  { id: "viewer", num: "01", name: "Visualiseur & Annotation", desc: "Chargez, zoomez et annotez vos images (sélection carrée, outils de contour au crayon). Descriptions textuelles.", color: "#E06C00", icon: "✏️" },
  { id: "analysis", num: "02", name: "Analyse & Comparaison", desc: "Comparez des images, testez filtres, analyses spectrales (FFT), ou Data Aug. (Crop, Mixup) en masse.", color: "#00C7BE", icon: "🔍" },
  { id: "training", num: "03", name: "Entraînement", desc: "Pipeline Drag & Drop pour chaîner vos traitements et modèles de Computer Vision (CNN, ViT, YOLO).", color: "#FFD60A", icon: "⚙️" },
  { id: "testing", num: "04", name: "Test en live", desc: "Uploadez ou capturez via webcam. Explicabilité de chaque décision (Grad-CAM, Visualisation d'activations).", color: "#32D74B", icon: "🎥" },
  { id: "deployment", num: "05", name: "Déploiement", desc: "Exportez sous différents formats (ONNX, TensorRT, API) pour intégration immédiate sur lignes.", color: "#FF453A", icon: "🚀" },
];

const ACTIVITY = [
  { text: "Tracé libre (fissure) sur carter_moteur_082.jpg", time: "Il y a 5 min", dot: "--accent" },
  { text: "Modèle YOLOv8_Detect_v3 affiné (mAP: 86.4%)", time: "Il y a 1h", dot: "--green" },
  { text: "Export ONNX finalisé pour Edge Deployment", time: "Il y a 3h", dot: "--cyan" },
  { text: "200 images augmentées générées (Crop + Mixup)", time: "Il y a 6h", dot: "--orange" },
];

export default function HomePage() {
  const router = useRouter();
  const [health, setHealth] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    api.get("/health").then((r) => setHealth(r.data)).catch(() => {});
  }, []);

  return (
    <div className="fade-in">
      {/* Hero */}
      <div
        className="card"
        style={{
          background: "linear-gradient(135deg, var(--bg3), var(--bg))",
          marginBottom: 24, padding: "36px 32px",
          position: "relative", overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", top: -60, right: -60, width: 280, height: 280, background: "radial-gradient(circle, rgba(224,108,0,0.15), transparent 70%)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", bottom: -40, left: 200, width: 200, height: 200, background: "radial-gradient(circle, rgba(0,199,190,0.1), transparent 70%)", borderRadius: "50%" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="flex gap-2.5" style={{ marginBottom: 16 }}>
            <span className="tag tag-accent">v1.0 Beta</span>
            <span className="tag tag-cyan">Computer Vision & IA</span>
          </div>
          <h2 style={{
            fontSize: 28, fontWeight: 800, marginBottom: 10,
            background: "linear-gradient(135deg, #F2F2F7, var(--accent2))",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>
            Inspection Visuelle des Défauts Industriels
          </h2>
          <p style={{ color: "var(--text2)", fontSize: 14, maxWidth: 540, lineHeight: 1.7 }}>
            Visualisez, annotez, et comparez vos images de production. Augmentez vos données, concevez des modèles de segmentation/détection, et testez-les en direct avec explicabilité.
          </p>
          <div className="flex gap-2.5" style={{ marginTop: 24 }}>
            <button className="btn btn-primary" onClick={() => router.push("/viewer")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              Commencer l&apos;inspection
            </button>
            <button className="btn btn-secondary" onClick={() => router.push("/training")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
              Construire un modèle
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4" style={{ marginBottom: 24 }}>
        {KPIS.map((k) => (
          <div key={k.label} className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>{k.icon}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: `var(${k.color})` }}>{k.value}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{k.label}</div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{k.delta}</div>
          </div>
        ))}
      </div>

      {/* Section title */}
      <p className="section-title">Modules de la plateforme Framework</p>

      {/* Modules grid (3 cols) */}
      <div className="grid grid-cols-3 gap-4" style={{ marginBottom: 24 }}>
        {MODULES.map((b) => (
          <div
            key={b.id}
            className="card"
            style={{ cursor: "pointer", transition: "all 0.2s ease", borderColor: "transparent" }}
            onClick={() => router.push(`/${b.id}`)}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = `${b.color}40`;
              (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "transparent";
              (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
            }}
          >
            <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
              <div style={{
                width: 42, height: 42, background: `${b.color}20`, borderRadius: 10,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
              }}>
                {b.icon}
              </div>
              <div>
                <div style={{ fontSize: 10, color: b.color, fontWeight: 700, letterSpacing: "0.1em" }}>BRIQUE {b.num}</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{b.name}</div>
              </div>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.6 }}>{b.desc}</p>
            <div className="flex items-center gap-1" style={{ marginTop: 14, color: b.color, fontSize: 12, fontWeight: 600 }}>
              Accéder
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </div>
          </div>
        ))}

        {/* Recent activity */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Activité récente
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {ACTIVITY.map((a, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: `var(${a.dot})`, marginTop: 5, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 12 }}>{a.text}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{a.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

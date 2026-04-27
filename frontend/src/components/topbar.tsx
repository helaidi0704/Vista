"use client";

import { usePathname } from "next/navigation";

const PAGE_TITLES: Record<string, string> = {
  "/": "Accueil",
  "/viewer": "Visualiseur & Annotation",
  "/analysis": "Analyse & Comparaison",
  "/training": "Entraînement de Modèles",
  "/testing": "Test en live & Explicabilité",
  "/deployment": "Déploiement",
};

export function Topbar() {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] || "VISTA";

  return (
    <header
      className="flex items-center justify-between shrink-0"
      style={{
        padding: "16px 28px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg2)",
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h1>

      <div className="flex items-center gap-3">
        {/* Status chip */}
        <div className="status-chip">
          <span className="status-dot" />
          Système actif
        </div>

        {/* Notifications */}
        <button
          className="flex items-center justify-center"
          title="Notifications"
          style={{
            width: 36, height: 36,
            background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", cursor: "pointer",
            color: "var(--text2)", transition: "all var(--transition)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        </button>

        {/* Settings */}
        <button
          className="flex items-center justify-center"
          title="Paramètres"
          style={{
            width: 36, height: 36,
            background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", cursor: "pointer",
            color: "var(--text2)", transition: "all var(--transition)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a1.65 1.65 0 010 2.33 1.65 1.65 0 01-2.33 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a1.65 1.65 0 01-3.3 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a1.65 1.65 0 01-2.33-2.33l.06-.06A1.65 1.65 0 005.18 15a1.65 1.65 0 00-1.51-1H3a1.65 1.65 0 010-3.3h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a1.65 1.65 0 012.33-2.33l.06.06A1.65 1.65 0 009 5.18a1.65 1.65 0 001-1.51V3a1.65 1.65 0 013.3 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a1.65 1.65 0 012.33 2.33l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a1.65 1.65 0 010 3.3h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
}

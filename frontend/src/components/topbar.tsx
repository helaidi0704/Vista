"use client";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/auth-guard";

const PAGE_TITLES: Record<string, string> = {
  "/": "Accueil",
  "/viewer": "Visualiseur & Annotation",
  "/analysis": "Analyse & Comparaison",
  "/training": "Entrainement de Modeles",
  "/testing": "Test en live & Explicabilite",
  "/deployment": "Deploiement",
};

export function Topbar() {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] || "VISTA";

  return (
    <header className="flex items-center justify-between shrink-0"
      style={{ padding: "16px 28px", borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h1>
      <div className="flex items-center gap-3">
        <div className="status-chip"><span className="status-dot" />Systeme actif</div>
        <button className="flex items-center justify-center" title="Notifications"
          style={{ width: 36, height: 36, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--text2)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
        </button>
        <UserMenu />
      </div>
    </header>
  );
}

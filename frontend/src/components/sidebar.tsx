"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  {
    label: "Accueil", href: "/", badge: null,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>,
  },
  {
    label: "Visualiseur & Annotation", href: "/viewer", badge: "1",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>,
  },
  {
    label: "Analyse & Comparaison", href: "/analysis", badge: "2",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  },
  {
    label: "Entraînement de Modèles", href: "/training", badge: "3",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
  },
  {
    label: "Test en live & Explicabilité", href: "/testing", badge: "4",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  },
  {
    label: "Déploiement", href: "/deployment", badge: "5",
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="shrink-0 flex flex-col h-screen" style={{ width: 240, minWidth: 240, background: "var(--bg2)", borderRight: "1px solid var(--border)" }}>
      {/* Logo */}
      <div className="flex items-center gap-3" style={{ padding: "24px 20px", borderBottom: "1px solid var(--border)" }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect x="4" y="4" width="20" height="20" rx="4" stroke="var(--accent)" strokeWidth="2"/>
          <circle cx="14" cy="14" r="5" stroke="var(--green)" strokeWidth="2"/>
          <circle cx="21" cy="7" r="1.5" fill="var(--accent)"/>
        </svg>
        <span style={{ fontSize: 18, fontWeight: 700, background: "linear-gradient(135deg, var(--accent), var(--green))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
          VISTA
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto" style={{ padding: "16px 12px" }}>
        {navItems.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className="flex items-center gap-3"
              style={{
                padding: "11px 12px", borderRadius: "var(--radius-sm)", textDecoration: "none",
                color: isActive ? "var(--text)" : "var(--text2)", fontSize: "13.5px", fontWeight: 500,
                transition: "all var(--transition)",
                background: isActive ? "linear-gradient(135deg, rgba(224,108,0,0.15), rgba(0,199,190,0.1))" : undefined,
                border: isActive ? "1px solid var(--border-accent)" : "1px solid transparent",
              }}>
              <span className="shrink-0" style={{ width: 18, height: 18, display: "flex" }}>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <span className="flex items-center justify-center" style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text3)", fontSize: 10, fontWeight: 600, width: 20, height: 20, borderRadius: "50%" }}>
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User chip */}
      <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2.5" style={{ padding: 8, borderRadius: "var(--radius-sm)", background: "var(--bg3)" }}>
          <div className="flex items-center justify-center shrink-0" style={{ width: 32, height: 32, background: "linear-gradient(135deg, var(--accent), var(--cyan))", borderRadius: "50%", fontSize: 13, fontWeight: 700, color: "#fff" }}>
            M
          </div>
          <div className="flex flex-col">
            <span style={{ fontSize: 12, fontWeight: 600 }}>M. Seddar</span>
            <span style={{ fontSize: 10, color: "var(--text3)" }}>Ingénieur Vision IA</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

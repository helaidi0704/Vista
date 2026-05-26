"use client";
import { useState } from "react";
import { useTranslation, Lang } from "@/lib/i18n";

export function LangSwitcher() {
  const { lang, setLang, langs, LANG_LABELS, LANG_FLAGS } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)}
        className="flex items-center justify-center"
        style={{
          width: 36, height: 36, background: "var(--bg3)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
          cursor: "pointer", color: "var(--text2)", fontSize: 14,
        }}>
        {LANG_FLAGS[lang]}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: 42, right: 0, background: "var(--bg2)",
          border: "1px solid var(--border)", borderRadius: 10, padding: 4,
          zIndex: 1000, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: 120,
        }}>
          {langs.map(l => (
            <div key={l} onClick={() => { setLang(l); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                fontSize: 12, fontWeight: lang === l ? 700 : 400,
                color: lang === l ? "var(--accent)" : "var(--text2)",
                background: lang === l ? "var(--accent-glow)" : "transparent",
              }}
              onMouseEnter={e => { if (lang !== l) (e.currentTarget as HTMLElement).style.background = "var(--bg3)"; }}
              onMouseLeave={e => { if (lang !== l) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <span>{LANG_FLAGS[l]}</span>
              <span>{LANG_LABELS[l]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

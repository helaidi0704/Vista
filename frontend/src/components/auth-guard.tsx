"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  organization?: string;
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("vista_token");
    const savedUser = localStorage.getItem("vista_user");

    if (!token) {
      window.location.href = "/login";
      return;
    }

    // Set token on axios
    api.defaults.headers.common["Authorization"] = "Bearer " + token;

    // Verify token is still valid
    api.get("/api/v1/auth/me").then(({ data }) => {
      const u = data.user;
      setUser(u);
      localStorage.setItem("vista_user", JSON.stringify(u));
      setChecking(false);
    }).catch(() => {
      // Token expired or invalid
      localStorage.removeItem("vista_token");
      localStorage.removeItem("vista_user");
      window.location.href = "/login";
    });
  }, []);

  if (checking) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-main, #121316)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #E06C00, #FF9500)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
          </div>
          <div style={{ fontSize: 14, color: "var(--text3, #636366)" }}>Verification...</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("vista_user");
    if (saved) setUser(JSON.parse(saved));
  }, []);

  function logout() {
    localStorage.removeItem("vista_token");
    localStorage.removeItem("vista_user");
    delete api.defaults.headers.common["Authorization"];
    window.location.href = "/login";
  }

  if (!user) return null;

  const initials = user.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const roleColor = user.role === "admin" ? "var(--accent, #E06C00)" : user.role === "engineer" ? "var(--green, #00C7BE)" : "var(--text3)";

  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 10px", borderRadius: 8, background: open ? "var(--bg-input)" : "transparent", transition: "background 0.15s" }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #E06C00, #FF9500)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff" }}>
          {initials}
        </div>
        <div style={{ fontSize: 12 }}>
          <div style={{ fontWeight: 600 }}>{user.full_name}</div>
          <div style={{ color: roleColor, fontSize: 10 }}>{user.role} — {user.organization || "VISTA"}</div>
        </div>
      </div>

      {open && (
        <div style={{ position: "absolute", top: 44, right: 0, width: 220, background: "var(--bg-card, #1C1C1E)", border: "1px solid var(--border)", borderRadius: 10, padding: 8, zIndex: 1000, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text2)", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
            <div style={{ fontWeight: 600 }}>{user.email}</div>
            <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>{user.organization || "VISTA Demo"}</div>
          </div>
          <div onClick={() => { setOpen(false); }}
            style={{ padding: "8px 12px", fontSize: 12, borderRadius: 6, cursor: "pointer" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-input)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            Mon profil
          </div>
          <div onClick={logout}
            style={{ padding: "8px 12px", fontSize: 12, color: "var(--red, #FF453A)", borderRadius: 6, cursor: "pointer" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-input)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            Se deconnecter
          </div>
        </div>
      )}
    </div>
  );
}

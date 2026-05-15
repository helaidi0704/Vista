"use client";
import { useState } from "react";
import { api } from "@/lib/api";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/register";
      const body = mode === "login"
        ? { email, password }
        : { email, password, full_name: fullName, organization_name: orgName || undefined };
      const { data } = await api.post(endpoint, body);
      localStorage.setItem("vista_token", data.access_token);
      localStorage.setItem("vista_user", JSON.stringify(data.user));
      api.defaults.headers.common["Authorization"] = "Bearer " + data.access_token;
      window.location.href = "/";
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Erreur de connexion";
      setError(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    setLoading(false);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-main, #121316)" }}>
      <div style={{ width: 420, padding: 0 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #E06C00, #FF9500)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>
            </div>
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px" }}>VISTA</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--text3, #636366)" }}>Visual Inspection for Smart Industrial Applications</div>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: 28 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
            {mode === "login" ? "Connexion" : "Creer un compte"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 20 }}>
            {mode === "login" ? "Entrez vos identifiants pour acceder a la plateforme" : "Inscrivez-vous pour commencer l'inspection visuelle"}
          </div>

          {error && (
            <div style={{ background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--red, #FF453A)" }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {mode === "register" && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label className="form-label">Nom complet</label>
                  <input className="form-input" type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                    placeholder="Jean Dupont" required style={{ marginTop: 6, width: "100%", fontSize: 13 }} />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label className="form-label">Nom de l'entreprise</label>
                  <input className="form-input" type="text" value={orgName} onChange={e => setOrgName(e.target.value)}
                    placeholder="ACME Motors (optionnel)" style={{ marginTop: 6, width: "100%", fontSize: 13 }} />
                  <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 4 }}>Laissez vide pour rejoindre l'espace demo</div>
                </div>
              </>
            )}
            <div style={{ marginBottom: 14 }}>
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="admin@vista.ai" required style={{ marginTop: 6, width: "100%", fontSize: 13 }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label className="form-label">Mot de passe</label>
              <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required style={{ marginTop: 6, width: "100%", fontSize: 13 }} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}
              style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14 }}>
              {loading ? "Chargement..." : mode === "login" ? "Se connecter" : "Creer le compte"}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "var(--text3)" }}>
            {mode === "login" ? (
              <>Pas encore de compte? <span onClick={() => { setMode("register"); setError(""); }} style={{ color: "var(--accent, #E06C00)", cursor: "pointer", fontWeight: 600 }}>S'inscrire</span></>
            ) : (
              <>Deja un compte? <span onClick={() => { setMode("login"); setError(""); }} style={{ color: "var(--accent, #E06C00)", cursor: "pointer", fontWeight: 600 }}>Se connecter</span></>
            )}
          </div>
        </div>

        {/* Demo credentials hint */}
        <div style={{ marginTop: 16, background: "rgba(224,108,0,0.08)", border: "1px solid rgba(224,108,0,0.2)", borderRadius: 10, padding: 14, fontSize: 11, color: "var(--text2, #9F9EA1)" }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--accent, #E06C00)" }}>Comptes de demonstration</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span>Admin VISTA:</span><span>admin@vista.ai / admin123</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>ACME Motors:</span><span>engineer@acme-motors.com / Acme2024!</span>
          </div>
        </div>
      </div>
    </div>
  );
}

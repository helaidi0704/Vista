import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export const metadata: Metadata = {
  title: "VISTA — Inspection Visuelle Industrielle",
  description: "Visualisez, annotez et inspectez vos images de production avec l'IA",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="antialiased">
        <Providers>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 flex flex-col overflow-hidden">
              <Topbar />
              <div className="flex-1 overflow-y-auto" style={{ padding: "24px 28px" }}>
                {children}
              </div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}

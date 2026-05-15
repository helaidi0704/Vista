"use client";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { AuthGuard } from "@/components/auth-guard";
import { usePathname } from "next/navigation";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return (
      <html lang="fr">
        <body className="antialiased">
          <Providers>{children}</Providers>
        </body>
      </html>
    );
  }

  return (
    <html lang="fr">
      <body className="antialiased">
        <Providers>
          <AuthGuard>
            <div className="flex h-screen overflow-hidden">
              <Sidebar />
              <main className="flex-1 flex flex-col overflow-hidden">
                <Topbar />
                <div className="flex-1 overflow-y-auto" style={{ padding: "24px 28px" }}>
                  {children}
                </div>
              </main>
            </div>
          </AuthGuard>
        </Providers>
      </body>
    </html>
  );
}

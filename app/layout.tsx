import type { ReactNode } from "react";

import AppShell from "../components/AppShell";
import "./globals.css";

export const metadata = {
  title: "Grupo RR Cred",
  description: "Sistema de producao, comissoes, auditoria e financeiro",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

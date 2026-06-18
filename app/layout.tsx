import type { ReactNode } from "react";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

import AppShell from "../components/AppShell";
import "./globals.css";

// Fundação de tipografia (Etapa 1): registra IBM Plex Sans + Mono no layout raiz
// e expõe como CSS variables no <html>. Antes, o @font-face da Sans só era
// injetado pela className da sidebar (frágil) e a Mono nem era carregada (refs
// 'IBM Plex Mono' caíam em SFMono). Agora TODA tela + topbar herdam IBM Plex via
// var(--font-sans) no globals.css, sem depender da sidebar.
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-mono",
});

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
    <html lang="pt-BR" className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { COOKIE_TEMA } from "@/components/layout/preferencia-tema";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "AVANTE", template: "%s · AVANTE" },
  description: "AVANTE: gestão comercial, funil de vendas e agenda — Rio X7 Agência Digital",
};

/**
 * Aplica o tema antes de pintar (sem "piscar"): a escolha salva no cookie
 * ou, sem escolha, o tema do sistema. Script mínimo, sem dados do usuário,
 * para não deixar todas as páginas dinâmicas só por causa do tema.
 */
const SCRIPT_TEMA = `(function(){try{var m=document.cookie.match(/(?:^|; )${COOKIE_TEMA}=([^;]+)/);var t=m?decodeURIComponent(m[1]):null;var tema=t==='claro'?'claro':t==='escuro'?'escuro':(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'claro':'escuro');document.documentElement.setAttribute('data-tema',tema);}catch(e){document.documentElement.setAttribute('data-tema','escuro');}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      // O script acima põe `data-tema` antes da hidratação.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

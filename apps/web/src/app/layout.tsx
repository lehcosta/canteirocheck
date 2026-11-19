import type { Metadata } from "next";
import "./globals.css";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cn } from "@/lib/utils";

const archivo = Archivo({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-archivo" });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: { default: "EngCheck", template: "%s · EngCheck" },
  description: "Obra no prumo: cada etapa conferida antes de seguir.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={cn("font-sans", archivo.variable, plexSans.variable, plexMono.variable)}>
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}

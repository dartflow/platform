import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/components/pwa-screens.css";
import "@/components/oche-live.css";
import { PwaRuntime } from "@/components/pwa-install";
import LegacyLink from "@/components/legacy-link";
export const metadata: Metadata = {
  title: "DartFlow",
  description: "De clubavond in één flow. Van check-in tot de laatste dubbel.",
  icons: { icon: "/assets/dartflow-icon.svg" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#121315",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body>
        <LegacyLink />
        <PwaRuntime>{children}</PwaRuntime>
      </body>
    </html>
  );
}

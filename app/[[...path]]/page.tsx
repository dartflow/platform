import DartflowApp from "@/components/dartflow-app";
import MarketingHome from "@/components/marketing-home";
import ClubBoardScreen from "@/components/club-board-screen";
import ScoreboardLauncher from "@/components/scoreboard-launcher";
import {BOARD_ID_PATTERN, manifestForPath} from "@/lib/pwa";
import type { Metadata } from "next";
import { appConfig } from "@/lib/config";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
export async function generateMetadata({ params }: Context): Promise<Metadata> {
  const path = (await params).path || [];
  const origin = appConfig().origin;
  const production = origin === "https://dartflow.nl";
  if (path.length)
    return {
      title: ["baanscherm","oche-live","scorebord"].includes(path[0]) ? "Oche Live" : "DartFlow · Speelomgeving",
      robots: { index: false, follow: false },
      appleWebApp: {capable: true, statusBarStyle: "black-translucent", title: ["baanscherm","oche-live","scorebord"].includes(path[0]) ? "Oche Live" : "DartFlow Speler"},
      icons: {icon: ["baanscherm","oche-live","scorebord"].includes(path[0]) ? "/assets/pwa/oche-live-192.png" : "/assets/pwa/player-192.png", apple: ["baanscherm","oche-live","scorebord"].includes(path[0]) ? "/assets/pwa/oche-live-180.png" : "/assets/pwa/player-180.png"},
    };
  return {
    title: "DartFlow | Online darten, live scorebord en darttoernooien",
    description:
      "Speel darts online of op locatie met DartFlow. Probeer het Oche Live-scorebord met invoer op je telefoon en ontdek clubcompetities, toernooiregie en meer.",
    alternates: { canonical: origin },
    robots: { index: production, follow: production },
    openGraph: {
      type: "website",
      locale: "nl_NL",
      siteName: "DartFlow",
      title: "DartFlow | Online darten, live scorebord en darttoernooien",
      description:
        "Van een oefenleg thuis tot een vol clubtoernooi. Ontdek DartFlow en probeer het interactieve Oche Live-scorebord.",
      url: origin,
      images: [
        {
          url: `${origin}/assets/marketing-share.jpg`,
          width: 1200,
          height: 630,
          alt: "Drie darts met limegroene flights in een dartbord",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "DartFlow | Darten, waar je ook speelt",
      images: [`${origin}/assets/marketing-share.jpg`],
    },
  };
}
export default async function Page({ params }: Context) {
  const path = (await params).path || [];
  const manifest = manifestForPath(path);
  const content = ['baanscherm','oche-live'].includes(path[0]) && path.length === 2 && BOARD_ID_PATTERN.test(path[1])
    ? <ClubBoardScreen boardId={path[1].toLowerCase()} />
    : path[0] === 'scorebord' && path.length === 1
      ? <ScoreboardLauncher />
      : path.length ? <DartflowApp /> : <MarketingHome origin={appConfig().origin} />;
  return <>{manifest && <link rel="manifest" href={manifest} crossOrigin="use-credentials" />}{content}</>;

}

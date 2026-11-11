import DartflowApp from "@/components/dartflow-app";
import MarketingHome from "@/components/marketing-home";
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
      title: "DartFlow · Speelomgeving",
      robots: { index: false, follow: false },
    };
  return {
    title: "DartFlow | Online darten, live scorebord en darttoernooien",
    description:
      "Speel darts online of op locatie met DartFlow. Probeer het Sprint-scorebord met invoer op je telefoon en ontdek clubcompetities, toernooiregie en meer.",
    alternates: { canonical: origin },
    robots: { index: production, follow: production },
    openGraph: {
      type: "website",
      locale: "nl_NL",
      siteName: "DartFlow",
      title: "DartFlow | Online darten, live scorebord en darttoernooien",
      description:
        "Van een oefenleg thuis tot een vol clubtoernooi. Ontdek DartFlow en probeer het interactieve Sprint-scorebord.",
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
  return path.length ? (
    <DartflowApp />
  ) : (
    <MarketingHome origin={appConfig().origin} />
  );
}

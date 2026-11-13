/* eslint-disable @next/next/no-css-tags -- The public marketing page alone loads its verified reference stylesheet. */
import { marketingContent } from "./marketing-content";
import MarketingInteractions from "./marketing-interactions";

export default function MarketingHome({ origin }: { origin: string }) {
  const content = process.env.DARTFLOW_DATA_MODE === "supabase"
    ? marketingContent.replace(
        '<nav aria-label="Footernavigatie">',
        '<nav aria-label="Footernavigatie"><button type="button" class="dartflow-privacy-link" data-open-dartflow-privacy>Privacyvoorkeuren</button>',
      )
    : marketingContent;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "DartFlow",
    url: origin,
    applicationCategory: "SportsApplication",
    operatingSystem: "Web",
    inLanguage: "nl-NL",
    description:
      "Darten met live scoretelling, Oche Live, online en lokale wedstrijden, clubcompetities en toernooiregie.",
    featureList: [
      "X01-scoretelling met legs en checkout-suggesties",
      "Oche Live met score-invoer op telefoon",
      "Training, clubcompetities en toernooien",
      "Toernooiregie met check-in, baantoewijzing en schermweergave",
    ],
  };
  return (
    <>
      <link rel="stylesheet" href="/marketing.css" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <div
        className="marketing-page"
        dangerouslySetInnerHTML={{ __html: content }}
      />
      <MarketingInteractions />
    </>
  );
}

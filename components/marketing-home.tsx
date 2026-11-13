/* eslint-disable @next/next/no-css-tags -- The public marketing page alone loads its verified reference stylesheet. */
import { marketingContent } from "./marketing-content";
import MarketingInteractions from "./marketing-interactions";
import {liveBlogPosts} from "./blog-data";
import {renderLatestBlog} from "./blog-public";

export default async function MarketingHome({ origin }: { origin: string }) {
  let latest = "";
  try { latest = renderLatestBlog(await liveBlogPosts(), origin); } catch { /* The marketing homepage remains available during database maintenance. */ }
  const withBlog = marketingContent.replace('<section id="veelgestelde-vragen"', latest + '<section id="veelgestelde-vragen"');
  const content = process.env.DARTFLOW_DATA_MODE === "supabase"
    ? withBlog.replace(
        '<nav aria-label="Footernavigatie">',
        '<nav aria-label="Footernavigatie"><button type="button" class="dartflow-privacy-link" data-open-dartflow-privacy>Privacyvoorkeuren</button>',
      )
    : withBlog;
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
      <link rel="stylesheet" href="/blog.css" />
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

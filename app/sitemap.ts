import type { MetadataRoute } from "next";
import { appConfig } from "@/lib/config";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = appConfig().origin;
  return origin === "https://dartflow.nl"
    ? [{ url: origin, changeFrequency: "monthly", priority: 1 }]
    : [];
}

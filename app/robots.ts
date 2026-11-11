import type { MetadataRoute } from "next";
import { appConfig } from "@/lib/config";
export default function robots(): MetadataRoute.Robots {
  const origin = appConfig().origin;
  return origin === "https://dartflow.nl"
    ? {
        rules: {
          userAgent: "*",
          allow: "/",
          disallow: [
            "/app",
            "/inloggen",
            "/api/",
            "/wedstrijd/",
            "/baan/",
            "/scherm/",
            "/cast/",
          ],
        },
        sitemap: `${origin}/sitemap.xml`,
      }
    : { rules: { userAgent: "*", disallow: "/" } };
}

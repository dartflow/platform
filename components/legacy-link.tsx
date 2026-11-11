"use client";
import { useEffect } from "react";
import { legacyDestination } from "@/lib/routes";
export default function LegacyLink() {
  useEffect(() => {
    const apply = () => {
      if (!location.hash) return;
      const route = location.hash.replace(/^#\/?/, "");
      const publicAnchors = new Set([
        "boven",
        "inhoud",
        "mogelijkheden",
        "sprint",
        "toernooiregie",
        "veelgestelde-vragen",
        "programma",
        "deelnemers",
        "stand",
      ]);
      if (publicAnchors.has(route)) return;
      // Preserve the identity in existing scorer and board UUID links.
      if (/^(?:match|baan-phone)\/[0-9a-f-]{36}$/i.test(route)) {
        const destination = legacyDestination(location.hash);
        if (destination) location.replace(destination);
        return;
      }
      const allowed =
        /^(?:home|dashboard|play|practice|lobby|training|clubs|mymatches|events|leagues|hall|operations|baan|baan-screen|baan-phone|venue|venue-cast|manage|mail|friends|community|reports|camera|match|spectator|overlay|tournaments|players|registrations|pools|knockout|matches|rankings|statistics|settings)(?:[/?]|$)/;
      if (allowed.test(route) && !/[%\\\r\n]/.test(route)) {
        const target = route === "home" ? "" : route;
        location.replace(`/app/${target}`);
        return;
      }
      const destination = legacyDestination(location.hash);
      if (destination) location.replace(destination);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  return null;
}

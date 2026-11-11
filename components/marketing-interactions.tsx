"use client";
import { useEffect } from "react";

export default function MarketingInteractions() {
  useEffect(() => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/marketing.js";
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);
  return null;
}

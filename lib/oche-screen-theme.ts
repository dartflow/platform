import type { ThemeTokens } from "./clubhouse-types";
import type { OcheScreenTheme } from "./oche-device-types";

const TOKEN_NAMES: (keyof ThemeTokens)[] = [
  "background",
  "surface",
  "surfaceRaised",
  "border",
  "text",
  "muted",
  "primary",
  "onPrimary",
  "secondary",
  "focus",
  "success",
  "warning",
  "error",
];
export const DEFAULT_OCHE_THEME: OcheScreenTheme = {
  id: "dartflow",
  version: 1,
};

/** Both elapsed-time arguments are monotonic performance timestamps. */
export const ocheScreenServerTime = (
  serverNow: number,
  receivedAt: number,
  current: number,
) => serverNow + Math.max(0, current - receivedAt);

/** The public screen consumes only bounded, versioned colours and image data. */
export function effectiveOcheScreenTheme(
  input: unknown,
  now: number,
): OcheScreenTheme {
  if (!input || typeof input !== "object" || !Number.isFinite(now))
    return DEFAULT_OCHE_THEME;
  const value = input as Record<string, unknown>;
  if (value.version !== 1) return DEFAULT_OCHE_THEME;
  if (value.id === "dartflow" || value.id === "onzetrots")
    return { id: value.id, version: 1 };
  if (
    value.id !== "club" ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 80 ||
    typeof value.validUntil !== "string" ||
    !Number.isFinite(Date.parse(value.validUntil)) ||
    Date.parse(value.validUntil) <= now ||
    !Number.isSafeInteger(value.brandingRevision) ||
    Number(value.brandingRevision) < 1
  )
    return DEFAULT_OCHE_THEME;
  if (
    value.logoData !== null &&
    (typeof value.logoData !== "string" ||
      value.logoData.length > 180000 ||
      !/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(
        value.logoData,
      ))
  )
    return DEFAULT_OCHE_THEME;
  const tokens = value.tokens as Record<string, unknown> | null;
  const palettes = {} as { light: ThemeTokens; dark: ThemeTokens };
  for (const mode of ["light", "dark"] as const) {
    const palette = tokens?.[mode] as Record<string, unknown> | undefined;
    if (
      !palette ||
      TOKEN_NAMES.some(
        (key) =>
          typeof palette[key] !== "string" ||
          !/^#[0-9a-f]{6}$/i.test(palette[key] as string),
      )
    )
      return DEFAULT_OCHE_THEME;
    palettes[mode] = Object.fromEntries(
      TOKEN_NAMES.map((key) => [key, palette[key]]),
    ) as ThemeTokens;
  }
  return {
    id: "club",
    version: 1,
    name: value.name.trim(),
    logoData: value.logoData as string | null,
    brandingRevision: Number(value.brandingRevision),
    validUntil: value.validUntil,
    tokens: palettes,
  };
}

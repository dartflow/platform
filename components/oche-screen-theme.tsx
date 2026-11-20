"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { OcheScreenTheme } from "@/lib/oche-device-types";
import {
  DEFAULT_OCHE_THEME,
  effectiveOcheScreenTheme,
  ocheScreenServerTime,
} from "@/lib/oche-screen-theme";
import "./oche-screen-theme.css";

const ScreenThemeContext = createContext<OcheScreenTheme>(DEFAULT_OCHE_THEME);
export const useOcheScreenTheme = () => useContext(ScreenThemeContext);

/** Device configuration only. This deliberately has no access to account preferences. */
export function OcheScreenThemeProvider({
  theme,
  serverNow,
  children,
}: {
  theme?: OcheScreenTheme;
  serverNow: number;
  children: ReactNode;
}) {
  const [clock, setClock] = useState({ server: serverNow, elapsed: 0 });
  useEffect(() => {
    const received = performance.now();
    const tick = () =>
      setClock({
        server: serverNow,
        elapsed: ocheScreenServerTime(0, received, performance.now()),
      });
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [serverNow]);
  // A newly received snapshot must not briefly inherit a preceding snapshot's clock.
  const now =
    clock.server === serverNow ? clock.server + clock.elapsed : serverNow;
  const effective = effectiveOcheScreenTheme(theme, now);
  const style =
    effective.id === "club"
      ? (Object.fromEntries(
          Object.entries(effective.tokens.dark).map(([key, value]) => [
            `--oche-club-${key}`,
            value,
          ]),
        ) as CSSProperties)
      : undefined;
  return (
    <ScreenThemeContext value={effective}>
      <div
        className="oche-screen-theme"
        data-oche-theme={effective.id}
        style={style}
      >
        {children}
      </div>
    </ScreenThemeContext>
  );
}

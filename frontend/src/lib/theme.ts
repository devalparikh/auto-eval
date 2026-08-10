export const THEME_COOKIE_NAME = "autoeval-theme";

export type ColorTheme = "dark" | "light";

export function colorThemeFromCookie(value: string | undefined): ColorTheme {
  return value === "light" ? "light" : "dark";
}

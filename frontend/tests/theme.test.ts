import { describe, expect, it } from "vitest";
import { colorThemeFromCookie } from "@/lib/theme";

describe("color theme preference", () => {
  it("uses the persisted light theme and otherwise defaults to dark", () => {
    expect(colorThemeFromCookie("light")).toBe("light");
    expect(colorThemeFromCookie("dark")).toBe("dark");
    expect(colorThemeFromCookie("system")).toBe("dark");
    expect(colorThemeFromCookie(undefined)).toBe("dark");
  });
});

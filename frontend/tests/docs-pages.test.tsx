import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docsContent } from "@/features/docs/content";
import { docsNeighbors, docsPages } from "@/features/docs/docs-pages";

vi.mock("@/lib/use-catalog", () => ({
  useCatalog: () => ({
    data: { models: [] },
    loading: false,
    error: null,
    reload: vi.fn(async () => undefined),
  }),
}));

afterEach(cleanup);

/*
 * The registry's section list drives the rail and the command menu, while the
 * page body renders the headings. A section added to one and not the other
 * would leave a dead link in the rail or a heading nobody can jump to.
 */
describe("docs pages", () => {
  it.each(docsPages.map((page) => [page.title, page] as const))(
    "%s renders exactly the sections its registry entry lists",
    (_title, page) => {
      const Content = docsContent[page.slug];
      expect(Content).toBeDefined();
      const { container } = render(<Content />);
      const headings = [...container.querySelectorAll("h2")].map((heading) => ({
        id: heading.id,
        title: heading.firstChild?.textContent?.trim(),
      }));
      expect(headings).toEqual(page.sections);
    },
  );

  it("gives every page a unique slug and a path under /docs", () => {
    const slugs = docsPages.map((page) => page.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const page of docsPages) {
      expect(page.href).toBe(page.slug ? `/docs/${page.slug}` : "/docs");
    }
  });

  it("links each page to its neighbours in reading order", () => {
    docsPages.forEach((page, index) => {
      const { previous, next } = docsNeighbors(page);
      expect(previous ?? null).toBe(docsPages[index - 1] ?? null);
      expect(next ?? null).toBe(docsPages[index + 1] ?? null);
    });
  });
});

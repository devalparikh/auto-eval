import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HouseSimpleIcon, PulseIcon } from "@phosphor-icons/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandMenu } from "@/components/command-menu";
import {
  groupBySection,
  searchCommands,
  type CommandEntry,
} from "@/components/command-search";
import { api } from "@/lib/api";
import type { Catalog, Trace } from "@/lib/types";
import { useCatalog } from "@/lib/use-catalog";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({
    href,
    onNavigate,
    ...props
  }: {
    href: string;
    onNavigate?: () => void;
  } & Record<string, unknown>) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.();
      }}
      {...props}
    />
  ),
}));
vi.mock("@/lib/use-catalog", () => ({ useCatalog: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { traces: vi.fn(), customModels: vi.fn() },
}));

function entry(
  title: string,
  extra: Partial<CommandEntry> = {},
): CommandEntry {
  return {
    id: title,
    title,
    section: "Go to",
    icon: HouseSimpleIcon,
    ...extra,
  };
}

describe("searchCommands", () => {
  const entries = [
    entry("Results", { pinned: true }),
    entry("Result rows", { section: "Other" }),
    entry("Dashboard outage", {
      section: "Traces",
      detail: "results pipeline",
      icon: PulseIcon,
    }),
  ];

  it("shows only pinned entries before anything is typed", () => {
    expect(searchCommands(entries, "  ").map(({ title }) => title)).toEqual([
      "Results",
    ]);
  });

  it("ranks an exact title, then a title match, then other matches", () => {
    expect(searchCommands(entries, "results").map(({ title }) => title)).toEqual(
      ["Results", "Dashboard outage"],
    );
    expect(searchCommands(entries, "result").map(({ title }) => title)).toEqual([
      "Result rows",
      "Results",
      "Dashboard outage",
    ]);
  });

  it("requires every word to match", () => {
    expect(searchCommands(entries, "dashboard pipeline")).toHaveLength(1);
    expect(searchCommands(entries, "dashboard nothing")).toHaveLength(0);
  });

  it("keeps each section's rows together, so arrow keys follow the screen", () => {
    const a = entry("a", { section: "One" });
    const b = entry("b", { section: "Two" });
    const c = entry("c", { section: "One" });
    expect(groupBySection([a, b, c])).toEqual([a, c, b]);
  });
});

describe("CommandMenu", () => {
  const onClose = vi.fn();
  const onToggleTheme = vi.fn();

  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCatalog).mockReturnValue({
      data: {
        agent_systems: [
          {
            id: "s1",
            key: "incident-triage",
            name: "Incident triage",
            description: "Triage incidents",
            versions: [],
          },
        ],
        datasets: [
          {
            id: "d1",
            agent_system_id: "s1",
            name: "Ground truth",
            versions: [],
          },
        ],
      } as unknown as Catalog,
      error: null,
      loading: false,
      reload: vi.fn(),
    });
    vi.mocked(api.traces).mockResolvedValue([
      {
        id: "trace-abcdef123456",
        model_id: "mock/fast",
        status: "complete",
        request_input: { text: "Dashboard is down" },
      },
    ] as unknown as Trace[]);
    vi.mocked(api.customModels).mockResolvedValue([]);
  });
  afterEach(cleanup);

  function renderMenu(pathname = "/systems/incident-triage/run") {
    render(
      <CommandMenu
        pathname={pathname}
        theme="dark"
        sidebarCollapsed={false}
        onToggleTheme={onToggleTheme}
        onToggleSidebar={vi.fn()}
        onClose={onClose}
      />,
    );
    return screen.getByRole("combobox", { name: "Search AutoEval" });
  }

  it("starts with the current system's pages, top-level pages, and actions", () => {
    renderMenu();
    const list = within(screen.getByRole("listbox"));
    expect(list.getByRole("option", { name: /Overview/ })).toHaveAttribute(
      "href",
      "/systems/incident-triage",
    );
    expect(list.getByRole("option", { name: /Custom models/ })).toBeVisible();
    expect(list.getByRole("option", { name: /Use light theme/ })).toBeVisible();
    expect(list.queryByRole("option", { name: /Ground truth/ })).toBeNull();
  });

  it("navigates to the highlighted row with the keyboard", () => {
    const input = renderMenu();
    fireEvent.change(input, { target: { value: "datasets" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/systems/incident-triage/datasets");
  });

  it("finds a trace in the current system", async () => {
    const input = renderMenu();
    fireEvent.change(input, { target: { value: "dashboard" } });
    expect(
      await screen.findByRole("option", { name: /Dashboard is down/ }),
    ).toHaveAttribute(
      "href",
      "/systems/incident-triage/traces/trace-abcdef123456",
    );
  });

  it("keeps a system's section when switching systems from search", () => {
    const input = renderMenu("/systems/other/results");
    fireEvent.change(input, { target: { value: "incident" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/systems/incident-triage/results");
  });

  it("runs actions, and closes with Escape without reaching a modal below", () => {
    const onDocumentKey = vi.fn();
    document.addEventListener("keydown", onDocumentKey);
    const input = renderMenu();
    fireEvent.change(input, { target: { value: "light theme" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onToggleTheme).toHaveBeenCalledOnce();

    onClose.mockClear();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onDocumentKey).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: "Escape" }),
    );
    document.removeEventListener("keydown", onDocumentKey);
  });

  it("does not ask for traces outside a system", () => {
    renderMenu("/import");
    expect(api.traces).not.toHaveBeenCalled();
  });

  it("says when nothing matches", () => {
    const input = renderMenu();
    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(screen.getByText("Nothing matches “zzzz”.")).toBeVisible();
  });
});

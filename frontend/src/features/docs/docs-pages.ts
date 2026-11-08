import {
  BracketsCurlyIcon,
  CompassIcon,
  CpuIcon,
  FingerprintIcon,
  GraduationCapIcon,
  LightningIcon,
  PackageIcon,
  PlugsConnectedIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";

export type DocsSection = { id: string; title: string };

export type DocsGroup = "Get started" | "Guides" | "Reference";

export type DocsPage = {
  /** The path segment after `/docs`; empty for the overview. */
  slug: string;
  href: string;
  /** The sidebar label and the page's h1. */
  title: string;
  /** The lead under the h1, the meta description, and the search detail. */
  description: string;
  group: DocsGroup;
  icon: Icon;
  /**
   * The page's h2s, in order. The table of contents and search read this
   * list, so every entry must be rendered by the page as a `DocSection` with
   * the same id and title. A test holds the two together.
   */
  sections: DocsSection[];
  /** Words a reader might search for that the title does not contain. */
  keywords?: string;
};

function page(entry: Omit<DocsPage, "href">): DocsPage {
  return { ...entry, href: entry.slug ? `/docs/${entry.slug}` : "/docs" };
}

/**
 * Every docs page in reading order. The order is the sidebar's order and the
 * previous/next links at the foot of each page. The icons come from the SSR
 * entry because route files render this registry on the server.
 */
export const docsPages: DocsPage[] = [
  page({
    slug: "",
    title: "Overview",
    description:
      "AutoEval records every agent run as a trace, turns reviewed traces into locked test datasets, and benchmarks models and graph versions against them on quality, cost, and latency.",
    group: "Get started",
    icon: CompassIcon,
    sections: [
      { id: "the-loop", title: "The loop" },
      { id: "concepts", title: "Core concepts" },
      { id: "sample-agents", title: "Sample agents" },
      { id: "ground-rules", title: "Ground rules" },
      { id: "next-steps", title: "Next steps" },
    ],
    keywords: "introduction concepts glossary",
  }),
  page({
    slug: "quickstart",
    title: "Quickstart",
    description:
      "Install AutoEval, run a sample agent, save its trace as a test case, and read your first benchmark. The sample agents run on mock models, so no API key is needed.",
    group: "Get started",
    icon: LightningIcon,
    sections: [
      { id: "install", title: "Install" },
      { id: "run-a-sample-agent", title: "Run a sample agent" },
      { id: "inspect-the-trace", title: "Inspect the trace" },
      { id: "save-a-test-case", title: "Save a test case" },
      { id: "run-a-benchmark", title: "Run a benchmark" },
      { id: "read-the-results", title: "Read the results" },
    ],
    keywords: "install setup getting started first run make dev",
  }),
  page({
    slug: "import",
    title: "Import a system",
    description:
      "Describe an agent's graph in one autoeval.json manifest. The import validates it and saves immutable graph and prompt versions.",
    group: "Guides",
    icon: PackageIcon,
    sections: [
      { id: "walkthrough", title: "Walkthrough" },
      { id: "choose-a-source", title: "Choose a source" },
      { id: "review-and-import", title: "Review and import" },
      { id: "new-versions", title: "Import a new version" },
    ],
    keywords: "onboarding manifest autoeval.json github folder",
  }),
  page({
    slug: "existing-code",
    title: "Adapt existing code",
    description:
      "When an agent needs custom tools, retrieval, or another framework's state, register a plugin with its own handlers, scoring, and trace policy.",
    group: "Guides",
    icon: PlugsConnectedIcon,
    sections: [
      { id: "pick-a-route", title: "Pick a route" },
      { id: "write-a-plugin", title: "Write a plugin" },
      { id: "current-limits", title: "Current limits" },
      { id: "coding-agent", title: "Hand it to a coding agent" },
    ],
    keywords: "plugin adapter handlers scoring framework langgraph extension",
  }),
  page({
    slug: "models",
    title: "Model providers",
    description:
      "Every run and benchmark picks its model from one catalog. Mock models work offline, OpenRouter adds hosted models, and LM Studio adds models running on your machine.",
    group: "Guides",
    icon: CpuIcon,
    sections: [
      { id: "mock-models", title: "Mock models" },
      { id: "openrouter", title: "OpenRouter" },
      { id: "lm-studio", title: "LM Studio" },
      { id: "cost-and-tokens", title: "Cost and tokens" },
    ],
    keywords: "openrouter lm studio local inference api key provider",
  }),
  page({
    slug: "fine-tuning",
    title: "Fine-tuning",
    description:
      "Train a LoRA adapter on a finalized dataset on your own Apple Silicon Mac. Training data never leaves the machine.",
    group: "Guides",
    icon: GraduationCapIcon,
    sections: [
      { id: "set-up-training", title: "Set up training" },
      { id: "train-a-model", title: "Train a model" },
      { id: "training-data", title: "Training data" },
      { id: "what-a-model-pins", title: "What a model pins" },
      { id: "use-the-adapter", title: "Use the adapter" },
    ],
    keywords: "custom models mlx lora adapter training",
  }),
  page({
    slug: "manifest",
    title: "Manifest reference",
    description:
      "autoeval.json, schema version 1. One file describes a system, its graph, and its primary prompt.",
    group: "Reference",
    icon: BracketsCurlyIcon,
    sections: [
      { id: "fields", title: "Fields" },
      { id: "validation", title: "Validation rules" },
      { id: "handlers", title: "Built-in handlers" },
      { id: "starter", title: "Starter manifest" },
    ],
    keywords: "autoeval.json schema contract json",
  }),
  page({
    slug: "provenance",
    title: "Versions and provenance",
    description:
      "Every result points back to exactly what ran. Versions never change, so last month's score still means what it meant then.",
    group: "Reference",
    icon: FingerprintIcon,
    sections: [
      { id: "immutable-versions", title: "Immutable versions" },
      { id: "datasets", title: "Draft and finalized datasets" },
      { id: "what-a-run-pins", title: "What a run pins" },
      { id: "snapshots", title: "Snapshots" },
      { id: "graph-comparisons", title: "Comparing graph versions" },
    ],
    keywords: "immutable hash reproducible snapshot finalize",
  }),
];

export const docsGroups: DocsGroup[] = ["Get started", "Guides", "Reference"];

export function docsPageBySlug(slug: string): DocsPage | undefined {
  return docsPages.find((entry) => entry.slug === slug);
}

export function isDocsPath(pathname: string): boolean {
  return pathname === "/docs" || pathname.startsWith("/docs/");
}

/** The pages either side of this one in reading order. */
export function docsNeighbors(current: DocsPage): {
  previous: DocsPage | null;
  next: DocsPage | null;
} {
  const index = docsPages.indexOf(current);
  return {
    previous: docsPages[index - 1] ?? null,
    next: docsPages[index + 1] ?? null,
  };
}

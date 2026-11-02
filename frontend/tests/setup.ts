import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { clearApiResourceCache } from "@/lib/use-api-resource";

beforeEach(clearApiResourceCache);

if (typeof globalThis.ResizeObserver === "undefined") {
  class TestResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      void callback;
    }

    observe() {}

    unobserve() {}

    disconnect() {}
  }

  globalThis.ResizeObserver = TestResizeObserver;
}

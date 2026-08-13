import "@testing-library/jest-dom/vitest";

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

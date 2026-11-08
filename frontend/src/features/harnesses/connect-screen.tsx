"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/select";
import { PageHeader } from "@/components/page-header";
import { useCatalog } from "@/lib/use-catalog";
import { harnessApi } from "./harness-api";
import { harnesses } from "./setup";

export function ConnectHarnessScreen() {
  const router = useRouter();
  const catalog = useCatalog();
  const [harness, setHarness] =
    useState<(typeof harnesses)[number][0]>("claude-code");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeader
        title="Connect your harness"
        description="Turn coding sessions into reviewed training data and compare changes on the same tasks."
      />
      <form
        className="surface-card m-4 grid max-w-2xl gap-5 p-6 md:m-7"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const workspace = await harnessApi.connect({ key, name, harness });
            await catalog.reload();
            router.push(`/systems/${workspace.key}`);
          } catch (error) {
            setError(
              error instanceof Error ? error.message : "Connection failed",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="grid gap-2">
          Harness
          <Select
            aria-label="Harness"
            className="app-input"
            value={harness}
            onChange={(e) => setHarness(e.target.value as typeof harness)}
          >
            {harnesses.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-2">
          System name
          <input
            className="app-input"
            required
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (
                !key ||
                key ===
                  name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/-$/, "")
              )
                setKey(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/-$/, ""),
                );
            }}
            placeholder="My coding agent"
          />
        </label>
        <label className="grid gap-2">
          System key
          <input
            className="app-input mono"
            required
            pattern="[a-z][a-z0-9-]{1,99}"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="my-coding-agent"
          />
        </label>
        <p className="text-sm text-[var(--text-muted)]">
          Your harness keeps running where it does today. A local recorder
          captures model conversations through CLIProxyAPI. You choose which
          sessions may train a model.
        </p>
        {error && <p role="alert">{error}</p>}
        <button className="app-button" disabled={busy}>
          {busy ? "Connecting…" : "Connect harness"}
        </button>
      </form>
    </>
  );
}

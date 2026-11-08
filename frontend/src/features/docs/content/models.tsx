import { CodeBlock } from "../code-block";
import { ConfiguredModels } from "../configured-models";
import { DocSection, ExternalLink, Steps } from "../doc-blocks";

const lmStudioServer = `lms server start
lms load
curl http://127.0.0.1:1234/v1/models`;

const lmStudioEnv = `ENABLE_LM_STUDIO=true
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
LM_STUDIO_MODELS=your-loaded-model-id`;

export function ModelsDoc() {
  return (
    <>
      <DocSection id="mock-models" title="Mock models">
        <p>
          The sample agents default to deterministic mock models such as{" "}
          <code>mock/incident-specialist</code>. They need no network and no
          keys, and they give the same answer on every run, which keeps the
          sample benchmarks stable.
        </p>
      </DocSection>

      <DocSection id="openrouter" title="OpenRouter">
        <p>
          Add your key to the backend <code>.env</code> and restart AutoEval.
          OpenRouter models then appear in the model picker on every Run and
          Evaluate page.
        </p>
        <CodeBlock title=".env" code="OPENROUTER_API_KEY=your-key" />
        <ul>
          <li>
            Requests go to OpenRouter&apos;s fixed API endpoint.{" "}
            <code>OPENROUTER_APP_URL</code> only sets the attribution referrer.
          </li>
          <li>
            The model list is pinned in the backend rather than fetched at
            startup, so the catalog does not shift under a benchmark.
          </li>
          <li>
            The key stays in the backend environment. Never put a secret in a{" "}
            <code>NEXT_PUBLIC_</code> value; those ship to the browser.
          </li>
        </ul>
      </DocSection>

      <DocSection id="lm-studio" title="LM Studio">
        <Steps>
          <li>
            Load a model in LM Studio and start its local server, from the{" "}
            <strong>Developer</strong> tab or the CLI. Then list the IDs it
            serves.
            <CodeBlock title="Terminal" code={lmStudioServer} />
          </li>
          <li>
            Add the model ID to the backend <code>.env</code>. Separate several
            IDs with commas.
            <CodeBlock title=".env" code={lmStudioEnv} />
          </li>
          <li>
            Restart AutoEval with <code>make dev</code>. The model appears as{" "}
            <code>lmstudio/&lt;id&gt;</code> on Run and Evaluate.
          </li>
        </Steps>
        <ConfiguredModels />
        <ul>
          <li>
            Set <code>LM_STUDIO_API_TOKEN</code> if the server requires
            authentication. It stays in the backend.
          </li>
          <li>
            Keep the URL on loopback with an explicit port and the{" "}
            <code>/v1</code> path. Requests do not follow redirects or use proxy
            settings.
          </li>
          <li>Choose a model that can follow the graph&apos;s JSON schema.</li>
          <li>
            Configuration does not prove the server is up; each run checks.
          </li>
        </ul>
        <p>
          <ExternalLink href="https://lmstudio.ai/docs/developer/openai-compat">
            LM Studio API documentation
          </ExternalLink>
        </p>
      </DocSection>

      <DocSection id="cost-and-tokens" title="Cost and tokens">
        <p>
          Each trace records tokens and cost as the provider reports them. Local
          inference records latency and the tokens LM Studio reports, and its
          API cost is $0, which leaves out hardware and electricity. A model
          that fails keeps its error in the trace.
        </p>
      </DocSection>
    </>
  );
}

import Link from "next/link";
import { CodeBlock } from "../code-block";
import { Callout, DocRow, DocSection, DocTable, Steps } from "../doc-blocks";

export function FineTuningDoc() {
  return (
    <>
      <DocSection id="set-up-training" title="Set up training">
        <p>
          Training runs MLX LoRA on Apple Silicon. Datasets and model records
          work anywhere; only training needs the Mac. Install the optional
          dependencies into the environment that runs the backend:
        </p>
        <CodeBlock
          title="Terminal"
          code=".venv/bin/python -m pip install -e 'backend[training]'"
        />
        <p>
          Then select <strong>Refresh</strong> on{" "}
          <Link href="/custom-models">Custom models</Link>. The check runs in a
          separate process and confirms real Metal GPU access, so a sandboxed
          or headless process shows a setup message instead.
        </p>
        <DocTable head={["Variable", "Purpose"]}>
          <DocRow term={<code>AUTOEVAL_TRAINING_ARTIFACTS_DIR</code>}>
            Exports, adapters, and the shared base-weight cache. Defaults to{" "}
            <code>.autoeval/models</code>.
          </DocRow>
          <DocRow term={<code>AUTOEVAL_TRAINING_TIMEOUT_SECONDS</code>}>
            The longest a job may run, download included. Defaults to{" "}
            <code>21600</code>.
          </DocRow>
          <DocRow term={<code>HF_TOKEN</code>}>
            Optional. A backend-only token for gated model downloads.
          </DocRow>
        </DocTable>
      </DocSection>

      <DocSection id="train-a-model" title="Train a model">
        <Steps>
          <li>
            Open <Link href="/custom-models">Custom models</Link> and select{" "}
            <strong>New</strong>.
          </li>
          <li>
            Choose a Qwen or Llama starter, or enter an MLX-compatible Hugging
            Face model ID, then pick a finalized dataset.
          </li>
          <li>
            Review the exported example and select{" "}
            <strong>Create model</strong>.
          </li>
          <li>
            Select <strong>Start fine-tuning</strong>. The first run downloads
            the base weights.
          </li>
        </Steps>
        <Callout tone="warning">
          Check the base model&apos;s license and your free memory before
          training a larger model. Jobs run one at a time.
        </Callout>
      </DocSection>

      <DocSection id="training-data" title="Training data">
        <p>Each dataset case becomes one chat example:</p>
        <ul>
          <li>The system message is the training instruction.</li>
          <li>The user message is the case input, as JSON.</li>
          <li>The assistant message is the reviewed expected output, as JSON.</li>
        </ul>
        <p>
          Training needs at least two distinct inputs with expected outputs.
          Duplicate inputs with the same answer are dropped and conflicting
          answers are rejected. A deterministic 10% holdout, at least one
          example, is kept for validation. Examples do not replay the agent
          graph or resolve snapshots, so review the sample before training.
        </p>
        <p>
          Validation loss is a training diagnostic, not a benchmark score.
        </p>
      </DocSection>

      <DocSection id="what-a-model-pins" title="What a model pins">
        <p>
          Each custom model pins its dataset version and content fingerprint,
          the instruction, the base model and the exact commit it resolved to,
          and the training parameters. A recipe cannot be edited after
          creation; <strong>Create from this model</strong> starts a new record.
          Names and archive state stay editable, and archiving keeps artifacts
          and history.
        </p>
        <p>
          No training data is uploaded. The worker downloads base weights from
          Hugging Face, accepts no command or path from the browser, and does
          not inherit provider keys.
        </p>
      </DocSection>

      <DocSection id="use-the-adapter" title="Use the adapter">
        <p>
          <strong>Download adapter</strong> produces a ZIP with the adapter
          weights and config, a <code>manifest.json</code>, and a{" "}
          <code>result.json</code>. It leaves out training examples and base
          weights. Load it through MLX with the base model and commit recorded
          in <code>result.json</code>.
        </p>
        <Callout>
          Custom models do not appear in the benchmark model picker yet, and
          AutoEval does not serve adapters.
        </Callout>
      </DocSection>
    </>
  );
}

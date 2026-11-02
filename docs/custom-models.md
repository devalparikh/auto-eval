# Custom models

Open **Custom models** in the sidebar to prepare and train a model from a finalized
dataset. Choose a Qwen or Llama starter, or enter an MLX-compatible Hugging Face
model ID. Review the exported example, save the model, then select **Start
fine-tuning**. The first run downloads the base weights. Check the selected
model's license and available memory before training a larger model.

## Local setup

The first executor is MLX LoRA on Apple Silicon. The API and dataset/model
management still work without MLX or on other hardware. Install training support
from the repository root, using the same environment that runs the backend:

```bash
.venv/bin/python -m pip install -e 'backend[training]'
```

Refresh the training environment on the page. The readiness check runs in a
separate process and checks actual Metal GPU access. Sandboxed or headless
processes without GPU access show a setup message. Local training is disabled
in the production profile. Keep the local API on loopback and use one API process.

Backend configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTOEVAL_TRAINING_ARTIFACTS_DIR` | `.autoeval/models` | Private training exports, adapters, and shared base-weight cache |
| `AUTOEVAL_TRAINING_TIMEOUT_SECONDS` | `21600` | Maximum time for a job, including its download |
| `HF_TOKEN` | unset | Optional backend-only token for gated model downloads |

No training data is uploaded. The worker downloads base weights from Hugging
Face. It accepts no browser-supplied command or local filesystem path, disables
remote tokenizer code, downloads no Python or pickle files, and does not inherit
application/provider secrets. Model weights use safetensors. The optional MLX
dependency is pinned because the worker uses its programmatic training API.

## Training data and provenance

The initial format is deliberately explicit: the system message is the training
instruction, the user message is `DatasetItem.input` serialized as JSON, and the
assistant message is the reviewed `DatasetItem.expected` serialized as JSON.
Scoring labels become the answer when a dataset contains scoring labels. This
does not replay the agent graph, resolve snapshot references into context, or
train on unreviewed trace predictions. Inspect the sample before training.

Training requires at least two distinct inputs with nonempty expected outputs.
Duplicate inputs with identical answers are removed; conflicting answers are
rejected. A deterministic 10% holdout (at least one example) is reserved for
validation. No input appears in both partitions. Batch size must fit both
partitions. The worker rejects oversized tokenized examples instead of silently
truncating away their supervised answers. Loss is measured on assistant tokens;
validation loss is also measured after the last training step. It is a training
diagnostic, not an independent benchmark score.

Each custom model pins its dataset version, dataset content fingerprint,
instruction, base model/revision request, and training parameters. The exact
resolved base commit is recorded before training and included in the
adapter bundle. Recipes cannot be edited after creation. **Create from this
model** makes a new record, defaulting to the resolved base revision when known.
Names and archive state remain editable. Archiving preserves artifacts and
history; it does not delete files or free disk space.

Jobs run one at a time. Cancellation terminates the worker process group. A
worker exits if its API parent disappears; startup marks interrupted records
failed. Failed/cancelled models require a new record to retry, so old attempts
keep their provenance. The API retains a bounded log tail. Artifacts live outside
SQLite and must be backed up with the database.

## Output

**Download adapter** produces a ZIP containing `adapter/adapters.safetensors`,
`adapter/adapter_config.json`, `manifest.json`, and `result.json`. It excludes
training examples and base weights. Use the adapter with the base model and exact
commit in `result.json` through MLX. Custom models are not automatically registered
as inference providers and do not yet appear in the evaluation model picker.
Serving an adapter and benchmarking it through AutoEval is a separate integration.

## Ownership and future executors

- `api/routes/custom_models.py` translates HTTP requests and domain errors.
- `services/custom_models.py` owns records, admission, lifecycle, and artifacts.
- `training/data.py` owns reproducible dataset preparation, independent of hardware.
- `training/local.py` owns local process execution, readiness, and base suggestions.
- `training/worker.py` owns optional MLX imports, model loading, and LoRA training.
- `app.py` composes the service and local executor. Tests replace the executor
  without GPU dependencies.
- `features/custom-models/` owns the form, list, detail view, and polling.

When adding a CUDA or cloud executor, extract the common executor contract from
the existing `runtime`/`run` boundary and register both implementations in the
composition root. Keep dataset preparation and model records shared; put hardware
capability checks, credentials, dispatch, and cancellation in the executor.
Extend the persisted executor identity and API catalog with the actual second
implementation. There is no placeholder cloud provider or generic job framework.

Validation uses `make verify`, deterministic lifecycle/contract tests with a
controlled executor, and an opt-in real GPU smoke run. The initial real smoke run
trained Qwen 2.5 0.5B for two steps on synthetic examples and exported a working
adapter bundle. This verifies the execution path, not model quality.

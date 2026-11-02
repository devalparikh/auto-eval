"""Isolated MLX process. Fixed entry point; no shell or remote model code."""

import json
import os
import sys
import threading
from pathlib import Path
from types import SimpleNamespace


def watch_parent(parent_pid: int) -> None:
    # A killed/reloaded API must not leave an orphan consuming GPU memory.
    while os.getppid() == parent_pid:
        threading.Event().wait(2)
    os._exit(1)


def train(directory: Path) -> None:
    import mlx.core as mx
    import numpy as np
    from huggingface_hub import snapshot_download
    from mlx_lm.lora import CONFIG_DEFAULTS, train_model
    from mlx_lm.tuner.callbacks import TrainingCallback
    from mlx_lm.tuner.datasets import CacheDataset, load_local_dataset
    from mlx_lm.tuner.trainer import evaluate
    from mlx_lm.utils import load

    if not mx.metal.is_available():
        raise ValueError("MLX training requires an available Apple Metal GPU")
    manifest = json.loads((directory / "manifest.json").read_text())
    config = manifest["training_config"]
    print("Downloading or loading the selected base model from the local cache.", flush=True)
    model_path = snapshot_download(
        repo_id=manifest["base_model"],
        revision=manifest["base_revision"],
        cache_dir=str(directory.parent / "hub"),
        allow_patterns=["*.json", "*.safetensors", "*.model", "*.tiktoken", "*.txt", "*.jinja"],
    )
    revision = Path(model_path).name
    (directory / "resolved.json").write_text(json.dumps({"revision": revision}))
    print(f"Resolved base revision: {revision}", flush=True)
    print("AUTOEVAL_PROGRESS " + json.dumps({"resolved_revision": revision}), flush=True)
    model, tokenizer = load(model_path, tokenizer_config={"trust_remote_code": False})
    args = SimpleNamespace(
        **{
            **CONFIG_DEFAULTS,
            "model": manifest["base_model"],
            "train": True,
            "data": str(directory),
            "adapter_path": str(directory / "adapter"),
            "iters": config["steps"],
            "batch_size": config["batch_size"],
            "learning_rate": config["learning_rate"],
            "max_seq_length": config["max_seq_length"],
            "seed": config["seed"],
            "num_layers": min(16, len(model.layers)),
            "lora_parameters": {"rank": config["lora_rank"], "dropout": 0.0, "scale": 20.0},
            "steps_per_report": 1,
            "steps_per_eval": max(1, min(100, config["steps"])),
            "save_every": config["steps"] + 1,
            "val_batches": -1,
            "mask_prompt": True,
            "grad_checkpoint": True,
        }
    )
    np.random.seed(args.seed)
    train_set, validation_set, _ = load_local_dataset(directory, tokenizer, args)
    # MLX otherwise truncates silently; that can discard the supervised answer.
    for subset in (CacheDataset(train_set), CacheDataset(validation_set)):
        for index in range(len(subset)):
            tokens, offset = subset[index]
            if len(tokens) > args.max_seq_length:
                raise ValueError(
                    "An example exceeds the context limit. Create a new model with "
                    "a larger maximum sequence length or a shorter dataset example."
                )
            if offset >= len(tokens) - 1:
                raise ValueError("An example contains no assistant tokens to train on")

    class Progress(TrainingCallback):
        def on_train_loss_report(self, train_info):
            print(
                "AUTOEVAL_PROGRESS "
                + json.dumps(
                    {
                        "completed_steps": train_info["iteration"],
                        "training_loss": train_info["train_loss"],
                    }
                ),
                flush=True,
            )

        def on_val_loss_report(self, val_info):
            print(
                "AUTOEVAL_PROGRESS "
                + json.dumps(
                    {
                        "validation_loss": val_info["val_loss"],
                    }
                ),
                flush=True,
            )

    train_model(args, model, train_set, validation_set, Progress())
    final_loss = evaluate(
        model=model,
        dataset=CacheDataset(validation_set),
        batch_size=args.batch_size,
        num_batches=-1,
        max_seq_length=args.max_seq_length,
    )
    Progress().on_val_loss_report({"val_loss": final_loss})
    (directory / "result.json").write_text(json.dumps({"revision": revision}))


def main() -> None:
    if sys.argv[1:] == ["--check"]:
        import mlx.core as mx
        from mlx_lm.lora import train_model  # noqa: F401

        if not mx.metal.is_available():
            raise RuntimeError("Apple Metal GPU is unavailable")
        print("MLX_READY")
        return
    directory = Path(sys.argv[1]).resolve()
    parent_pid = int(sys.argv[2])
    threading.Thread(target=watch_parent, args=(parent_pid,), daemon=True).start()
    try:
        train(directory)
    except Exception as error:
        # Never persist provider exception bodies, auth tokens, or arbitrary paths.
        message = (
            str(error)
            if isinstance(error, ValueError)
            else (
                f"Training stopped ({type(error).__name__}). Check model access, "
                "MLX compatibility, available memory, and network connection."
            )
        )
        print(message[:1000], flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

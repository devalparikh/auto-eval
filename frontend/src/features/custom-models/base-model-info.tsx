"use client";

import { InfoTip } from "@/components/info-tip";
import styles from "./custom-models.module.css";

export function BaseModelInfo() {
  return (
    <InfoTip label="Base model requirements" className={styles.modelInfo}>
      Local training requires an MLX-compatible text model with a chat
      template. Custom model compatibility is checked when training starts.
      Weights download on first training; check the model’s license and memory
      requirements.
    </InfoTip>
  );
}

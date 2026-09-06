import styles from "@/features/landing/landing.module.css";

/*
 * Small marks that sit above each workflow step. Each one animates the verb of
 * its step: modules seat into a socket, spans lay down left to right, rows drop
 * into a locked tray, bars grow to their scores. Motion is CSS only and starts
 * from the reveal wrapper's `data-seen` flag, so nothing runs off screen.
 */

const viewBox = "0 0 96 40";

/** Step 01: three modules slide in and seat against the adapter. */
function ConnectMark() {
  return (
    <svg viewBox={viewBox} className={styles.stepMark} aria-hidden="true">
      <path className={styles.markSocket} d="M64 5h12v30H64" />
      <path className={styles.markSocket} d="M76 13h6M76 20h6M76 27h6" />
      {[0, 1, 2].map((row) => (
        <rect
          key={row}
          className={styles.markModule}
          style={{ "--i": row } as React.CSSProperties}
          x={16}
          y={10 + row * 7}
          width={48}
          height={5}
          rx={2}
        />
      ))}
    </svg>
  );
}

/** Step 02: spans lay down left to right, the last one flagged. */
function TraceMark() {
  const spans = [
    { x: 10, w: 22, y: 10 },
    { x: 22, w: 36, y: 18 },
    { x: 44, w: 30, y: 26 },
    { x: 64, w: 24, y: 34 },
  ];
  return (
    <svg viewBox={viewBox} className={styles.stepMark} aria-hidden="true">
      <path className={styles.markAxis} d="M5 5v31h86" />
      {spans.map((span, index) => (
        <rect
          key={span.x}
          className={styles.markSpan}
          data-last={index === spans.length - 1 ? "true" : "false"}
          style={{ "--i": index } as React.CSSProperties}
          x={span.x}
          y={span.y - 4}
          width={span.w}
          height={5}
          rx={2}
        />
      ))}
    </svg>
  );
}

/** Step 03: reviewed rows drop into the tray and it locks. */
function SaveMark() {
  return (
    <svg viewBox={viewBox} className={styles.stepMark} aria-hidden="true">
      <path className={styles.markTray} d="M16 20v14h64V20" />
      {[0, 1, 2].map((row) => (
        <rect
          key={row}
          className={styles.markCase}
          style={{ "--i": row } as React.CSSProperties}
          x={22 + row * 20}
          y={24}
          width={16}
          height={6}
          rx={2}
        />
      ))}
      <g className={styles.markLock}>
        <rect x={43} y={8} width={10} height={8} rx={2} />
        <path d={"M45 8V5.6a3 3 0 0 1 6 0V8"} />
      </g>
    </svg>
  );
}

/** Step 04: candidate bars grow to their scores against a target line. */
function CompareMark() {
  const bars = [
    { x: 10, h: 13 },
    { x: 30, h: 21 },
    { x: 50, h: 28, best: true },
    { x: 70, h: 17 },
  ];
  return (
    <svg viewBox={viewBox} className={styles.stepMark} aria-hidden="true">
      <path className={styles.markAxis} d="M5 36h86" />
      <path className={styles.markTarget} d="M5 11h86" />
      {bars.map((bar, index) => (
        <rect
          key={bar.x}
          className={styles.markBar}
          data-best={bar.best ? "true" : "false"}
          style={{ "--i": index, "--h": `${bar.h}px` } as React.CSSProperties}
          x={bar.x}
          y={36 - bar.h}
          width={16}
          height={bar.h}
          rx={2}
        />
      ))}
    </svg>
  );
}

const marks = [ConnectMark, TraceMark, SaveMark, CompareMark];

export function StepMark({ index }: { index: number }) {
  const Mark = marks[index] ?? marks[0];
  return <Mark />;
}

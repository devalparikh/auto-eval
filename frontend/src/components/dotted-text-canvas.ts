type DottedTextCanvasOptions = {
  canvas: HTMLCanvasElement;
  dotSize: number;
  dotSpacing: number;
  interactionRadius?: number;
  interactionStrength?: number;
  root: HTMLSpanElement;
  text: HTMLSpanElement;
};

type Dot = {
  originX: number;
  originY: number;
  velocityX: number;
  velocityY: number;
  x: number;
  y: number;
};

type Point = { x: number; y: number };

const SPRING_STIFFNESS = 0.16;
const SPRING_DAMPING = 0.72;
const ALPHA_THRESHOLD = 28;

export function attachDottedTextCanvas({
  canvas,
  dotSize,
  dotSpacing,
  interactionRadius,
  interactionStrength,
  root,
  text,
}: DottedTextCanvasOptions) {
  if (
    typeof window.matchMedia !== "function" ||
    !window.matchMedia("(hover: hover) and (pointer: fine)").matches
  ) {
    return;
  }

  const context = canvas.getContext("2d");
  const maskCanvas = document.createElement("canvas");
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });

  if (!context || !maskContext) return;

  const renderContext = context;
  const sampleContext = maskContext;

  let animationFrame: number | null = null;
  let buildFrame: number | null = null;
  let disposed = false;
  let dots: Dot[] = [];
  let resolvedColor = "currentColor";
  let resolvedDotSize = dotSize;
  let radius = interactionRadius ?? 48;
  let strength = interactionStrength ?? 18;
  const pointer = { active: false, x: 0, y: 0 };

  function buildDots() {
    const bounds = root.getBoundingClientRect();
    const value = text.textContent ?? "";

    if (bounds.width < 1 || bounds.height < 1 || !value) {
      delete root.dataset.enhanced;
      return;
    }

    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }

    const computed = window.getComputedStyle(text);
    const fontSize = Number.parseFloat(computed.fontSize) || 16;
    const padding = Math.ceil(Math.max(12, fontSize * 0.28));
    const logicalWidth = Math.ceil(bounds.width + padding * 2);
    const logicalHeight = Math.ceil(bounds.height + padding * 2);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    radius = interactionRadius ?? fontSize * 0.58;
    strength = interactionStrength ?? fontSize * 0.22;
    resolvedDotSize = Math.max(0.5, dotSize);
    resolvedColor = window.getComputedStyle(root).color;

    sizeCanvas(canvas, logicalWidth, logicalHeight, pixelRatio);
    sizeCanvas(maskCanvas, logicalWidth, logicalHeight, pixelRatio);
    canvas.style.left = `${-padding}px`;
    canvas.style.top = `${-padding}px`;

    renderContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    sampleContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    sampleContext.clearRect(0, 0, logicalWidth, logicalHeight);
    sampleContext.fillStyle = "#fff";
    sampleContext.font = canvasFont(computed);
    sampleContext.textAlign = "left";
    sampleContext.textBaseline = "alphabetic";

    if (isCanvasFontKerning(computed.fontKerning)) {
      sampleContext.fontKerning = computed.fontKerning;
    }

    if ("letterSpacing" in sampleContext) {
      sampleContext.letterSpacing = computed.letterSpacing;
    }

    const metrics = sampleContext.measureText(value);
    const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.78;
    const descent = metrics.actualBoundingBoxDescent || fontSize * 0.22;
    const glyphHeight = ascent + descent;
    const baseline = padding + (bounds.height - glyphHeight) / 2 + ascent;
    const scaleX = bounds.width / Math.max(metrics.width, 1);
    const leftBearing = metrics.actualBoundingBoxLeft || 0;

    sampleContext.save();
    sampleContext.translate(padding, 0);
    sampleContext.scale(scaleX, 1);
    sampleContext.fillText(value, leftBearing, baseline);
    sampleContext.restore();

    dots = sampleDots(
      sampleContext,
      maskCanvas,
      logicalWidth,
      logicalHeight,
      Math.max(3, dotSpacing),
      pixelRatio,
    );
    pointer.active = false;

    drawDots();
    root.dataset.enhanced = "true";
  }

  function drawDots() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.width / pixelRatio;
    const height = canvas.height / pixelRatio;

    renderContext.clearRect(0, 0, width, height);
    renderContext.fillStyle = resolvedColor;
    renderContext.beginPath();

    for (const dot of dots) {
      renderContext.moveTo(dot.x + resolvedDotSize, dot.y);
      renderContext.arc(dot.x, dot.y, resolvedDotSize, 0, Math.PI * 2);
    }

    renderContext.fill();
  }

  function animate() {
    let moving = false;

    for (const dot of dots) {
      const target = calculateRepulsionTarget(
        { x: dot.originX, y: dot.originY },
        pointer,
        radius,
        strength,
      );

      dot.velocityX =
        (dot.velocityX + (target.x - dot.x) * SPRING_STIFFNESS) *
        SPRING_DAMPING;
      dot.velocityY =
        (dot.velocityY + (target.y - dot.y) * SPRING_STIFFNESS) *
        SPRING_DAMPING;
      dot.x += dot.velocityX;
      dot.y += dot.velocityY;

      if (
        Math.abs(target.x - dot.x) > 0.04 ||
        Math.abs(target.y - dot.y) > 0.04 ||
        Math.abs(dot.velocityX) > 0.04 ||
        Math.abs(dot.velocityY) > 0.04
      ) {
        moving = true;
      } else {
        dot.x = target.x;
        dot.y = target.y;
        dot.velocityX = 0;
        dot.velocityY = 0;
      }
    }

    drawDots();
    animationFrame = moving ? window.requestAnimationFrame(animate) : null;
  }

  function startAnimation() {
    if (animationFrame === null) {
      animationFrame = window.requestAnimationFrame(animate);
    }
  }

  function handlePointerMove(event: PointerEvent) {
    const bounds = canvas.getBoundingClientRect();
    pointer.active = true;
    pointer.x = event.clientX - bounds.left;
    pointer.y = event.clientY - bounds.top;
    startAnimation();
  }

  function handlePointerLeave() {
    pointer.active = false;
    startAnimation();
  }

  function scheduleBuild() {
    if (buildFrame !== null) return;
    buildFrame = window.requestAnimationFrame(() => {
      buildFrame = null;
      if (!disposed) buildDots();
    });
  }

  canvas.addEventListener("pointerenter", handlePointerMove);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  window.addEventListener("resize", scheduleBuild);

  const resizeObserver = new ResizeObserver(scheduleBuild);
  resizeObserver.observe(root);

  const themeObserver = new MutationObserver(scheduleBuild);
  themeObserver.observe(document.documentElement, {
    attributeFilter: ["data-theme"],
    attributes: true,
  });

  buildDots();
  void document.fonts?.ready.then(() => {
    if (!disposed) scheduleBuild();
  });

  return () => {
    disposed = true;
    delete root.dataset.enhanced;
    canvas.removeEventListener("pointerenter", handlePointerMove);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerleave", handlePointerLeave);
    window.removeEventListener("resize", scheduleBuild);
    resizeObserver.disconnect();
    themeObserver.disconnect();
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    if (buildFrame !== null) window.cancelAnimationFrame(buildFrame);
  };
}

export function calculateRepulsionTarget(
  origin: Point,
  pointer: Point & { active: boolean },
  radius: number,
  strength: number,
): Point {
  if (!pointer.active) return origin;

  const deltaX = origin.x - pointer.x;
  const deltaY = origin.y - pointer.y;
  const distance = Math.hypot(deltaX, deltaY);

  if (distance >= radius || distance === 0) return origin;

  const falloff = 1 - distance / radius;
  const displacement = falloff * falloff * strength;

  return {
    x: origin.x + (deltaX / distance) * displacement,
    y: origin.y + (deltaY / distance) * displacement,
  };
}

function sampleDots(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  spacing: number,
  pixelRatio: number,
) {
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const dots: Dot[] = [];
  const offset = spacing / 2;

  for (let y = offset; y < height; y += spacing) {
    const pixelY = Math.min(canvas.height - 1, Math.floor(y * pixelRatio));

    for (let x = offset; x < width; x += spacing) {
      const pixelX = Math.min(canvas.width - 1, Math.floor(x * pixelRatio));
      const alpha = pixels[(pixelY * canvas.width + pixelX) * 4 + 3];

      if (alpha > ALPHA_THRESHOLD) {
        dots.push({
          originX: x,
          originY: y,
          velocityX: 0,
          velocityY: 0,
          x,
          y,
        });
      }
    }
  }

  return dots;
}

function sizeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  pixelRatio: number,
) {
  canvas.width = Math.max(1, Math.round(width * pixelRatio));
  canvas.height = Math.max(1, Math.round(height * pixelRatio));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

function canvasFont(style: CSSStyleDeclaration) {
  return [
    style.fontStyle,
    style.fontVariant,
    style.fontWeight,
    style.fontSize,
    style.fontFamily,
  ]
    .filter(Boolean)
    .join(" ");
}

function isCanvasFontKerning(value: string): value is CanvasFontKerning {
  return value === "auto" || value === "normal" || value === "none";
}

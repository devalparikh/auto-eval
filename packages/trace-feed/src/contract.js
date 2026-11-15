import { createHash } from "node:crypto";

export const MAX_BYTES = 262144;
const label = /^[a-z][a-z0-9_]{0,47}$/;
const semantic = /^[a-z][a-z0-9_.-]{0,95}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const assert = (condition) => {
  if (!condition) throw new Error("Invalid capture contract");
};
export const isHash = (value) =>
  typeof value === "string" && hashPattern.test(value);
export const isId = (value) =>
  typeof value === "string" && uuidPattern.test(value);
export const isLabel = (value) =>
  typeof value === "string" && label.test(value);
export const timestamp = (value) => Number.isSafeInteger(value) && value >= 0;
export const source = (value) => ["synthetic", "production"].includes(value);
export const status = (value) =>
  ["ok", "error", "partial", "cancelled"].includes(value);
export function object(value, allowed, required = []) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  assert([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const properties = Object.getOwnPropertyDescriptors(value);
  assert(
    Object.keys(properties).every(
      (key) => allowed.includes(key) && Object.hasOwn(properties[key], "value"),
    ),
  );
  assert(required.every((key) => Object.hasOwn(properties, key)));
  return value;
}
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
/** Hash reviewed static prompt/config artifacts locally; sends only the digest. */
export function artifactHash(value) {
  assert(typeof value === "string" && value.length <= 1048576);
  return createHash("sha256").update(value).digest("hex");
}
export const fingerprint = (kind, value) =>
  artifactHash("autoeval:v2:" + kind + ":" + canonical(value));
function mapping(value, max, transform) {
  value ??= {};
  object(value, Object.keys(value));
  assert(Object.keys(value).length <= max && Object.keys(value).every(isLabel));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, transform(item)]),
  );
}
function integer(value, min, max) {
  assert(Number.isSafeInteger(value) && value >= min && value <= max);
  return value;
}
function identity(value, extra) {
  object(
    value,
    ["semanticId", "definitionVersion", ...extra],
    ["semanticId", "definitionVersion"],
  );
  assert(
    typeof value.semanticId === "string" && semantic.test(value.semanticId),
  );
  return {
    semanticId: value.semanticId,
    definitionVersion: integer(value.definitionVersion, 1, 1000000),
  };
}
export function normalizePolicy(input) {
  object(
    input,
    ["schemaVersion", "metrics", "checks", "steps", "outcomes", "content"],
    ["schemaVersion"],
  );
  assert(input.schemaVersion === 2);
  let nodes = 0;
  function schema(spec, depth = 0, operational = false) {
    object(
      spec,
      ["type", "maxLength", "maxItems", "properties", "items", "enum"],
      ["type"],
    );
    assert(
      ++nodes <= 256 &&
        depth <= 4 &&
        ["string", "number", "integer", "boolean", "object", "array"].includes(
          spec.type,
        ),
    );
    assert(
      !operational ||
        (!["object", "array"].includes(spec.type) &&
          (spec.type !== "string" || spec.enum)),
    );
    const enums = spec.enum ?? null;
    assert(
      enums === null ||
        (spec.type === "string" &&
          Array.isArray(enums) &&
          enums.length > 0 &&
          enums.length <= 32 &&
          enums.every(isLabel)),
    );
    const properties = mapping(spec.properties, 32, (child) =>
      schema(child, depth + 1),
    );
    assert(spec.type === "object" || !Object.keys(properties).length);
    assert((spec.type === "array") === (spec.items != null));
    return {
      type: spec.type,
      maxLength: integer(spec.maxLength ?? 1000, 1, 16000),
      maxItems: integer(spec.maxItems ?? 32, 1, 128),
      properties,
      items: spec.items == null ? null : schema(spec.items, depth + 1),
      enum: enums === null ? null : [...enums],
    };
  }
  const event = (definition) => {
    object(definition, ["attributes"]);
    return {
      attributes: mapping(definition.attributes, 16, (item) =>
        schema(item, 0, true),
      ),
    };
  };
  const result = {
    schemaVersion: 2,
    metrics: mapping(input.metrics, 32, (item) => {
      const result = identity(item, ["unit", "min", "max"]);
      assert(isLabel(item.unit));
      const min = item.min ?? null,
        max = item.max ?? null;
      assert(
        (min === null || Number.isSafeInteger(min)) &&
          (max === null || Number.isSafeInteger(max)) &&
          (min === null || max === null || min <= max),
      );
      return { ...result, unit: item.unit, min, max };
    }),
    checks: mapping(input.checks, 32, (item) => {
      const result = identity(item, ["expected"]);
      assert(item.expected === null || typeof item.expected === "boolean");
      return { ...result, expected: item.expected };
    }),
    steps: mapping(input.steps, 32, event),
    outcomes: mapping(input.outcomes, 32, event),
    content: mapping(input.content, 16, (item) => {
      object(item, ["category", "valueSchema"], ["category", "valueSchema"]);
      assert(isLabel(item.category));
      return { category: item.category, valueSchema: schema(item.valueSchema) };
    }),
  };
  for (const section of ["metrics", "checks"]) {
    const ids = Object.values(result[section]).map((item) => item.semanticId);
    assert(new Set(ids).size === ids.length);
  }
  return result;
}
export function normalizeExperiment(value, policyVersion, origin) {
  object(
    value,
    [
      "revision",
      "promptHash",
      "configHash",
      "graphHash",
      "models",
      "mode",
      "datasetHash",
      "runId",
    ],
    ["revision", "promptHash", "configHash", "graphHash", "models"],
  );
  object(value.revision, ["kind", "value"], ["kind", "value"]);
  const revision = { ...value.revision };
  assert(["git-sha1", "git-sha256", "artifact-sha256"].includes(revision.kind));
  assert(
    typeof revision.value === "string" &&
      (revision.kind === "git-sha1" ? /^[0-9a-f]{40}$/ : hashPattern).test(
        revision.value,
      ),
  );
  assert(
    (value.promptHash === null || isHash(value.promptHash)) &&
      isHash(value.configHash) &&
      (value.graphHash === null || isHash(value.graphHash)),
  );
  assert(Array.isArray(value.models) && value.models.length <= 16);
  const models = value.models
    .map((model) => {
      object(
        model,
        ["role", "provider", "model"],
        ["role", "provider", "model"],
      );
      assert(
        isLabel(model.role) &&
          isLabel(model.provider) &&
          typeof model.model === "string" &&
          /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,95}$/.test(model.model),
      );
      return { ...model };
    })
    .sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0));
  assert(new Set(models.map((model) => model.role)).size === models.length);
  const mode = value.mode ?? "observed",
    datasetHash = value.datasetHash ?? null,
    runId = value.runId ?? null;
  assert(["observed", "scripted", "live"].includes(mode));
  assert(
    mode === "observed"
      ? datasetHash === null && runId === null
      : origin === "synthetic" && isHash(datasetHash) && isId(runId),
  );
  return {
    revision,
    promptHash: value.promptHash,
    configHash: value.configHash,
    graphHash: value.graphHash,
    models,
    mode,
    datasetHash,
    runId,
    policyVersion,
    source: origin,
  };
}
export function consent(input, origin) {
  try {
    object(
      input,
      ["granted", "id", "categories", "expiresAt"],
      ["granted", "id"],
    );
    assert(input.granted === true && isId(input.id));
    const categories = input.categories ?? [],
      expiresAt = input.expiresAt ?? null;
    assert(
      Array.isArray(categories) &&
        categories.length <= 32 &&
        categories.every(isLabel),
    );
    assert(
      expiresAt === null || (timestamp(expiresAt) && expiresAt > Date.now()),
    );
    return {
      id: input.id,
      source: origin,
      categories: [...new Set(categories)].sort(),
      expiresAt,
    };
  } catch {
    return null;
  }
}
export function valueValid(
  value,
  spec,
  budget = { nodes: 2048, bytes: 131072 },
) {
  if (--budget.nodes < 0) return false;
  if (value === null) return true;
  if (["number", "integer"].includes(spec.type))
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= Number.MAX_SAFE_INTEGER &&
      (spec.type !== "integer" || Number.isInteger(value))
    );
  if (spec.type === "boolean") return typeof value === "boolean";
  if (spec.type === "string") {
    if (typeof value !== "string" || value.length > spec.maxLength)
      return false;
    const bytes = Buffer.byteLength(value);
    budget.bytes -= bytes;
    return (
      budget.bytes >= 0 &&
      value.isWellFormed() &&
      bytes <= spec.maxLength &&
      (!spec.enum || spec.enum.includes(value))
    );
  }
  if (spec.type === "array")
    return (
      Array.isArray(value) &&
      value.length <= spec.maxItems &&
      value.every((item) => valueValid(item, spec.items, budget))
    );
  try {
    object(value, Object.keys(spec.properties), Object.keys(spec.properties));
    return Object.entries(spec.properties).every(([name, child]) =>
      valueValid(value[name], child, budget),
    );
  } catch {
    return false;
  }
}
export function attributes(value, definition) {
  object(
    value,
    Object.keys(definition.attributes),
    Object.keys(definition.attributes),
  );
  assert(
    Object.entries(definition.attributes).every(([name, spec]) =>
      valueValid(value[name], spec),
    ),
  );
  return JSON.parse(JSON.stringify(value));
}
// A bounded second pass. The app removes names, locations and domain identifiers first.
const identifiers =
  /[\w.+-]{1,64}@[\w.-]{1,253}\.[a-zA-Z]{2,63}|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{16,}|ae_[A-Za-z0-9_-]{32,})|https?:\/\/\S+|\b(?:\+?\d[ ()-]*){10,15}\b/gi;
export function redactIdentifiers(value) {
  if (typeof value === "string")
    return value.replace(identifiers, "[redacted]");
  if (Array.isArray(value)) return value.map(redactIdentifiers);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactIdentifiers(item),
      ]),
    );
  return value;
}

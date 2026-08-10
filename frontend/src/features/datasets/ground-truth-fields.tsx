import {
  ROUTE_OPTIONS,
  SEVERITY_OPTIONS,
  type GroundTruth,
} from "@/features/datasets/ground-truth";
import { Select } from "@/components/select";

export function GroundTruthFields({
  initial,
  idPrefix,
}: {
  initial: GroundTruth;
  idPrefix: string;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id={`${idPrefix}-severity`}
          name="severity"
          label="Severity"
          value={initial.severity}
          options={SEVERITY_OPTIONS}
        />
        <SelectField
          id={`${idPrefix}-route`}
          name="route"
          label="Route"
          value={initial.route}
          options={ROUTE_OPTIONS}
        />
      </div>
      <SelectField
        id={`${idPrefix}-human`}
        name="requiresHuman"
        label="Human review"
        value={String(initial.requires_human)}
        options={["true", "false"]}
        labels={{ true: "Required", false: "Not required" }}
      />
    </>
  );
}

function SelectField({
  id,
  name,
  label,
  value,
  options,
  labels = {},
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: readonly string[];
  labels?: Record<string, string>;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <Select id={id} name={name} defaultValue={value}>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option] ?? option}
          </option>
        ))}
      </Select>
    </div>
  );
}

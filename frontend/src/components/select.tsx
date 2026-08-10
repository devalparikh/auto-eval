"use client";

import { CaretDownIcon } from "@phosphor-icons/react";
import { forwardRef, type SelectHTMLAttributes } from "react";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  containerClassName?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    { className = "", containerClassName = "", disabled, ...props },
    ref,
  ) {
    return (
      <span
        className={`select-control ${containerClassName}`.trim()}
        data-disabled={disabled ? "true" : undefined}
        data-sound="select"
      >
        <select
          ref={ref}
          className={`app-select ${className}`.trim()}
          disabled={disabled}
          {...props}
        />
        <CaretDownIcon
          className="select-control-icon"
          size={13}
          weight="bold"
          aria-hidden="true"
        />
      </span>
    );
  },
);

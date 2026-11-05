import type { SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & { error?: string };

export function Select({ error, className = "", id, children, ...props }: Props) {
  return (
    <>
      <select
        id={id}
        className={`control control-select ${error ? "control-error" : ""} ${className}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={error && id ? `${id}-error` : undefined}
        {...props}
      >
        {children}
      </select>
      {error && id && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </>
  );
}

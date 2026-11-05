import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & { error?: string };

export function Input({ error, className = "", id, ...props }: Props) {
  return (
    <>
      <input
        id={id}
        className={`control ${error ? "control-error" : ""} ${className}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={error && id ? `${id}-error` : undefined}
        {...props}
      />
      {error && id && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </>
  );
}

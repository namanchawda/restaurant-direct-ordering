import type { TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string };

export function Textarea({ error, className = "", id, ...props }: Props) {
  return (
    <>
      <textarea
        id={id}
        className={`control control-textarea ${error ? "control-error" : ""} ${className}`.trim()}
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

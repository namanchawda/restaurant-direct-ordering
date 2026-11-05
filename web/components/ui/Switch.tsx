import type { ButtonHTMLAttributes } from "react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
};

export function Switch({ checked, onCheckedChange, label, disabled, ...props }: Props) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${checked ? "switch-on" : ""} ${props.className || ""}`.trim()}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}

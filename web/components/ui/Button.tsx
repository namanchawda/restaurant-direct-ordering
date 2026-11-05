import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "default" | "small";
};

export function Button({
  variant = "secondary",
  size = "default",
  className = "",
  type = "button",
  ...props
}: Props) {
  return (
    <button
      className={`button button-${variant} button-${size} ${className}`.trim()}
      type={type}
      {...props}
    />
  );
}

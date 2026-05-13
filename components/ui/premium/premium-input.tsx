import type { InputHTMLAttributes } from "react";

type PremiumInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function PremiumInput({
  className = "",
  label,
  ...props
}: PremiumInputProps) {
  return (
    <label className="grid gap-2">
      <span className="premium-label">{label}</span>
      <input
        className={`premium-control ${className}`}
        {...props}
      />
    </label>
  );
}

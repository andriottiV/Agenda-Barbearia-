import type { InputHTMLAttributes } from "react";

type PremiumToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
};

export function PremiumToggle({
  className = "",
  label,
  ...props
}: PremiumToggleProps) {
  return (
    <label className={`inline-flex items-center gap-3 text-sm text-[var(--premium-text-300)] ${className}`}>
      <input className="premium-toggle" type="checkbox" {...props} />
      {label}
    </label>
  );
}

import type { SelectHTMLAttributes } from "react";

type PremiumSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
};

export function PremiumSelect({
  children,
  className = "",
  label,
  ...props
}: PremiumSelectProps) {
  return (
    <label className="grid gap-2">
      <span className="premium-label">{label}</span>
      <select className={`premium-control ${className}`} {...props}>
        {children}
      </select>
    </label>
  );
}

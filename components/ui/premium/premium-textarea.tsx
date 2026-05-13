import type { TextareaHTMLAttributes } from "react";

type PremiumTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
};

export function PremiumTextarea({
  className = "",
  label,
  ...props
}: PremiumTextareaProps) {
  return (
    <label className="grid gap-2">
      <span className="premium-label">{label}</span>
      <textarea className={`premium-control min-h-28 py-3 ${className}`} {...props} />
    </label>
  );
}

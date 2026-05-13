import type { HTMLAttributes, ReactNode } from "react";

type PremiumBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: "gold" | "green" | "red" | "muted";
};

export function PremiumBadge({
  children,
  className = "",
  tone = "gold",
  ...props
}: PremiumBadgeProps) {
  const tones = {
    gold: "border-[rgba(214,176,122,0.32)] bg-[rgba(214,176,122,0.12)] text-[var(--premium-gold-300)]",
    green: "border-emerald-300/25 bg-emerald-400/10 text-emerald-200",
    red: "border-red-300/25 bg-red-500/10 text-red-200",
    muted: "border-white/10 bg-white/[0.045] text-[var(--premium-text-300)]",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

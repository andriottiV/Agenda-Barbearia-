import type { ButtonHTMLAttributes, ReactNode } from "react";

type PremiumButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "ghost";
};

export function PremiumButton({
  children,
  className = "",
  variant = "primary",
  ...props
}: PremiumButtonProps) {
  const variants = {
    primary:
      "border-[var(--premium-border-strong)] bg-[linear-gradient(135deg,var(--premium-gold-300),var(--premium-gold-500))] text-[#080808] shadow-[0_18px_48px_rgba(214,176,122,0.22)] hover:brightness-110 disabled:opacity-55 disabled:hover:brightness-100",
    ghost:
      "border-[var(--premium-border-soft)] bg-white/[0.035] text-[var(--premium-text-300)] hover:border-[var(--premium-border-strong)] hover:bg-white/[0.07] hover:text-[var(--premium-text-100)]",
  };

  return (
    <button
      className={`inline-flex min-h-[3.25rem] items-center justify-center rounded-[var(--premium-radius-md)] border px-5 py-3 text-sm font-black uppercase tracking-[0.08em] transition ${variants[variant]} disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

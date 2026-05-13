import type { HTMLAttributes, ReactNode } from "react";

type PremiumCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function PremiumCard({
  children,
  className = "",
  ...props
}: PremiumCardProps) {
  return (
    <div
      className={`premium-card ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

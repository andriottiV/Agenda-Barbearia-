import type { HTMLAttributes, ReactNode } from "react";

type PremiumListItemProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function PremiumListItem({
  children,
  className = "",
  ...props
}: PremiumListItemProps) {
  return (
    <article className={`premium-list-item ${className}`} {...props}>
      {children}
    </article>
  );
}

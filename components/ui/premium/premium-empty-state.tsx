type PremiumEmptyStateProps = {
  title: string;
  description?: string;
};

export function PremiumEmptyState({ description, title }: PremiumEmptyStateProps) {
  return (
    <div className="premium-empty-state">
      <span className="mx-auto block h-1.5 w-10 rounded-full bg-[var(--premium-gold-400)] opacity-80" />
      <p className="mt-4 text-sm font-semibold text-[var(--premium-text-100)]">
        {title}
      </p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-[var(--premium-text-300)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}

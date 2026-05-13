type PremiumSectionTitleProps = {
  eyebrow?: string;
  title: string;
  description?: string;
};

export function PremiumSectionTitle({
  description,
  eyebrow,
  title,
}: PremiumSectionTitleProps) {
  return (
    <div className="space-y-1.5">
      {eyebrow ? <p className="premium-label text-[var(--premium-gold-300)]">{eyebrow}</p> : null}
      <h2 className="text-xl font-semibold tracking-[-0.01em] text-[var(--premium-text-100)]">
        {title}
      </h2>
      {description ? (
        <p className="text-sm leading-6 text-[var(--premium-text-300)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}

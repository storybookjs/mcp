type BadgeProps = {
  label: string;
  tone?: 'neutral' | 'success' | 'danger';
};

const TONE_COLORS: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: '#475569',
  success: '#15803d',
  danger: '#b91c1c',
};

export default function Badge({ label, tone = 'neutral' }: BadgeProps) {
  return (
    <span data-testid="badge" style={{ color: TONE_COLORS[tone] }}>
      {label}
    </span>
  );
}

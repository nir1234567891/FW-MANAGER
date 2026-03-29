import { clsx } from 'clsx';

type StatusType = 'online' | 'offline' | 'up' | 'down' | 'warning' | 'unknown' | 'enabled' | 'disabled';
type BadgeSize = 'sm' | 'md' | 'lg';

interface StatusBadgeProps {
  status: StatusType;
  size?: BadgeSize;
  label?: string;
  showDot?: boolean;
}

const statusConfig: Record<StatusType, { color: string; bg: string; dot: string; text: string }> = {
  online: { color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/30', dot: 'bg-emerald-400', text: 'Online' },
  offline: { color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/30', dot: 'bg-red-400', text: 'Offline' },
  up: { color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/30', dot: 'bg-emerald-400', text: 'Up' },
  down: { color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/30', dot: 'bg-red-400', text: 'Down' },
  warning: { color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/30', dot: 'bg-amber-400', text: 'Warning' },
  unknown: { color: 'text-slate-400', bg: 'bg-slate-400/10 border-slate-400/30', dot: 'bg-slate-500', text: 'Unknown' },
  enabled: { color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/30', dot: 'bg-emerald-400', text: 'Enabled' },
  disabled: { color: 'text-slate-400', bg: 'bg-slate-400/10 border-slate-400/30', dot: 'bg-slate-500', text: 'Disabled' },
};

const sizeClasses: Record<BadgeSize, { badge: string; dot: string; text: string }> = {
  sm: { badge: 'px-2 py-0.5', dot: 'w-1.5 h-1.5', text: 'text-xs' },
  md: { badge: 'px-2.5 py-1', dot: 'w-2 h-2', text: 'text-xs' },
  lg: { badge: 'px-3 py-1.5', dot: 'w-2.5 h-2.5', text: 'text-sm' },
};

export default function StatusBadge({ status, size = 'md', label, showDot = true }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.unknown;
  const sizes = sizeClasses[size];
  const isPulsing = status === 'online' || status === 'up' || status === 'enabled';

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border font-medium',
        config.bg,
        config.color,
        sizes.badge,
        sizes.text
      )}
    >
      {showDot && (
        <span className="relative flex">
          {isPulsing && (
            <span
              className={clsx('absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping', config.dot)}
            />
          )}
          <span className={clsx('relative inline-flex rounded-full', config.dot, sizes.dot)} />
        </span>
      )}
      {label || config.text}
    </span>
  );
}

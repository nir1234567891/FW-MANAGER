import { clsx } from 'clsx';
import { TrendingUp, TrendingDown, type LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: 'up' | 'down';
  change?: string;
  color?: 'cyan' | 'emerald' | 'red' | 'amber' | 'purple';
  sparkData?: number[];
}

const colorMap = {
  cyan: { icon: 'text-primary-400 bg-primary-400/10', accent: '#22d3ee' },
  emerald: { icon: 'text-emerald-400 bg-emerald-400/10', accent: '#34d399' },
  red: { icon: 'text-red-400 bg-red-400/10', accent: '#f87171' },
  amber: { icon: 'text-amber-400 bg-amber-400/10', accent: '#fbbf24' },
  purple: { icon: 'text-purple-400 bg-purple-400/10', accent: '#a78bfa' },
};

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 32;
  const w = 80;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');

  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

export default function StatCard({ title, value, icon: Icon, trend, change, color = 'cyan', sparkData }: StatCardProps) {
  const colors = colorMap[color];

  return (
    <div className="glass-card-hover p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-slate-400 mb-1">{title}</p>
          <p className="text-2xl font-bold text-slate-100">{value}</p>
          {(trend || change) && (
            <div className="flex items-center gap-1 mt-2">
              {trend === 'up' && <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}
              {trend === 'down' && <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
              {change && (
                <span
                  className={clsx(
                    'text-xs font-medium',
                    trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-slate-400'
                  )}
                >
                  {change}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className={clsx('p-2.5 rounded-lg', colors.icon)}>
            <Icon className="w-5 h-5" />
          </div>
          {sparkData && <MiniSparkline data={sparkData} color={colors.accent} />}
        </div>
      </div>
    </div>
  );
}

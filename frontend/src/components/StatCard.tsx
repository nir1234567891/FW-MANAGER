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
  cyan:    { iconBg: 'bg-cyan-400/10',    iconText: 'text-cyan-400',    accent: '#22d3ee', glow: 'rgba(34,211,238,0.15)',  border: 'rgba(34,211,238,0.25)' },
  emerald: { iconBg: 'bg-emerald-400/10', iconText: 'text-emerald-400', accent: '#34d399', glow: 'rgba(52,211,153,0.15)',  border: 'rgba(52,211,153,0.25)' },
  red:     { iconBg: 'bg-red-400/10',     iconText: 'text-red-400',     accent: '#f87171', glow: 'rgba(248,113,113,0.15)', border: 'rgba(248,113,113,0.25)' },
  amber:   { iconBg: 'bg-amber-400/10',   iconText: 'text-amber-400',   accent: '#fbbf24', glow: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.25)' },
  purple:  { iconBg: 'bg-purple-400/10',  iconText: 'text-purple-400',  accent: '#a78bfa', glow: 'rgba(167,139,250,0.15)', border: 'rgba(167,139,250,0.25)' },
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
    <svg width={w} height={h} className="overflow-visible opacity-60">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

export default function StatCard({ title, value, icon: Icon, trend, change, color = 'cyan', sparkData }: StatCardProps) {
  const c = colorMap[color];

  return (
    <div
      className="relative overflow-hidden rounded-xl transition-all duration-200 group cursor-default"
      style={{
        background: 'linear-gradient(135deg, rgba(30,41,59,0.9) 0%, rgba(15,23,42,0.95) 100%)',
        border: `1px solid rgba(255,255,255,0.07)`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = c.border;
        (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 32px ${c.glow}, 0 1px 4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.07)`;
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)';
        (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Colored accent stripe at top */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, ${c.accent}40, ${c.accent}00)` }}
      />

      {/* Subtle ambient glow in corner */}
      <div
        className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-20 pointer-events-none"
        style={{ background: `radial-gradient(circle, ${c.accent} 0%, transparent 70%)` }}
      />

      <div className="relative p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">{title}</p>
            <p className="text-3xl font-bold text-slate-100 leading-none tabular-nums">{value}</p>
            {(trend || change) && (
              <div className="flex items-center gap-1.5 mt-2.5">
                {trend === 'up' && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
                    <TrendingUp className="w-3 h-3" />
                  </span>
                )}
                {trend === 'down' && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-400/10 text-red-400 border border-red-400/20">
                    <TrendingDown className="w-3 h-3" />
                  </span>
                )}
                {change && (
                  <span className={clsx(
                    'text-xs font-medium',
                    trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-slate-400'
                  )}>
                    {change}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-3 ml-3">
            <div
              className={clsx('p-2.5 rounded-xl', c.iconBg, c.iconText)}
              style={{ boxShadow: `0 0 16px ${c.glow}` }}
            >
              <Icon className="w-5 h-5" />
            </div>
            {sparkData && <MiniSparkline data={sparkData} color={c.accent} />}
          </div>
        </div>
      </div>
    </div>
  );
}

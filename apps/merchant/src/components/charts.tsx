'use client';

import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Single-series charts in the one validated series color (--series-1). Thin marks, 4px rounded data ends, solid
// hairline grid, one label on the extreme or the end, a hover readout on every chart, and a table twin under each,
// so no value is reachable only by hovering. Two measures of different scale get two charts, never two axes.

const tick = { fill: 'var(--muted)', fontSize: 12 };

function fmtWeek(iso: string) {
  return new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function Readout({ value, label, line }: { value: string; label: string; line?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="flex items-center gap-2">
        {line ? <span className="inline-block h-0.5 w-3 rounded bg-series-1" /> : null}
        <span className="text-sm font-semibold text-ink">{value}</span>
      </div>
      <div className="text-muted">{label}</div>
    </div>
  );
}

function Figure({ title, sub, table, children }: { title: string; sub?: string; table: { head: string[]; rows: (string | number)[][] }; children: ReactNode }) {
  return (
    <figure className="space-y-2">
      <figcaption>
        <div className="text-sm font-semibold">{title}</div>
        {sub ? <div className="text-xs text-muted">{sub}</div> : null}
      </figcaption>
      {children}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Show as a table</summary>
        <table className="mt-2 w-full">
          <thead>
            <tr className="text-left text-muted">
              {table.head.map((h) => (
                <th key={h} className="py-1 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {table.rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((c, j) => (
                  <td key={j} className="py-1">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function WeeklyReviews({ data }: { data: { week: string; reviews: number }[] }) {
  const rows = data.map((d) => ({ label: fmtWeek(d.week), reviews: d.reviews }));
  const maxIndex = rows.reduce((best, r, i) => (r.reviews > (rows[best]?.reviews ?? -1) ? i : best), 0);
  return (
    <Figure title="Verified reviews per week" table={{ head: ['Week of', 'Reviews'], rows: rows.map((r) => [r.label, r.reviews]) }}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 22, right: 8, bottom: 0, left: -18 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis allowDecimals={false} tick={tick} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={false}
              content={({ active, payload }) =>
                active && payload?.[0] ? <Readout value={`${payload[0].value} reviews`} label={`week of ${(payload[0].payload as { label: string }).label}`} /> : null
              }
            />
            <Bar dataKey="reviews" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} activeBar={{ fillOpacity: 0.75 }} isAnimationActive={false}>
              <LabelList
                dataKey="reviews"
                content={(p) => {
                  const { x, y, width, value, index } = p as { x: number; y: number; width: number; value: number; index: number };
                  return index === maxIndex ? (
                    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={12} fill="var(--ink)">
                      {value}
                    </text>
                  ) : null;
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Figure>
  );
}

export function RatingTrend({ data }: { data: { week: string; avg_rating: number }[] }) {
  const rows = data.map((d) => ({ label: fmtWeek(d.week), rating: Number(d.avg_rating) }));
  const last = rows.length - 1;
  return (
    <Figure title="Average rating per week" sub="1 to 5 stars, verified buyers only" table={{ head: ['Week of', 'Average'], rows: rows.map((r) => [r.label, r.rating.toFixed(2)]) }}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 22, right: 28, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={tick} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <Readout line value={`${Number(payload[0].value).toFixed(2)} ★`} label={`week of ${(payload[0].payload as { label: string }).label}`} />
                ) : null
              }
            />
            <Line
              type="linear"
              dataKey="rating"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              isAnimationActive={false}
              activeDot={{ r: 5, fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 }}
              dot={(p: { cx?: number; cy?: number; index?: number }) =>
                p.index === last && p.cx !== undefined && p.cy !== undefined ? (
                  <g key="end">
                    <circle cx={p.cx} cy={p.cy} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
                    <text x={p.cx} y={p.cy - 10} textAnchor="middle" fontSize={12} fill="var(--ink)">
                      {rows[last]?.rating.toFixed(1)}
                    </text>
                  </g>
                ) : (
                  <g key={`d${p.index}`} />
                )
              }
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Figure>
  );
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}`;

export function AspectBars({ data }: { data: { aspect: string; avg: number; mentions: number }[] }) {
  const rows = data.map((d) => ({ name: d.aspect.replace(/_/g, ' '), avg: Number(d.avg), mentions: d.mentions }));
  return (
    <Figure
      title="What buyers rate you on"
      sub="Average sentiment per aspect, from −1 (poor) through 0 (mixed) to +1 (good)"
      table={{ head: ['Aspect', 'Average', 'Mentions'], rows: rows.map((r) => [r.name, signed(r.avg), r.mentions]) }}
    >
      <div style={{ height: Math.max(120, rows.length * 34 + 16) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }} barCategoryGap={2}>
            <XAxis type="number" domain={[-1, 1]} hide />
            <ReferenceLine x={0} stroke="var(--line-strong)" />
            <YAxis type="category" dataKey="name" tick={tick} tickLine={false} axisLine={false} width={110} />
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                const r = payload?.[0]?.payload as { name: string; avg: number; mentions: number } | undefined;
                return active && r ? <Readout value={signed(r.avg)} label={`${r.name} · ${r.mentions} mentions`} /> : null;
              }}
            />
            <Bar dataKey="avg" fill="var(--series-1)" radius={4} maxBarSize={18} activeBar={{ fillOpacity: 0.75 }} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.name} fill={r.avg < 0 ? 'var(--bad)' : 'var(--series-1)'} />
              ))}
              <LabelList dataKey="avg" position="right" formatter={(v: unknown) => signed(Number(v))} style={{ fill: 'var(--ink)', fontSize: 12 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Figure>
  );
}

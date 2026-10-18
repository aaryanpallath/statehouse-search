'use client';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ActivityChartProps {
  data: { month: string; actions: number }[];
  title: string;
}

/** Legislative actions per month (from the bill history table). */
export function ActivityChart({ data, title }: ActivityChartProps) {
  return (
    <figure className="card" style={{ margin: 0 }}>
      <figcaption className="muted">{title}</figcaption>
      <div className="chart-card">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" fontSize={11} />
            <YAxis allowDecimals={false} fontSize={11} />
            <Tooltip />
            <Bar dataKey="actions" fill="var(--color-accent)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

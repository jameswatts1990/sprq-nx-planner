import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { chartPalette } from "./palette";
import styles from "./charts.module.css";

const HEIGHT = 240;

/** A named chart block: title + optional legend/subtitle, then the plot (or an empty
 * state). Keeps every chart on the page visually consistent. */
export function ChartBlock({
  title,
  subtitle,
  children,
  isEmpty,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  isEmpty?: boolean;
}) {
  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <h3>{title}</h3>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>
      {isEmpty ? <div className={styles.empty}>No data in this range yet.</div> : children}
    </div>
  );
}

function tooltipProps() {
  const p = chartPalette();
  return {
    contentStyle: {
      background: p.card,
      border: `1px solid ${p.line}`,
      borderRadius: 9,
      fontSize: 12,
      boxShadow: "0 6px 20px rgba(20,20,30,0.08)",
    },
    labelStyle: { color: p.ink, fontWeight: 700 },
    itemStyle: { color: p.ink },
    cursor: { fill: "rgba(0,0,0,0.04)" },
  };
}

const axisTick = () => {
  const p = chartPalette();
  return { fill: p.grey, fontSize: 11 };
};

function fmtWeek(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Vertical bars over weeks - a single magnitude-over-time series. */
export function TimeBar<T extends object>({
  data,
  valueKey,
  name,
  color,
}: {
  data: T[];
  valueKey: string;
  name: string;
  color: string;
}) {
  const p = chartPalette();
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={p.line} vertical={false} />
        <XAxis dataKey="week" tickFormatter={fmtWeek} tick={axisTick()} tickLine={false} axisLine={{ stroke: p.line }} />
        <YAxis allowDecimals={false} tick={axisTick()} tickLine={false} axisLine={false} width={36} />
        <Tooltip {...tooltipProps()} labelFormatter={(l) => fmtWeek(String(l))} />
        <Bar dataKey={valueKey} name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** A single value-over-time line, optionally as a percentage (0-100 domain). */
export function TimeLine<T extends object>({
  data,
  valueKey,
  name,
  color,
  percent,
}: {
  data: T[];
  valueKey: string;
  name: string;
  color: string;
  percent?: boolean;
}) {
  const p = chartPalette();
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={p.line} vertical={false} />
        <XAxis dataKey="week" tickFormatter={fmtWeek} tick={axisTick()} tickLine={false} axisLine={{ stroke: p.line }} />
        <YAxis
          allowDecimals={!percent}
          domain={percent ? [0, 100] : undefined}
          tickFormatter={percent ? (t) => `${t}%` : undefined}
          tick={axisTick()}
          tickLine={false}
          axisLine={false}
          width={percent ? 48 : 40}
        />
        <Tooltip
          {...tooltipProps()}
          labelFormatter={(l) => fmtWeek(String(l))}
          formatter={(val) => [percent ? `${val}%` : val, name]}
        />
        <Line type="monotone" dataKey={valueKey} name={name} stroke={color} strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal category bars (per-instrument, sample funnel, reuse depth, credit funnel).
 * `colorFor` colours each bar individually; omit for a single-hue chart. */
export function CategoryBars<T extends object>({
  data,
  categoryKey,
  valueKey,
  color,
  colorFor,
  height,
}: {
  data: T[];
  categoryKey: string;
  valueKey: string;
  color: string;
  colorFor?: (entry: T) => string;
  height?: number;
}) {
  const p = chartPalette();
  return (
    <ResponsiveContainer width="100%" height={height ?? HEIGHT}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={p.line} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={axisTick()} tickLine={false} axisLine={{ stroke: p.line }} />
        <YAxis
          type="category"
          dataKey={categoryKey}
          tick={axisTick()}
          tickLine={false}
          axisLine={false}
          width={104}
        />
        <Tooltip {...tooltipProps()} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey={valueKey} fill={color} radius={[0, 4, 4, 0]} maxBarSize={30}>
          {colorFor && data.map((entry, i) => <Cell key={i} fill={colorFor(entry)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut for a small set of identity slices (movie-hours mix, cell status). Always paired
 * with a legend so identity is never colour-alone. */
export function Donut<T extends object>({
  data,
  nameKey,
  valueKey,
  colors,
}: {
  data: T[];
  nameKey: string;
  valueKey: string;
  colors: string[];
}) {
  const p = chartPalette();
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius={52}
          outerRadius={82}
          paddingAngle={2}
          stroke={p.card}
          strokeWidth={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip {...tooltipProps()} />
        <Legend
          verticalAlign="middle"
          align="right"
          layout="vertical"
          iconType="circle"
          wrapperStyle={{ fontSize: 12, color: p.ink }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

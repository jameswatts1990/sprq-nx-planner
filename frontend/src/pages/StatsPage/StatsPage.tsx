import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import { instrumentsApi } from "@/api/instruments";
import { statsApi } from "@/api/stats";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { StatTile, StatTiles } from "@/components/shared/StatTile";
import { Card, CardBody } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { StatsResponse } from "@/types/stats";

import { CategoryBars, ChartBlock, Donut, TimeBar, TimeLine } from "./charts/primitives";
import { cellStatusColor, chartPalette, outcomeColor, useDepthColor } from "./charts/palette";
import styles from "./StatsPage.module.css";

type RangeKey = "30" | "90" | "all";

const RANGE_OPTIONS = [
  { value: "30" as const, label: "30 days" },
  { value: "90" as const, label: "90 days" },
  { value: "all" as const, label: "All time" },
];

function rangeFrom(range: RangeKey): string | undefined {
  if (range === "all") return undefined;
  const d = new Date();
  d.setDate(d.getDate() - Number(range));
  return d.toISOString().slice(0, 10);
}

function prettyStatus(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

export function StatsPage() {
  const [range, setRange] = useState<RangeKey>("90");
  const [instrumentSerial, setInstrumentSerial] = useState("");

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });

  const dateFrom = rangeFrom(range);
  const query = useQuery({
    queryKey: ["stats", { dateFrom, instrumentSerial }],
    queryFn: () => statsApi.get({ date_from: dateFrom, instrument_serial: instrumentSerial || undefined }),
  });

  return (
    <div className={styles.page}>
      <Card>
        <CardBody>
          <div className={styles.toolbar}>
            <SegmentedControl
              ariaLabel="Time range"
              options={RANGE_OPTIONS}
              value={range}
              onChange={(v) => setRange(v)}
            />
            <select
              className={styles.select}
              value={instrumentSerial}
              onChange={(e) => setInstrumentSerial(e.target.value)}
            >
              <option value="">All instruments</option>
              {(instrumentsQuery.data ?? []).map((i) => (
                <option key={i.id} value={i.serial_number}>
                  {i.serial_number}
                </option>
              ))}
            </select>
            <span className={styles.rangeNote}>
              Trends cover the selected range; cell, sample &amp; credit totals show current state.
            </span>
          </div>

          {query.isLoading && <div className={styles.status}>Loading stats…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {query.error instanceof ApiError ? query.error.message : "Failed to load stats."}
            </Note>
          )}
          {query.data && <Headline data={query.data} />}
        </CardBody>
      </Card>

      {query.data && <StatsCharts data={query.data} />}
    </div>
  );
}

function Headline({ data }: { data: StatsResponse }) {
  const h = data.headline;
  return (
    <StatTiles>
      <StatTile label="Runs completed" value={h.runs_completed} />
      <StatTile label="Samples completed" value={h.samples_completed} />
      <StatTile label="Avg uses / cell" value={h.avg_uses_per_cell.toFixed(2)} hint="of 3 max" />
      <StatTile label="Reaching Use 3" value={`${h.pct_reaching_use3}%`} />
      <StatTile label="Failure rate" value={`${h.failure_rate}%`} />
      <StatTile label="Well fill" value={`${h.well_fill_pct}%`} hint="of 8 wells/run" />
      <StatTile label="Awaiting credit" value={h.cells_awaiting_credit} />
      <StatTile label="Credits received" value={h.credits_received} />
    </StatTiles>
  );
}

function StatsCharts({ data }: { data: StatsResponse }) {
  const p = chartPalette();
  const useColors = useDepthColor(p);
  const statusColors = cellStatusColor(p);
  const outColors = outcomeColor(p);

  const t = data.throughput;
  const r = data.reuse;
  const f = data.failures;
  const inv = data.inventory;

  const movieMix = useMemo(
    () => t.movie_hours_mix.map((m) => ({ label: `${m.movie_hours} h`, count: m.count })),
    [t.movie_hours_mix],
  );
  const perInstrument = useMemo(() => t.per_instrument.map((i) => ({ ...i, runs: i.runs })), [t.per_instrument]);
  const depth = useMemo(
    () => r.depth_distribution.map((d) => ({ label: `Use ${d.uses}`, cells: d.cells })),
    [r.depth_distribution],
  );
  const wellFill = useMemo(
    () => r.well_fill.map((w) => ({ week: w.week, pct: w.capacity ? Math.round((100 * w.filled) / w.capacity) : 0 })),
    [r.well_fill],
  );
  const failTrend = useMemo(
    () =>
      f.failure_rate_trend.map((x) => ({ week: x.week, pct: x.total ? Math.round((100 * x.failed) / x.total) : 0 })),
    [f.failure_rate_trend],
  );
  const outcomes = useMemo(
    () => f.outcomes.map((o) => ({ ...o, label: prettyStatus(o.status) })),
    [f.outcomes],
  );
  const funnel = useMemo(
    () => [
      { label: "Needs report", count: f.credit_funnel.needs_report, color: p.amber },
      { label: "Reported", count: f.credit_funnel.reported, color: p.blue },
      { label: "Awaiting credit", count: f.credit_funnel.awaiting, color: p.orange },
      { label: "Received", count: f.credit_funnel.received, color: p.green },
    ],
    [f.credit_funnel, p],
  );
  const waste = useMemo(
    () => [
      { label: "All 3 uses", count: r.window_waste.full_3_uses, color: p.green },
      { label: "Expired early", count: r.window_waste.expired_early, color: p.red },
    ],
    [r.window_waste, p],
  );
  const cellStatus = useMemo(
    () => inv.cell_status.map((c) => ({ label: prettyStatus(c.status), count: c.count, status: c.status })),
    [inv.cell_status],
  );
  const sampleFunnel = useMemo(
    () => inv.sample_funnel.map((s) => ({ ...s, label: prettyStatus(s.status) })),
    [inv.sample_funnel],
  );

  return (
    <>
      <Card>
        <CardBody>
          <SectionHeading title="Throughput & run rate" />
          <div className={styles.grid}>
            <ChartBlock title="Samples per week" subtitle="loaded cell-uses" isEmpty={!t.series.length}>
              <TimeBar data={t.series} valueKey="samples" name="Samples" color={p.magenta} />
            </ChartBlock>
            <ChartBlock title="Runs per week" isEmpty={!t.series.length}>
              <TimeLine data={t.series} valueKey="runs" name="Runs" color={p.blue} />
            </ChartBlock>
            <ChartBlock title="Runs per instrument" isEmpty={!perInstrument.some((i) => i.runs)}>
              <CategoryBars data={perInstrument} categoryKey="serial" valueKey="runs" color={p.blue} />
            </ChartBlock>
            <ChartBlock title="Movie-hours mix" isEmpty={!movieMix.length}>
              <Donut data={movieMix} nameKey="label" valueKey="count" colors={[p.magenta, p.blue, p.teal, p.purple]} />
            </ChartBlock>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <SectionHeading title="Reuse & utilisation" />
          <div className={styles.grid}>
            <ChartBlock
              title="Reuse depth"
              subtitle="how far cells got through their 3 uses"
              isEmpty={!depth.some((d) => d.cells)}
            >
              <CategoryBars
                data={depth}
                categoryKey="label"
                valueKey="cells"
                color={p.magenta}
                colorFor={(e) => useColors[Number(String(e.label).replace("Use ", "")) - 1] ?? p.magenta}
              />
            </ChartBlock>
            <ChartBlock title="Window outcome" subtitle="108h window" isEmpty={!waste.some((w) => w.count)}>
              <CategoryBars data={waste} categoryKey="label" valueKey="count" color={p.green} colorFor={(e) => String(e.color)} />
            </ChartBlock>
            <ChartBlock title="Avg uses per cell" isEmpty={!r.avg_uses_trend.length}>
              <TimeLine data={r.avg_uses_trend} valueKey="avg_uses" name="Avg uses" color={p.teal} />
            </ChartBlock>
            <ChartBlock title="Well fill %" subtitle="wells used of 8/run" isEmpty={!wellFill.length}>
              <TimeLine data={wellFill} valueKey="pct" name="Well fill" color={p.blue} percent />
            </ChartBlock>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <SectionHeading title="Failures & credits" />
          <div className={styles.grid}>
            <ChartBlock title="Run outcomes" subtitle="cell-uses with a verdict" isEmpty={!outcomes.some((o) => o.count)}>
              <CategoryBars
                data={outcomes}
                categoryKey="label"
                valueKey="count"
                color={p.green}
                colorFor={(e) => outColors[String(e.status)] ?? p.grey}
                height={180}
              />
            </ChartBlock>
            <ChartBlock title="Failure rate %" isEmpty={!failTrend.length}>
              <TimeLine data={failTrend} valueKey="pct" name="Failure rate" color={p.red} percent />
            </ChartBlock>
            <ChartBlock
              title="PacBio credit funnel"
              subtitle="current outstanding"
              isEmpty={!funnel.some((s) => s.count)}
            >
              <CategoryBars data={funnel} categoryKey="label" valueKey="count" color={p.blue} colorFor={(e) => String(e.color)} />
            </ChartBlock>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <SectionHeading title="Inventory & backlog" />
          <div className={styles.grid}>
            <ChartBlock title="Cells by status" subtitle="all cells now" isEmpty={!cellStatus.some((c) => c.count)}>
              <Donut
                data={cellStatus}
                nameKey="label"
                valueKey="count"
                colors={cellStatus.map((c) => statusColors[c.status] ?? p.grey)}
              />
            </ChartBlock>
            <ChartBlock title="Samples by status" isEmpty={!sampleFunnel.some((s) => s.count)}>
              <CategoryBars data={sampleFunnel} categoryKey="label" valueKey="count" color={p.purple} />
            </ChartBlock>
            <ChartBlock title="Samples imported per week" isEmpty={!inv.import_volume.length}>
              <TimeBar data={inv.import_volume} valueKey="imported" name="Imported" color={p.teal} />
            </ChartBlock>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { errorMessage } from "@/api/client";
import { instrumentsApi } from "@/api/instruments";
import { statsApi } from "@/api/stats";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { StatTile, StatTiles } from "@/components/shared/StatTile";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { PageHeader } from "@/components/ui/PageHeader";
import type { GroupBy, StatsResponse } from "@/types/stats";
import { formatDateTime } from "@/utils/calendarDates";
import { downloadCsv } from "@/utils/toCsv";

import { CategoryBars, ChartBlock, Donut, TimeBar, TimeLine } from "./charts/primitives";
import { cellStatusColor, chartPalette, outcomeColor, useDepthColor } from "./charts/palette";
import {
  GROUP_BY_OPTIONS,
  RANGE_PRESETS,
  rangeLabel,
  readStatsView,
  resolveRange,
  statsCsv,
  statsCsvFilename,
  writeStatsView,
  type RangePreset,
  type StatsView,
} from "./statsView";
import styles from "./StatsPage.module.css";

const PERIOD_NOUN: Record<GroupBy, string> = { week: "week", month: "month", quarter: "quarter" };

function prettyStatus(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

export function StatsPage() {
  const [params, setParams] = useSearchParams();
  const view = readStatsView(params);
  const update = (patch: Partial<StatsView>) => setParams((prev) => writeStatsView(prev, patch), { replace: true });
  const range = resolveRange(view);

  const instrumentsQuery = useQuery({
    queryKey: ["instruments", true],
    queryFn: () => instrumentsApi.list(true),
  });

  const query = useQuery({
    queryKey: ["stats", { from: range.from, to: range.to, instrument: view.instrument, group: view.group }],
    queryFn: () =>
      statsApi.get({
        date_from: range.from,
        date_to: range.to,
        instrument_serial: view.instrument || undefined,
        group_by: view.group,
      }),
  });

  const instrument = (instrumentsQuery.data ?? []).find((i) => i.serial_number === view.instrument);
  const instrumentLabel = !view.instrument
    ? "All instruments"
    : instrument?.name
      ? `${instrument.name} (${view.instrument})`
      : `Revio ${view.instrument}`;

  function exportCsv() {
    if (query.data) downloadCsv(statsCsvFilename(range, view), statsCsv(query.data));
  }

  return (
    <div className={styles.page}>
      <PageHeader
        help="stats"
        title="Stats"
        intro="Read-only charts and headline numbers built from everything else in the app."
        actions={
          <>
            <Button onClick={exportCsv} disabled={!query.data} title="Download this report's figures, one row per period">
              Export CSV
            </Button>
            <Button onClick={() => window.print()} disabled={!query.data} title="Print this report on A4 (portrait)">
              Print
            </Button>
          </>
        }
      />
      <Card>
        <CardBody>
          <div className={styles.toolbar}>
            <select
              aria-label="Time range"
              value={view.range}
              onChange={(e) => {
                const next = e.target.value as RangePreset;
                // A custom range starts from the one on screen, so it can be nudged rather than typed afresh.
                update(next === "custom" ? { range: next, from: range.from ?? "", to: range.to ?? "" } : { range: next, from: "", to: "" });
              }}
            >
              {RANGE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {view.range === "custom" && (
              <span className={styles.customRange}>
                <input
                  type="date"
                  aria-label="From"
                  value={view.from}
                  max={view.to || undefined}
                  onChange={(e) => update({ from: e.target.value })}
                />
                to
                <input
                  type="date"
                  aria-label="To"
                  value={view.to}
                  min={view.from || undefined}
                  onChange={(e) => update({ to: e.target.value })}
                />
              </span>
            )}
            <select aria-label="Group by" value={view.group} onChange={(e) => update({ group: e.target.value as GroupBy })}>
              {GROUP_BY_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            <select aria-label="Instrument" value={view.instrument} onChange={(e) => update({ instrument: e.target.value })}>
              <option value="">All instruments</option>
              {(instrumentsQuery.data ?? []).map((i) => (
                <option key={i.id} value={i.serial_number}>
                  {i.name ? `${i.name} (${i.serial_number})` : i.serial_number}
                </option>
              ))}
            </select>
          </div>
          <p className={styles.reportLine}>
            <b>{rangeLabel(range)}</b> · by {PERIOD_NOUN[view.group]} · {instrumentLabel}
            <span className={styles.printOnly}> · printed {formatDateTime(new Date().toISOString())}</span>
            <span className={styles.scopeNote}>
              Trends cover this range (runs by load date); cell, sample &amp; credit totals show current state.
            </span>
          </p>

          {query.isLoading && <div className="status">Loading stats…</div>}
          {query.isError && (
            <Note tone="bad" icon="!">
              {errorMessage(query.error, "Couldn't load the stats.")}
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
      <StatTile
        label="Runs completed"
        value={h.runs_completed}
        hint="through analysis"
        title="Runs loaded in this range whose last cell has finished sequencing and analysis. A two-plate run counts once."
      />
      <StatTile
        label="Samples sequenced"
        value={h.samples_sequenced}
        hint="on completed runs"
        title="Wells on completed runs that weren't marked Failed or Aborted."
      />
      <StatTile
        label="Planned runs"
        value={h.planned_runs}
        hint="not yet loaded"
        title="Runs in this range still waiting for Confirm loaded - not counted in any other figure."
      />
      <StatTile label="Avg uses / cell" value={h.avg_uses_per_cell.toFixed(2)} hint="of 3 max · SPRQ-Nx only" />
      <StatTile label="Reaching Use 3" value={`${h.pct_reaching_use3}%`} />
      <StatTile label="Failure rate" value={`${h.failure_rate}%`} hint="of wells loaded" />
      <StatTile
        label="Plate fill"
        value={`${h.plate_fill_pct}%`}
        hint="of 4 wells per plate"
        title="Wells used out of 4 per plate loaded (a one-plate run holds 4, a two-plate run 8)."
      />
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
  const group = data.group_by;
  const per = PERIOD_NOUN[group];

  const t = data.throughput;
  const r = data.reuse;
  const f = data.failures;
  const inv = data.inventory;

  const movieMix = useMemo(
    () => t.movie_hours_mix.map((m) => ({ label: `${m.movie_hours} h`, count: m.count })),
    [t.movie_hours_mix],
  );
  const depth = useMemo(
    () => r.depth_distribution.map((d) => ({ label: `Use ${d.uses}`, cells: d.cells })),
    [r.depth_distribution],
  );
  const plateFill = useMemo(
    () =>
      r.plate_fill.map((w) => ({ period: w.period, pct: w.capacity ? Math.round((100 * w.filled) / w.capacity) : 0 })),
    [r.plate_fill],
  );
  const failTrend = useMemo(
    () =>
      f.failure_rate_trend.map((x) => ({ period: x.period, pct: x.total ? Math.round((100 * x.failed) / x.total) : 0 })),
    [f.failure_rate_trend],
  );
  const outcomes = useMemo(
    () => f.outcomes.map((o) => ({ ...o, label: prettyStatus(o.status) })),
    [f.outcomes],
  );
  const funnel = useMemo(
    () => [
      { label: "Needs report", count: f.credit_funnel.needs_report, color: p.red },
      { label: "Reported", count: f.credit_funnel.reported, color: p.blue },
      { label: "Awaiting credit", count: f.credit_funnel.awaiting, color: p.amber },
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
      <Card className={styles.section}>
        <CardBody>
          <SectionHeading title="Throughput & run rate" />
          <div className={styles.grid}>
            <ChartBlock
              title={`Samples sequenced per ${per}`}
              subtitle="wells on completed runs"
              isEmpty={!t.series.some((s) => s.samples_sequenced)}
            >
              <TimeBar data={t.series} valueKey="samples_sequenced" name="Samples sequenced" color={p.magenta} group={group} />
            </ChartBlock>
            <ChartBlock title={`Runs completed per ${per}`} isEmpty={!t.series.some((s) => s.runs_completed)}>
              <TimeLine data={t.series} valueKey="runs_completed" name="Runs completed" color={p.blue} group={group} />
            </ChartBlock>
            <ChartBlock title="Runs completed per instrument" isEmpty={!t.per_instrument.some((i) => i.runs_completed)}>
              <CategoryBars data={t.per_instrument} categoryKey="serial" valueKey="runs_completed" color={p.blue} />
            </ChartBlock>
            <ChartBlock title="Movie-time mix" subtitle="wells loaded" isEmpty={!movieMix.length}>
              <Donut data={movieMix} nameKey="label" valueKey="count" colors={[p.magenta, p.blue, p.teal, p.purple]} />
            </ChartBlock>
          </div>
        </CardBody>
      </Card>

      <Card className={styles.section}>
        <CardBody>
          <SectionHeading title="Reuse & utilisation" />
          <div className={styles.grid}>
            <ChartBlock
              title="Reuse depth"
              subtitle="how far SPRQ-Nx cells got through their 3 uses (single-use SPRQ cells aren't counted)"
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
              <TimeLine data={r.avg_uses_trend} valueKey="avg_uses" name="Avg uses" color={p.teal} group={group} />
            </ChartBlock>
            <ChartBlock title="Plate fill %" subtitle="wells used of 4 per plate loaded" isEmpty={!plateFill.length}>
              <TimeLine data={plateFill} valueKey="pct" name="Plate fill" color={p.blue} group={group} percent />
            </ChartBlock>
          </div>
        </CardBody>
      </Card>

      <Card className={styles.section}>
        <CardBody>
          <SectionHeading title="Failures & credits" />
          <div className={styles.grid}>
            <ChartBlock title="Run outcomes" subtitle="wells on loaded runs" isEmpty={!outcomes.some((o) => o.count)}>
              <CategoryBars
                data={outcomes}
                categoryKey="label"
                valueKey="count"
                color={p.green}
                colorFor={(e) => outColors[String(e.status)] ?? p.grey}
                height={180}
              />
            </ChartBlock>
            <ChartBlock title="Failure rate %" subtitle="failed of wells loaded" isEmpty={!failTrend.length}>
              <TimeLine data={failTrend} valueKey="pct" name="Failure rate" color={p.red} group={group} percent />
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

      <Card className={styles.section}>
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
            <ChartBlock title={`Samples imported per ${per}`} isEmpty={!inv.import_volume.length}>
              <TimeBar data={inv.import_volume} valueKey="imported" name="Imported" color={p.teal} group={group} />
            </ChartBlock>
          </div>
        </CardBody>
      </Card>

      <Card className={styles.section}>
        <CardBody>
          <SectionHeading title="Instrument availability" />
          <AvailabilityTable rows={data.availability} />
        </CardBody>
      </Card>
    </>
  );
}

/** Weekdays each instrument was up vs in a downtime period, over the range up to today
 * (stats_service._availability). Planned and unplanned are split so a service-heavy month reads
 * differently from a month of breakdowns. */
function AvailabilityTable({ rows }: { rows: StatsResponse["availability"] }) {
  if (rows.length === 0) return <div className="status">No instruments.</div>;
  return (
    <>
      <p className={styles.tableNote}>Weekdays in the range up to today — runs only load Monday to Friday.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th className={styles.num}>Weekdays</th>
            <th className={styles.num}>Planned down</th>
            <th className={styles.num}>Unplanned down</th>
            <th className={styles.num}>Uptime</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.serial}>
              <td>{a.name ? `${a.name} (${a.serial})` : `Revio ${a.serial}`}</td>
              <td className={styles.num}>{a.weekdays}</td>
              <td className={styles.num}>{a.planned_down}</td>
              <td className={styles.num}>{a.unplanned_down}</td>
              <td className={styles.num}>{a.weekdays ? `${a.uptime_pct}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

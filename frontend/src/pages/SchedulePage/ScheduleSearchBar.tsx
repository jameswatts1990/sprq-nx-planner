import type { KeyboardEvent } from "react";

import { Button } from "@/components/ui/Button";
import type { ScheduleSearch } from "./useScheduleSearch";

import styles from "./ScheduleSearchBar.module.css";

/**
 * The Schedule toolbar's unified search box (right of Export schedule): one field that both
 * filters the Backlog tray and finds every placement of a sample or run across the whole
 * schedule. Works like a browser's find bar - type to search, then Enter (or ›) to cycle to
 * the next appearance and Shift+Enter (or ‹) for the previous, jumping the week view to
 * wherever the match sits. Esc clears.
 */
export function ScheduleSearchBar({ search }: { search: ScheduleSearch }) {
  const { query, setQuery, searchActive, count, activeIndex, next, prev, clear, activeMatch } = search;

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query) clear();
      else e.currentTarget.blur();
    }
  }

  // Position "i / N" once the user has cycled to a match; a plain count before that; nothing
  // until a search is active.
  const counter = !searchActive
    ? null
    : count === 0
      ? "No matches"
      : activeIndex < 0
        ? `${count} match${count === 1 ? "" : "es"}`
        : `${activeIndex + 1} / ${count}`;

  return (
    <div className={styles.wrap} role="search">
      <span className={styles.icon} aria-hidden="true">
        ⌕
      </span>
      <input
        type="search"
        className={styles.input}
        placeholder="Find sample or run ID…"
        aria-label="Find a sample or run ID across the backlog and the whole schedule"
        title="Find a sample or run ID — searches the backlog and every week of the schedule. Enter cycles to the next appearance, Shift+Enter the previous."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {counter && (
        <span
          className={count === 0 ? `${styles.counter} ${styles.counterEmpty}` : styles.counter}
          title={activeMatch ? activeMatch.label : undefined}
          aria-live="polite"
        >
          {counter}
        </span>
      )}
      {searchActive && (
        <div className={styles.nav}>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            onClick={prev}
            disabled={count === 0}
          >
            ‹
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next match"
            title="Next match (Enter)"
            onClick={next}
            disabled={count === 0}
          >
            ›
          </Button>
          <Button size="sm" variant="ghost" aria-label="Clear search" title="Clear search (Esc)" onClick={clear}>
            ✕
          </Button>
        </div>
      )}
    </div>
  );
}

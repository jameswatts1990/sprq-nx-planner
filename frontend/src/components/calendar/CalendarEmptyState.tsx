import styles from "./CalendarEmptyState.module.css";

export interface CalendarEmptyStateProps {
  message?: string;
}

export function CalendarEmptyState({ message = "Add samples to the backlog and pick a run design to see a schedule preview." }: CalendarEmptyStateProps) {
  return (
    <div className={styles.calScroll}>
      <div className={styles.emptyState}>
        <div className={styles.icon}>🗓️</div>
        <h3>No schedule yet</h3>
        <div>{message}</div>
      </div>
    </div>
  );
}

import { Button } from "@/components/ui/Button";

import styles from "./Pagination.module.css";

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  return (
    <div className={styles.pagination}>
      <Button size="sm" variant="ghost" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>
        Previous
      </Button>
      <span className={styles.pageInfo}>
        Page {page} of {totalPages}
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
      >
        Next
      </Button>
    </div>
  );
}

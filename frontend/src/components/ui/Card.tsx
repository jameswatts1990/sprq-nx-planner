import type { ReactNode } from "react";

import styles from "./Card.module.css";

export interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return <section className={className ? `${styles.card} ${className}` : styles.card}>{children}</section>;
}

export interface CardHeaderProps {
  /** Usually an <h2>title</h2>, matching the prototype's .card-head markup. */
  children: ReactNode;
  /** Right-aligned badge/action slot, ports the prototype's .badge. */
  badge?: ReactNode;
}

export function CardHeader({ children, badge }: CardHeaderProps) {
  return (
    <div className={styles.head}>
      {children}
      {badge !== undefined && <span className={styles.badge}>{badge}</span>}
    </div>
  );
}

export interface CardBodyProps {
  children: ReactNode;
  className?: string;
}

export function CardBody({ children, className }: CardBodyProps) {
  return <div className={className ? `${styles.body} ${className}` : styles.body}>{children}</div>;
}

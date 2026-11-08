import {
  ArrowUpRightIcon,
  InfoIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./docs.module.css";

/**
 * One h2 and its content. The id and title must match an entry in the page's
 * `sections`, which is what the table of contents and search list.
 */
export function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h2 id={id} className={styles.heading}>
        {title}
        <a
          href={`#${id}`}
          className={styles.anchor}
          aria-label={`Link to ${title}`}
        >
          #
        </a>
      </h2>
      {children}
    </section>
  );
}

/** A rule or consequence worth stopping for. The tone colors the icon only. */
export function Callout({
  tone = "note",
  children,
}: {
  tone?: "note" | "warning";
  children: ReactNode;
}) {
  const Mark = tone === "warning" ? WarningIcon : InfoIcon;
  return (
    <div className={styles.callout} data-tone={tone} role="note">
      <Mark size={15} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className={styles.steps}>{children}</ol>;
}

/** A borderless table: hairlines between rows, mono headers. */
export function DocTable({
  head,
  children,
}: {
  head: [string, string];
  children: ReactNode;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{head[0]}</th>
            <th>{head[1]}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** One row of a two-column table: the thing, then what it means. */
export function DocRow({
  term,
  children,
}: {
  term: ReactNode;
  children: ReactNode;
}) {
  return (
    <tr>
      <td>{term}</td>
      <td>{children}</td>
    </tr>
  );
}

export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={styles.external}>
      {children}
      <ArrowUpRightIcon size={11} weight="bold" aria-hidden="true" />
    </a>
  );
}

export function DocCards({
  items,
}: {
  items: { href: string; title: string; description: string; icon: Icon }[];
}) {
  return (
    <div className={styles.cards}>
      {items.map(({ href, title, description, icon: Mark }) => (
        <Link key={href} href={href} className={`${styles.card} lift`}>
          <Mark size={17} aria-hidden="true" />
          <strong>{title}</strong>
          <span>{description}</span>
        </Link>
      ))}
    </div>
  );
}

export function DocActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

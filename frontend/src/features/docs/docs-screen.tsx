import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { docsContent } from "./content";
import { docsNeighbors, type DocsPage } from "./docs-pages";
import { DocsToc } from "./docs-toc";
import styles from "./docs.module.css";

/**
 * One docs page: a reading column with the page's sections on a rail beside
 * it. The sidebar carries the list of pages (see `components/sidebar-nav.ts`).
 */
export function DocsScreen({ page }: { page: DocsPage }) {
  const Content = docsContent[page.slug];
  const { previous, next } = docsNeighbors(page);

  return (
    <div className={styles.docs}>
      <div className={styles.layout}>
        <article className={styles.article}>
          <header className={styles.header}>
            <p className={styles.eyebrow}>{page.group}</p>
            <h1>{page.title}</h1>
            <p className={styles.lead}>{page.description}</p>
          </header>
          <Content />
          <nav className={styles.pager} aria-label="More docs">
            {previous ? (
              <Link
                href={previous.href}
                className={styles.pagerLink}
                data-direction="previous"
              >
                <span>
                  <ArrowLeftIcon size={11} aria-hidden="true" />
                  Previous
                </span>
                <strong>{previous.title}</strong>
              </Link>
            ) : null}
            {next ? (
              <Link
                href={next.href}
                className={styles.pagerLink}
                data-direction="next"
              >
                <span>
                  Next
                  <ArrowRightIcon size={11} aria-hidden="true" />
                </span>
                <strong>{next.title}</strong>
              </Link>
            ) : null}
          </nav>
        </article>
        <DocsToc sections={page.sections} />
      </div>
    </div>
  );
}

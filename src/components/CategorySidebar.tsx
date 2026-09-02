"use client";

// The category sidebar: departments, expandable to their shelves, with counts.
//
// THREE THINGS ARE DELIBERATE AND SHOULD NOT BE "TIDIED":
//
// 1. A DEPARTMENT AND A SHELF LOOK DIFFERENT. A department is a heading you open; a shelf is a
//    place you land. Rendering them the same invites a shopper to click a department expecting
//    products and decide the section is broken when it only expands.
//
// 2. "ALTELE" IS NOT A CATEGORY AND MUST NOT LOOK LIKE ONE. It is the remainder of its
//    department — everything a merchant filed under the department without naming a shelf.
//    Styled as an aside, always last, so it reads as "the rest of this" rather than as a shelf
//    with an odd name.
//
// 3. "NECATEGORISATE" IS A GAP, SHOWN ON PURPOSE. 3,260 products carry no category and were
//    reachable only by search. Hiding them behind search means the tail never shrinks, because
//    nobody — including us — ever sees it. It sits at the bottom, visibly outside the tree.
//
// The counts come from `getCategoryNav`, which uses the same filter the listing pages use, so
// the number on a row equals the number of products the row opens onto.

import { useEffect, useState } from "react";
import type { CategoryNav } from "@/lib/category-nav";

const fmt = (n: number) => n.toLocaleString("ro-RO");

export function CategorySidebar({
  nav,
  activeSlug,
  uncategorisedHref = "/necategorisate",
}: {
  nav: CategoryNav;
  activeSlug?: string;
  uncategorisedHref?: string;
}) {
  // The department containing the active shelf starts open; everything else starts closed, so
  // the sidebar opens at a readable length instead of a 79-row wall.
  const activeDept = nav.departments.find(
    (d) => d.slug === activeSlug || d.leaves.some((l) => l.slug === activeSlug),
  );
  const [open, setOpen] = useState<Set<string>>(() => new Set(activeDept ? [activeDept.slug] : []));
  const [drawer, setDrawer] = useState(false);

  // Close the drawer on Escape. A drawer that can only be dismissed by hitting a small × is a
  // trap on a phone.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const toggle = (slug: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });

  const tree = (
    <nav className="cat-nav" aria-label="Categorii">
      <p className="cat-nav__total">
        {fmt(nav.total)} produse cu preț azi
      </p>

      <ul className="cat-nav__depts">
        {nav.departments.map((d) => {
          const isOpen = open.has(d.slug);
          const shelves = d.leaves.filter((l) => !l.isRemainder);
          const remainder = d.leaves.filter((l) => l.isRemainder);
          return (
            <li key={d.slug} className="cat-nav__dept">
              <button
                type="button"
                className="cat-nav__deptbtn"
                aria-expanded={isOpen}
                onClick={() => toggle(d.slug)}
              >
                <span className="cat-nav__chev" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                <span className="cat-nav__deptname">
                  {d.icon ? <span aria-hidden="true">{d.icon} </span> : null}
                  {d.name}
                </span>
                <span className="cat-nav__count">{fmt(d.count)}</span>
              </button>

              {isOpen && (
                <ul className="cat-nav__leaves">
                  {shelves.map((l) => (
                    <li key={l.slug}>
                      <a
                        className={`cat-nav__leaf${l.slug === activeSlug ? " is-active" : ""}`}
                        href={`/c/${l.slug}`}
                        aria-current={l.slug === activeSlug ? "page" : undefined}
                      >
                        <span className="cat-nav__leafname">{l.name}</span>
                        <span className="cat-nav__count">{fmt(l.count)}</span>
                      </a>
                    </li>
                  ))}
                  {remainder.map((l) => (
                    <li key={l.slug}>
                      <a
                        className={`cat-nav__leaf cat-nav__leaf--rest${l.slug === activeSlug ? " is-active" : ""}`}
                        href={`/c/${l.slug}`}
                        aria-current={l.slug === activeSlug ? "page" : undefined}
                        title="Produse pe care magazinul le-a pus în acest raion, fără să spună pe ce raft"
                      >
                        <span className="cat-nav__leafname">Restul din {d.name}</span>
                        <span className="cat-nav__count">{fmt(l.count)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {nav.uncategorised > 0 && (
        <div className="cat-nav__uncat">
          <a href={uncategorisedHref} className={activeSlug === "necategorisate" ? "is-active" : undefined}>
            <span>Necategorisate</span>
            <span className="cat-nav__count">{fmt(nav.uncategorised)}</span>
          </a>
          <p>
            Produse fără categorie — încă nu le-am putut încadra. Le poți răsfoi, dar nu apar
            în arborele de mai sus.
          </p>
        </div>
      )}
    </nav>
  );

  return (
    <>
      {/* Under 900px the sidebar becomes a drawer; this button is its only entry point. */}
      <button type="button" className="cat-nav__open" onClick={() => setDrawer(true)} aria-expanded={drawer}>
        ☰ Categorii
      </button>

      <aside className="cat-nav__rail">{tree}</aside>

      {drawer && (
        <div className="cat-nav__scrim" role="dialog" aria-modal="true" aria-label="Categorii">
          <button type="button" className="cat-nav__backdrop" aria-label="Închide" onClick={() => setDrawer(false)} />
          <div className="cat-nav__panel">
            <button type="button" className="cat-nav__close" onClick={() => setDrawer(false)}>✕ Închide</button>
            {tree}
          </div>
        </div>
      )}
    </>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { highlightMatch, searchLaws } from '@/lib/search';
import { LAW_TYPE_LABELS, LAW_TYPES } from '@/lib/shared/contract';
import { useAtlas } from '@/lib/store';
import styles from './chrome.module.css';

export function SearchBar({ onPick }: { onPick: (index: number) => void }) {
  const data = useAtlas((s) => s.data);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const open = useAtlas((s) => s.searchOpen);
  const setUi = useAtlas((s) => s.setUi);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => (data && q ? searchLaws(data.laws, q) : []), [data, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        inputRef.current?.focus();
        setUi({ searchOpen: true });
      }
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        setUi({ searchOpen: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setUi]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  if (!data) return null;
  const cats = data.manifest.categories;

  return (
    <div className={styles.searchWrap}>
      <div className={styles.search}>
        <input
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && hits.length > 0}
          aria-controls="search-list"
          aria-activedescendant={hits[active] ? `search-opt-${hits[active]!.index}` : undefined}
          aria-label="法令を探す"
          placeholder="法令名・略称・読み・法令番号で探す"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setUi({ searchOpen: true });
          }}
          onFocus={() => setUi({ searchOpen: true })}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(hits.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && hits[active]) {
              e.preventDefault();
              onPick(hits[active]!.index);
              setQ('');
              setUi({ searchOpen: false });
            }
          }}
        />
        <span className={styles.kbd} aria-hidden>/</span>
      </div>
      {open && hits.length > 0 && (
        <div className={styles.list} role="listbox" id="search-list">
          {hits.map((h, i) => {
            const title = data.laws.title[h.index]!;
            const hl = highlightMatch(title, q);
            const cat = cats[data.laws.category[h.index]!]!;
            const type = LAW_TYPE_LABELS[LAW_TYPES[data.laws.type[h.index]!]!];
            return (
              <button
                key={h.index}
                id={`search-opt-${h.index}`}
                role="option"
                aria-selected={i === active}
                className={`${styles.option} pressable`}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onPick(h.index);
                  setQ('');
                  setUi({ searchOpen: false });
                }}
              >
                <span className={styles.dot} style={{ background: `rgb(${cat.color.join(',')})` }} />
                <span>
                  <span>
                    {hl ? (
                      <>
                        {hl.before}
                        <span className={styles.strong}>{hl.hit}</span>
                        {hl.after}
                      </>
                    ) : title}
                  </span>
                  <div className={styles.meta}>
                    {type} · {data.laws.num[h.index]}
                  </div>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

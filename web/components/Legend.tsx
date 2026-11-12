'use client';

import { useState } from 'react';
import { REF_KIND_LABELS, REF_KINDS } from '@/lib/shared/contract';
import { KIND_HEX } from '@/lib/colors';
import { useAtlas } from '@/lib/store';
import { GROUP_DEFS } from '@/lib/categories';
import styles from './chrome.module.css';

export function Legend({ onFocus }: { onFocus: (kind: 'group' | 'category', id: number) => void }) {
  const data = useAtlas((s) => s.data);
  const color = useAtlas((s) => s.color);
  const focus = useAtlas((s) => s.focus);
  const legendOpen = useAtlas((s) => s.legendOpen);
  const setUi = useAtlas((s) => s.setUi);
  const [drawer, setDrawer] = useState(false);
  if (!data) return null;

  const toggle = (kind: 'group' | 'category', id: number) => {
    const cur = focus;
    if (cur && cur.kind === kind && cur.id === id) onFocus(kind, -1);
    else onFocus(kind, id);
  };

  return (
    <>
      <button
        className={`${styles.iconBtn} ${styles.legendToggle} pressable`}
        aria-label="凡例"
        data-legend-toggle
        data-open={drawer}
        onClick={() => setDrawer(true)}
      >
        凡例
      </button>
      <div className={styles.legend} data-open={drawer}>
        <button
          className={`${styles.row} ${styles.legendClose} pressable`}
          style={{ color: 'var(--text-muted)' }}
          onClick={() => setDrawer(false)}
        >
          閉じる
        </button>
        <div className={styles.legendTitle}>{color === 'kind' ? '参照の種類' : '分野のまとまり'}</div>
        {color === 'kind' ? (
          REF_KINDS.map((k) => (
            <div key={k} className={styles.row}>
              <span className={styles.dot} style={{ background: KIND_HEX[k] }} />
              {REF_KIND_LABELS[k]}
            </div>
          ))
        ) : (
          <>
            <button
              className={`${styles.row} pressable`}
              style={{ color: 'var(--text-muted)' }}
              onClick={() => setUi({ legendOpen: !legendOpen })}
            >
              {legendOpen ? '分野を隠す' : '分野を表示'}
            </button>
            {GROUP_DEFS.map((g) => {
              const hue = data.manifest.groups[g.id]?.hue ?? g.hue;
              return (
                <div key={g.id}>
                  <button
                    className={`${styles.row} pressable`}
                    aria-pressed={focus?.kind === 'group' && focus.id === g.id}
                    onClick={() => toggle('group', g.id)}
                  >
                    <span className={styles.dot} style={{ background: `oklch(0.74 0.13 ${hue})` }} />
                    {g.name}
                  </button>
                  {legendOpen && g.categories.map((name) => {
                    const cat = data.manifest.categories.find((c) => c.name === name);
                    if (!cat) return null;
                    return (
                      <button
                        key={cat.id}
                        className={`${styles.row} pressable`}
                        style={{ paddingLeft: 18 }}
                        aria-pressed={focus?.kind === 'category' && focus.id === cat.id}
                        onClick={() => toggle('category', cat.id)}
                      >
                        <span className={styles.dot} style={{ background: `rgb(${cat.color.join(',')})` }} />
                        {cat.name}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

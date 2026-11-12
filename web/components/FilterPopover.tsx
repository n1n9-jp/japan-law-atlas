'use client';

import { Popover } from '@base-ui/react/popover';
import { LAW_TYPE_LABELS, LAW_TYPES, REF_KIND_LABELS, REF_KINDS } from '@/lib/shared/contract';
import { DEFAULT_KINDS, DEFAULT_TYPES, type PartsFilter } from '@/lib/url-state';
import { useAtlas } from '@/lib/store';
import styles from './chrome.module.css';

export function FilterPopover({ visibleCount }: { visibleCount: number }) {
  const kinds = useAtlas((s) => s.kinds);
  const parts = useAtlas((s) => s.parts);
  const types = useAtlas((s) => s.types);
  const minRefs = useAtlas((s) => s.minRefs);
  const hideIntraFamily = useAtlas((s) => s.hideIntraFamily);
  const setFilter = useAtlas((s) => s.setFilter);

  const toggle = (list: number[], id: number, all: number[]) => {
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    return next.length ? next : all.slice(0, 1);
  };

  return (
    <Popover.Root>
      <Popover.Trigger className={`${styles.iconBtn} pressable`} aria-label="フィルタ">
        フィルタ
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup className={styles.popup}>
            <Popover.Title className={styles.field}>参照の種類</Popover.Title>
            <div className={styles.checks}>
              {REF_KINDS.map((k, i) => (
                <label key={k} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={kinds.includes(i)}
                    onChange={() => setFilter({ kinds: toggle(kinds, i, DEFAULT_KINDS) })}
                  />
                  {REF_KIND_LABELS[k]}
                </label>
              ))}
            </div>
            <span className={styles.field}>部</span>
            {(['main', 'suppl', 'all'] as PartsFilter[]).map((p) => (
              <label key={p} className={styles.check}>
                <input
                  type="radio"
                  name="parts"
                  checked={parts === p}
                  onChange={() => setFilter({ parts: p })}
                />
                {p === 'main' ? '本則のみ' : p === 'suppl' ? '附則のみ' : 'すべて'}
              </label>
            ))}
            <span className={styles.field}>法令種別</span>
            <div className={styles.checks}>
              {LAW_TYPES.map((t, i) => (
                <label key={t} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={types.includes(i)}
                    onChange={() => setFilter({ types: toggle(types, i, DEFAULT_TYPES) })}
                  />
                  {LAW_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
            <label className={styles.field} htmlFor="min-refs">
              最小の言及数 {minRefs}
            </label>
            <input
              id="min-refs"
              type="range"
              min={1}
              max={20}
              value={minRefs}
              aria-label="最小の言及数"
              onChange={(e) => setFilter({ minRefs: Number(e.target.value) })}
            />
            <label className={styles.check} style={{ marginTop: 10 }}>
              <input
                type="checkbox"
                checked={hideIntraFamily}
                onChange={(e) => setFilter({ hideIntraFamily: e.target.checked })}
              />
              同じファミリーの中の参照を隠す
            </label>
            <p className={styles.meta} style={{ marginTop: 12 }}>
              表示中のエッジ {visibleCount.toLocaleString('ja-JP')} 本
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

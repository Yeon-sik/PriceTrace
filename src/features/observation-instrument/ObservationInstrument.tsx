"use client";

import { useId, useMemo, useState } from "react";
import type { ProductGroup } from "@/domain/product-browser";
import { formatKrw } from "@/domain/settlement";
import { Icon } from "@/components/Icon";
import { chronologicalObservations, observationDate } from "./observation-selector";
import { useObservationMotion } from "./use-observation-motion";
import styles from "./observation-instrument.module.css";

export function ObservationInstrument({ group, onOpen }: { group: ProductGroup; onOpen: () => void }) {
  const records = useMemo(() => chronologicalObservations(group), [group]);
  const [index, setIndex] = useState(records.length - 1);
  const record = records[index];
  const rangeId = useId();
  const surfaceRef = useObservationMotion();
  if (!record) return null;

  // All records remain selectable. At most twelve markers keep the spatial view legible.
  const markerIndexes = records.length <= 12 ? records.map((_, i) => i) : Array.from({ length: 12 }, (_, i) => Math.round(i * (records.length - 1) / 11));
  return <figure className={styles.instrument} aria-label={`${group.productName} 관측 기록`}>
    <figcaption className={styles.instrumentHeading}><span><i />실제 영수증 관측</span><span>{String(index + 1).padStart(2, "0")} / {String(records.length).padStart(2, "0")}</span></figcaption>
    <div className={styles.spatialSurface} ref={surfaceRef} data-testid="observation-instrument" data-motion-active="false">
      <div className={styles.geometry} aria-hidden="true">
        <svg viewBox="0 0 560 350" fill="none">
          <ellipse cx="280" cy="178" rx="244" ry="110" transform="rotate(-21 280 178)" className={styles.orbit} />
          <ellipse cx="280" cy="178" rx="197" ry="80" transform="rotate(-21 280 178)" className={styles.innerOrbit} />
          <path d="M280 18v48m0 229v38M24 178h42m428 0h42" className={styles.axis} />
          {markerIndexes.map((recordIndex, position) => {
            const angle = position / markerIndexes.length * Math.PI * 2 - Math.PI / 3;
            const x = 280 + Math.cos(angle) * 231;
            const y = 178 + Math.sin(angle) * 118;
            return <g key={records[recordIndex].id} className={recordIndex === index ? styles.selectedMarker : styles.marker}>
              <path d={`M280 178L${x} ${y}`} />
              <circle cx={x} cy={y} r={recordIndex === index ? 6 : 3} />
              <text x={x} y={y < 178 ? y - 16 : y + 23} textAnchor="middle">{observationDate(records[recordIndex].observedAt).slice(5)}</text>
            </g>;
          })}
        </svg>
      </div>
      <div className={styles.readout}>
        <Icon name="product" size={28} />
        <span className={styles.readoutName}>{group.productName}</span>
        <strong data-testid="instrument-price">{formatKrw(record.item.unitPriceKrw)}</strong>
        <span className={styles.readoutDate}>{observationDate(record.observedAt)} 관측가</span>
      </div>
    </div>
    <div className={styles.instrumentSource}><Icon name="store" size={16} /><span>{record.storeLabel}</span><button type="button" onClick={onOpen} aria-label={`${group.productName} 전체 가격 기록`}>기록 보기<Icon name="external" size={16} /></button></div>
    <div className={styles.timeline}>
      <div><label htmlFor={rangeId}>관측 시점 선택</label><output htmlFor={rangeId} aria-live="polite">{observationDate(record.observedAt)} · {index + 1}번째 기록</output></div>
      <input id={rangeId} type="range" min={0} max={records.length - 1} value={index} disabled={records.length < 2} aria-valuetext={`${observationDate(record.observedAt)}, ${formatKrw(record.item.unitPriceKrw)}, ${index + 1}번째 기록`} onChange={(event) => setIndex(Number(event.target.value))} />
      <div className={styles.timelineEnds}><span>{observationDate(records[0].observedAt)}</span><span>{observationDate(records[records.length - 1].observedAt)}</span></div>
    </div>
  </figure>;
}

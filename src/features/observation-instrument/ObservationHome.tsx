"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import type { ProductGroup } from "@/domain/product-browser";
import { formatKrw } from "@/domain/settlement";
import { ObservationInstrument } from "./ObservationInstrument";
import { observationDate, observationOverview, selectInstrumentGroups } from "./observation-selector";
import styles from "./observation-instrument.module.css";

type Props = {
  groups: ProductGroup[];
  receiptCount: number;
  cart: { count: number; quantity: number; total: number };
  onProducts: () => void;
  onRestaurants: () => void;
  onMarkets: () => void;
  onCart: () => void;
  onTrend: (group: ProductGroup) => void;
};

export function ObservationHome({ groups, receiptCount, cart, onProducts, onRestaurants, onMarkets, onCart, onTrend }: Props) {
  const subjects = useMemo(() => selectInstrumentGroups(groups), [groups]);
  const overview = useMemo(() => observationOverview(groups), [groups]);
  const [subjectId, setSubjectId] = useState(subjects[0]?.id);
  const subject = subjects.find((group) => group.id === subjectId) ?? subjects[0];

  return <div className={styles.home}>
    <section className={styles.hero} aria-labelledby="observation-heading">
      <div className={styles.introduction}>
        <h1 id="observation-heading">가격의 순간을,<br /><span>선명하게.</span></h1>
        <p>같은 상품, 다른 판매처, 서로 다른 시점.<br />출처가 분명한 관측 기록으로 비교하세요.</p>
        <div className={styles.heroActions}><button type="button" onClick={onProducts}>상품 둘러보기<Icon name="arrow" /></button><button type="button" onClick={onRestaurants}>음식점 둘러보기<Icon name="arrow" size={17} /></button></div>
        <div className={styles.heroFootnote}><span className={styles.traceMark} aria-hidden="true" /><span>현재가를 추측하지 않습니다.<br />기록된 가격과 그 근거를 보여드립니다.</span></div>
      </div>
      <div className={styles.instrumentArea}>
        {subject ? <>
          <ObservationInstrument key={subject.id} group={subject} onOpen={() => onTrend(subject)} />
          <label className={styles.subjectSelect}>관측 상품<select aria-label="관측 상품 선택" value={subject.id} onChange={(event) => setSubjectId(event.target.value)}>{subjects.map((group) => <option key={group.id} value={group.id}>{group.productName}</option>)}</select></label>
        </> : <div className={styles.noObservations}><Icon name="receipt" size={38} /><p>공개 관측 기록을 준비하고 있습니다.</p><button type="button" onClick={onProducts}>상품 목록 확인<Icon name="arrow" /></button></div>}
      </div>
    </section>

    <dl className={styles.evidenceStrip} aria-label="공개 영수증 기록 현황">
      <div><dt>공개 가격 관측</dt><dd>{overview.observations.toLocaleString("ko-KR")}<small>건</small></dd></div>
      <div><dt>출처 영수증</dt><dd>{receiptCount.toLocaleString("ko-KR")}<small>건</small></dd></div>
      <div><dt>기록된 판매처</dt><dd>{overview.sellers.toLocaleString("ko-KR")}<small>곳</small></dd></div>
      <div><dt>최근 관측일</dt><dd className={styles.dateValue}>{overview.latestDate ? observationDate(overview.latestDate) : "기록 없음"}</dd></div>
    </dl>

    <section className={styles.workspace} aria-label="기록 탐색">
      <div className={styles.recent}>
        <div className={styles.sectionHeading}><div><h2>기록에서 시작하는 비교</h2><p>공개 영수증에서 최근에 관측된 상품입니다.</p></div><button type="button" onClick={onProducts}>전체 상품<Icon name="arrow" size={18} /></button></div>
        <div className={styles.recordHead} aria-hidden="true"><span>상품 / 판매처</span><span>관측일</span><span>관측 단가</span></div>
        <ol className={styles.recordList}>{overview.recent.map((group, i) => <li key={group.id}><button type="button" onClick={() => onTrend(group)} aria-label={`${group.productName} 가격 기록 보기`}><span className={styles.recordIndex}>{String(i + 1).padStart(2, "0")}</span><span className={styles.recordProduct}><strong>{group.productName}</strong><small>{group.latest.storeLabel}</small></span><span className={styles.recordDate}>{observationDate(group.latest.observedAt)}</span><span className={styles.recordPrice}>{formatKrw(group.latest.item.unitPriceKrw)}<Icon name="external" size={17} /></span></button></li>)}</ol>
      </div>
      <aside className={styles.explore} aria-label="더 탐색하기">
        <h2>비교의 다음 단계</h2>
        <button type="button" className={styles.exploreLink} onClick={onRestaurants}><Icon name="restaurant" size={25} /><span><strong>음식점과 메뉴</strong><small>지점별 관측가 · 영양성분</small></span><Icon name="arrow" size={18} /></button>
        <button type="button" className={styles.exploreLink} onClick={onMarkets}><Icon name="store" size={25} /><span><strong>판매처의 기록</strong><small>영수증 · 출처 · 관측 이력</small></span><Icon name="arrow" size={18} /></button>
        <div className={styles.cartSummary}><div><Icon name="cart" size={20} /><h3>나의 장바구니</h3><span>{cart.quantity}</span></div>{cart.count > 0 ? <p>{cart.count}개 상품 · 예상 합계 <strong>{formatKrw(cart.total)}</strong></p> : <p>비교할 상품을 모아 예상 합계를 확인하세요.</p>}<button type="button" onClick={onCart}>장바구니 보기<Icon name="arrow" size={17} /></button></div>
      </aside>
    </section>
    <p className={styles.sourceNote}><Icon name="receipt" size={16} />관측가는 해당 시점의 구매 기록이며, 현재 판매가나 재고를 보장하지 않습니다.</p>
  </div>;
}

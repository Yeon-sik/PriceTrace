"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import {
  filterAndSortOfficialChannelListings,
  type OfficialChannelListingSort,
  type PublicOfficialChannelCatalog,
  type PublicOfficialChannelListing,
} from "@/domain/public-official-channel-catalog";
import { formatKrw } from "@/domain/settlement";
import styles from "./page.module.css";

const PAGE_SIZE = 48;

function formatObservedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function PxOfficialImage({ listing }: { listing: PublicOfficialChannelListing }) {
  const [failed, setFailed] = useState(false);
  if (!listing.image || failed) {
    return <span className={styles.officialChannelImageFallback} aria-label={`${listing.sourceNameRaw} 이미지 없음`}>이미지 없음</span>;
  }

  return <img
    src={listing.image.url}
    alt={`${listing.sourceNameRaw} PX 공식 사이트 상품 이미지`}
    loading="lazy"
    decoding="async"
    onError={() => setFailed(true)}
  />;
}

export function PxOfficialProductBrowser({
  catalog,
  query,
}: {
  catalog: PublicOfficialChannelCatalog;
  query: string;
}) {
  const [sort, setSort] = useState<OfficialChannelListingSort>("price-asc");
  const [page, setPage] = useState(1);
  const listings = useMemo(
    () => filterAndSortOfficialChannelListings(catalog.listings, query, sort),
    [catalog.listings, query, sort],
  );
  const pageCount = Math.max(1, Math.ceil(listings.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleListings = listings.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => setPage(1), [query, sort]);

  return <section aria-label="PX 공식 판매상품">
    <div className={styles.officialChannelScope}>
      <div>
        <p className={styles.kicker}>OFFICIAL CHANNEL COLLECTION</p>
        <h2>{catalog.channel.name} · {catalog.collection.name}</h2>
        <p>공식 사이트 전체상품 컬렉션 {catalog.collection.listingCount.toLocaleString("ko-KR")}개를 표시합니다.</p>
      </div>
      <dl>
        <div><dt>수집 범위</dt><dd>마트 판매상품 컬렉션</dd></div>
        <div><dt>수집 상태</dt><dd>{catalog.collection.completeness === "full" ? "전체 페이지 수집 완료" : "부분 수집"}</dd></div>
        <div><dt>기준 시각</dt><dd>{formatObservedAt(catalog.sourceSnapshot.capturedAt)}</dd></div>
      </dl>
    </div>

    <div className={styles.officialChannelNotice} role="note">
      {catalog.notices.map((notice) => <p key={notice}>{notice}</p>)}
    </div>

    <div className={styles.officialChannelToolbar}>
      <p>검색 결과 <strong>{listings.length.toLocaleString("ko-KR")}개</strong></p>
      <label>정렬
        <select value={sort} onChange={(event) => setSort(event.target.value as OfficialChannelListingSort)}>
          <option value="price-asc">표시가 낮은 순</option>
          <option value="price-desc">표시가 높은 순</option>
          <option value="name">상품명 순</option>
        </select>
      </label>
    </div>

    <div className={styles.productGrid} aria-live="polite">
      {visibleListings.map((listing) => <article className={`${styles.productCard} ${styles.officialChannelCard}`} key={listing.id}>
        <div className={styles.productVisual}>
          <PxOfficialImage listing={listing} />
          <span className={styles.officialChannelBadge}>PX 공식 등재</span>
        </div>
        <div className={`${styles.productInfo} ${styles.officialChannelInfo}`}>
          <h2>{listing.sourceNameRaw}</h2>
          <p><b>업체명 원문</b> {listing.vendorNameRaw ?? "미표시"}</p>
          <p><b>규격 원문</b> {listing.specificationTextRaw ?? "미표시"}</p>
          <div className={styles.officialChannelPrice}>
            <small>공식 사이트 표시가</small>
            <strong>{formatKrw(listing.officialPrice.amountKrw)}</strong>
          </div>
          <div className={styles.officialChannelMeta}>
            <span>상품코드 {listing.sourceProductCode}</span>
            <span>{formatObservedAt(listing.officialPrice.observedAt)} 관측</span>
          </div>
          <span className={styles.standardLinkStatus}>표준 상품 연결 전</span>
        </div>
      </article>)}
    </div>

    {listings.length === 0 && <div className={styles.noResult}><strong>원문 필드에서 일치하는 PX 공식 판매상품이 없습니다.</strong></div>}

    {listings.length > 0 && <nav className={styles.officialChannelPagination} aria-label="PX 공식 판매상품 페이지">
      <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>이전</button>
      <span>{currentPage.toLocaleString("ko-KR")} / {pageCount.toLocaleString("ko-KR")}</span>
      <button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>다음</button>
    </nav>}
  </section>;
}

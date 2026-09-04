"use client";

import { useMemo } from "react";
import { buildIdentityNavigationUrl, type IdentityDeepLink } from "@/domain/app-navigation";
import type {
  PrivateIdentityCatalogProduct,
  PrivateIdentityRead,
  PrivateIdentityReceipt,
  PrivateIdentityReceiptItem,
  PrivateIdentityRestaurantMenu,
  PrivateIdentitySelector,
  PrivateIdentitySourceLine,
  PrivateIdentityStore,
  PrivateIdentityStoreProduct,
} from "@/domain/private-identity-read";
import { formatKrw } from "@/domain/settlement";
import { usePrivateIdentityDetail } from "@/features/private-identity/use-private-identity-detail";
import styles from "./page.module.css";

type Props = {
  selector: PrivateIdentitySelector;
  onBack: () => void;
};

function navigationBase() {
  return typeof window === "undefined" ? "https://example.test/PriceTrace" : window.location.href;
}

function identityHref(selector: IdentityDeepLink) {
  return buildIdentityNavigationUrl(navigationBase(), selector);
}

function IdentityLink({ selector, label, id }: { selector: IdentityDeepLink; label: string; id: string }) {
  return <a className={styles.privateIdentityLink} href={identityHref(selector)}>
    <span>{label}</span>
    <code>{id}</code>
  </a>;
}

function selectorLabel(selector: PrivateIdentitySelector) {
  switch (selector.type) {
    case "store": return "판매처";
    case "store_product": return "판매처 품목";
    case "restaurant_menu": return "음식점 메뉴";
    case "catalog_product": return "정확 판매 규격";
  }
}

function storeLabel(store: PrivateIdentityStore) {
  return store.branchName ? `${store.name} · ${store.branchName}` : store.name;
}

function productName(
  item: PrivateIdentityReceiptItem,
  read: PrivateIdentityRead,
  storeProductsById: ReadonlyMap<string, PrivateIdentityStoreProduct>,
) {
  const productId = item.productId ?? (item.storeProductId ? storeProductsById.get(item.storeProductId)?.productId : null);
  return read.products.find((product) => product.id === productId)?.name ?? "상품명 확인 필요";
}

function IdentityLinks({
  productId,
  storeProductId,
  catalogProductId,
  restaurantMenuId,
}: {
  productId: string | null;
  storeProductId: string | null;
  catalogProductId: string | null;
  restaurantMenuId: string | null;
}) {
  return <div className={styles.privateIdentityLinks}>
    {productId && <span className={styles.privateIdentityCode}><small>상품</small><code>{productId}</code></span>}
    {storeProductId && <IdentityLink selector={{ type: "store_product", id: storeProductId }} label="판매처 품목" id={storeProductId} />}
    {catalogProductId && <IdentityLink selector={{ type: "catalog_product", id: catalogProductId }} label="정확 규격" id={catalogProductId} />}
    {restaurantMenuId && <IdentityLink selector={{ type: "restaurant_menu", id: restaurantMenuId }} label="음식점 메뉴" id={restaurantMenuId} />}
  </div>;
}

function StoreCards({ stores }: { stores: readonly PrivateIdentityStore[] }) {
  if (stores.length === 0) return null;
  return <section className={styles.privateIdentitySection} aria-labelledby="private-stores-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>PRIVATE SELLERS</p><h2 id="private-stores-title">인증된 판매처</h2></div><small>storeId 기준</small></div>
    <div className={styles.privateIdentityCards}>
      {stores.map((store) => <article className={styles.privateIdentityCard} key={store.id}>
        <div><h3>{storeLabel(store)}</h3><p>{store.businessKind}</p></div>
        <IdentityLink selector={{ type: "store", id: store.id }} label="판매처 상세" id={store.id} />
        <dl className={styles.privateIdentityMeta}>
          {store.address && <div><dt>주소</dt><dd>{store.address}</dd></div>}
          {store.phone && <div><dt>연락처</dt><dd>{store.phone}</dd></div>}
          {store.merchantId && <div><dt>판매처 원본 ID</dt><dd>{store.merchantId}</dd></div>}
        </dl>
      </article>)}
    </div>
  </section>;
}

function ProductCards({
  read,
}: {
  read: PrivateIdentityRead;
}) {
  if (read.products.length === 0 && read.storeProducts.length === 0) return null;
  const productById = new Map(read.products.map((product) => [product.id, product]));
  return <section className={styles.privateIdentitySection} aria-labelledby="private-products-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>PRIVATE PRODUCTS</p><h2 id="private-products-title">생성된 private 상품</h2></div><small>상품군과 판매처 품목 분리</small></div>
    <div className={styles.privateIdentityCards}>
      {read.storeProducts.map((storeProduct) => <article className={styles.privateIdentityCard} key={storeProduct.id}>
        <h3>{productById.get(storeProduct.productId)?.name ?? "상품명 확인 필요"}</h3>
        <IdentityLink selector={{ type: "store_product", id: storeProduct.id }} label="판매처 품목 deep-link" id={storeProduct.id} />
        <dl className={styles.privateIdentityMeta}>
          <div><dt>상품 ID</dt><dd><code>{storeProduct.productId}</code></dd></div>
          <div><dt>판매처 ID</dt><dd><a href={identityHref({ type: "store", id: storeProduct.storeId })}><code>{storeProduct.storeId}</code></a></dd></div>
          {storeProduct.storeProductCode && <div><dt>판매처 상품 코드</dt><dd>{storeProduct.storeProductCode}</dd></div>}
        </dl>
      </article>)}
    </div>
  </section>;
}

function CatalogCards({ catalogs }: { catalogs: readonly PrivateIdentityCatalogProduct[] }) {
  if (catalogs.length === 0) return null;
  return <section className={styles.privateIdentitySection} aria-labelledby="private-catalog-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>EXACT CATALOG</p><h2 id="private-catalog-title">정확 판매 규격</h2></div><small>검증된 공개 catalog metadata</small></div>
    <div className={styles.privateIdentityCards}>
      {catalogs.map((catalog) => <article className={styles.privateIdentityCard} key={catalog.id}>
        <h3>{catalog.name}</h3>
        <p>{[catalog.brand, catalog.specification].filter(Boolean).join(" · ") || "규격 정보 없음"}</p>
        <IdentityLink selector={{ type: "catalog_product", id: catalog.id }} label="정확 규격 deep-link" id={catalog.id} />
        <dl className={styles.privateIdentityMeta}>
          <div><dt>상품군 ID</dt><dd><code>{catalog.standardProductId}</code></dd></div>
          <div><dt>단위</dt><dd>{catalog.packageCount}개 · 기준 {catalog.referenceUnit}</dd></div>
        </dl>
      </article>)}
    </div>
  </section>;
}

function MenuCards({ menus }: { menus: readonly PrivateIdentityRestaurantMenu[] }) {
  if (menus.length === 0) return null;
  return <section className={styles.privateIdentitySection} aria-labelledby="private-menus-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>EXACT MENUS</p><h2 id="private-menus-title">검증된 음식점 메뉴</h2></div><small>restaurantMenuId 기준</small></div>
    <div className={styles.privateIdentityCards}>
      {menus.map((menu) => <article className={styles.privateIdentityCard} key={menu.id}>
        <h3>{menu.name}</h3>
        <p>{menu.restaurantName} · {menu.servingLabel}</p>
        <IdentityLink selector={{ type: "restaurant_menu", id: menu.id }} label="메뉴 deep-link" id={menu.id} />
        <dl className={styles.privateIdentityMeta}>
          <div><dt>catalogProductId</dt><dd><a href={identityHref({ type: "catalog_product", id: menu.catalogProductId })}><code>{menu.catalogProductId}</code></a></dd></div>
          <div><dt>restaurantId</dt><dd><code>{menu.restaurantId}</code></dd></div>
        </dl>
      </article>)}
    </div>
  </section>;
}

function SourceLine({ sourceLine }: { sourceLine: PrivateIdentitySourceLine }) {
  return <article className={styles.privateIdentitySourceLine}>
    <div>
      <strong>원본 행 {sourceLine.lineOrdinal ?? "미상"}</strong>
      <span>{sourceLine.description ?? sourceLine.type} · {sourceLine.type}</span>
      <small>{sourceLine.sourceLineReferences.join(", ")}</small>
    </div>
    <IdentityLinks
      productId={sourceLine.productId}
      storeProductId={sourceLine.storeProductId}
      catalogProductId={sourceLine.catalogProductId}
      restaurantMenuId={sourceLine.restaurantMenuId}
    />
  </article>;
}

function ReceiptHistory({ read }: { read: PrivateIdentityRead }) {
  if (read.receipts.length === 0) return null;
  const storeProductsById = new Map(read.storeProducts.map((storeProduct) => [storeProduct.id, storeProduct]));
  return <section className={styles.privateIdentitySection} aria-labelledby="private-receipts-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>PRIVATE RECEIPTS</p><h2 id="private-receipts-title">인증된 영수증 기록</h2></div><small>원본 행·품목 identity 보존</small></div>
    <div className={styles.privateIdentityReceiptList}>
      {read.receipts.map((receipt: PrivateIdentityReceipt) => <article className={styles.privateIdentityReceipt} key={receipt.id}>
        <header><div><strong>{receipt.purchasedAt}</strong><small>영수증 ID <code>{receipt.id}</code></small></div><b>{formatKrw(receipt.totalPriceKrw)}</b></header>
        <p>거래번호 {receipt.transactionNumber}</p>
        {receipt.items.length > 0 && <ul>
          {receipt.items.map((item) => <li key={item.id}>
            <div><strong>행 {item.lineOrdinal} · {productName(item, read, storeProductsById)}</strong><small>{formatKrw(item.unitPriceKrw)} × {item.purchasedQuantity} = {formatKrw(item.totalPriceKrw)}</small></div>
            <IdentityLinks productId={item.productId} storeProductId={item.storeProductId} catalogProductId={item.catalogProductId} restaurantMenuId={item.restaurantMenuId} />
          </li>)}
        </ul>}
        {receipt.sourceLines.length > 0 && <details className={styles.privateIdentitySourceLines}>
          <summary>검증된 원본 행 {receipt.sourceLines.length}개</summary>
          <div>{receipt.sourceLines.map((sourceLine) => <SourceLine key={sourceLine.sourceLineId} sourceLine={sourceLine} />)}</div>
        </details>}
      </article>)}
    </div>
  </section>;
}

function PriceObservationList({ read }: { read: PrivateIdentityRead }) {
  if (read.priceObservations.length === 0) return null;
  return <section className={styles.privateIdentitySection} aria-labelledby="private-observations-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>PRIVATE OBSERVATIONS</p><h2 id="private-observations-title">가격 관측 연결</h2></div><small>{read.priceObservations.length}건</small></div>
    <div className={styles.privateIdentityObservationList}>
      {read.priceObservations.map((observation) => <article key={observation.id}>
        <div><strong>{observation.observedAt}</strong><small>{observation.verificationStatus} · {observation.measurementUnit}</small></div>
        <b>{formatKrw(observation.unitPriceKrw)}</b>
        <IdentityLinks productId={null} storeProductId={observation.storeProductId} catalogProductId={observation.catalogProductId} restaurantMenuId={null} />
      </article>)}
    </div>
  </section>;
}

function ReadContent({ read }: { read: PrivateIdentityRead }) {
  return <>
    <StoreCards stores={read.stores} />
    <ProductCards read={read} />
    <CatalogCards catalogs={read.catalogProducts} />
    <MenuCards menus={read.restaurantMenus} />
    <ReceiptHistory read={read} />
    <PriceObservationList read={read} />
    {read.stores.length === 0 && read.products.length === 0 && read.receipts.length === 0 && <div className={styles.privateIdentityEmpty} role="status">이 identity에 연결된 private 기록이 아직 없습니다.</div>}
  </>;
}

export function PrivateIdentityDetail({ selector, onBack }: Props) {
  const { type, id } = selector;
  const stableSelector = useMemo(
    () => ({ type, id }),
    [id, type],
  );
  const { configured, data, loading, error } = usePrivateIdentityDetail(stableSelector);

  return <section className={styles.browser}>
    <div className={styles.privateIdentityTopline}>
      <button className={styles.backLinkButton} type="button" onClick={onBack}>← 목록으로</button>
      <span className={styles.privateIdentityBadge}>AUTHENTICATED PRIVATE READ</span>
    </div>
    <div className={styles.privateIdentityHeader}>
      <div>
        <p className={styles.kicker}>PRICETRACE IDENTITY DETAIL</p>
        <h1>{selectorLabel(selector)} 상세</h1>
        <p>서버가 반환한 정확 identity와 인증된 사용자 소유의 영수증·상품·판매처 기록을 함께 표시합니다.</p>
      </div>
      <div className={styles.privateIdentitySelector}>
        <span>selector {selector.type}</span>
        <code>{selector.id}</code>
      </div>
    </div>

    {!configured && <div className={styles.privateIdentityMessage} role="status">
      <strong>인증된 PriceTrace 조회를 준비할 수 없습니다.</strong>
      <span>Supabase 공개 설정을 확인하고 로그인한 뒤 다시 여세요.</span>
    </div>}
    {configured && loading && <p className={styles.emptyState} role="status">인증된 identity 상세를 불러오는 중입니다.</p>}
    {configured && !loading && error && <div className={styles.privateIdentityMessage} role="alert">
      <strong>private identity를 확인하지 못했습니다.</strong>
      <span>{error}</span>
      <span>로그인 상태와 요청한 UUID의 소유 범위를 확인하세요.</span>
    </div>}
    {configured && !loading && !error && data && <ReadContent read={data} />}
  </section>;
}

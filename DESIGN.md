---
name: PriceTrace
description: 출처와 시점이 읽히는 Cinematic Data Instrument
colors:
  bg: "#101512"
  surface: "#171e19"
  surface-raised: "#202922"
  ink: "#edf1e9"
  muted: "#adb8af"
  subtle: "#91a096"
  line: "#344138"
  fine-rule: "#2c3930"
  accent: "#a5deac"
  accent-soft: "#223d2b"
  brand: "#2a6342"
  on-brand: "#f2f7f0"
  warning: "#e7c28c"
  warning-bg: "#332a1e"
  danger: "#f2aaa2"
  danger-bg: "#382521"
  image-paper: "#f0f0ea"
typography:
  display:
    fontFamily: "var(--font-suit), sans-serif"
    fontSize: "clamp(46px, 5.2vw, 76px)"
    fontWeight: 550
    lineHeight: 1.18
    letterSpacing: "-.04em"
  headline:
    fontFamily: "var(--font-suit), sans-serif"
    fontSize: "34px"
    fontWeight: 550
    lineHeight: 1.3
    letterSpacing: "-.035em"
  title:
    fontFamily: "var(--font-suit), sans-serif"
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "-.02em"
  body:
    fontFamily: "var(--font-suit), sans-serif"
    fontSize: "15px"
    lineHeight: 1.55
  label:
    fontFamily: "var(--font-suit), sans-serif"
    fontSize: "13px"
    fontWeight: 500
  measurement:
    fontFamily: "var(--font-suit), sans-serif"
    fontSize: "43px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "-.035em"
  card-price:
    fontFamily: "var(--font-suit), sans-serif"
    fontSize: "20px"
    fontWeight: 550
    lineHeight: 1.4
    letterSpacing: "-.02em"
rounded:
  flat: "0"
  badge: "3px"
  compact: "4px"
  control: "5px"
  card: "6px"
  dialog: "8px"
  mobile-dialog: "10px"
spacing:
  "4": "4px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "24": "24px"
  "32": "32px"
  "48": "48px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  button-primary-disabled:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.subtle}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  button-home:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg}"
    rounded: "{rounded.control}"
    padding: "13px 19px"
  button-home-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg}"
    rounded: "{rounded.control}"
    padding: "13px 19px"
  button-home-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.flat}"
    padding: "10px 0"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.compact}"
    padding: "9px"
  field-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  navigation-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "0 2px"
    height: "82px"
  filter-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.compact}"
    padding: "7px 11px"
  card-product:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  observation-readout:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    padding: "12px 10px"
    width: "210px"
---

# Design System: PriceTrace

## Overview

**Creative North Star: "Cinematic Data Instrument"**

Cinematic Data Instrument는 짙은 광물성 바탕, 은빛에 가까운 본문, 절제한 녹색으로 가격 기록의 출처와 시점을 읽게 하는 시각 체계다. 공간감은 홈의 관측 도형에 모으고 상품·음식점·판매처·장바구니 작업 화면은 얇은 구분선과 일정한 정보 위계로 정돈한다.

표현의 중심은 실제 관측 기록이다. 가격과 날짜는 도형 밖의 HTML에 남으며, 녹색은 선택된 관측·활성 상태·이동 동작을 설명한다. 배경 재질은 단색 면의 차이로 만들고 사진은 승인된 상품 이미지가 있을 때만 표시한다.

**Key Characteristics:**

- 녹색 기운의 짙은 중성 면과 밝은 본문, 가는 구분선.
- SUIT Variable 한 계열과 가격·날짜의 tabular numerals.
- 홈의 제한된 공간 반응과 작업 화면의 평평한 구성.
- 터치·키보드·모션 축소 상태에서도 읽을 수 있는 관측 정보.

이 문서는 2026-10-05의 구현 소스에서 추출했다. 기본 토큰은 [globals.css](src/app/globals.css), 서체 로딩은 [layout.tsx](src/app/layout.tsx), 작업 화면은 [page.module.css](src/app/page.module.css)의 `Cinematic Data Instrument` 구간과 그 뒤의 보정, 홈은 [observation-instrument.module.css](src/features/observation-instrument/observation-instrument.module.css)를 기준으로 한다. 반응 로직은 [use-observation-motion.ts](src/features/observation-instrument/use-observation-motion.ts)에서 확인했다.

앞의 YAML은 실제 값의 기록이다. `rounded`·`spacing`의 키는 반복 사용된 값을 찾기 위한 문서용 이름이며 새로운 CSS 변수를 추가하지 않는다. `fine-rule`은 홈에만 정의된 로컬 변수이고 `image-paper`는 상품 사진 영역과 이미지 확대 화면에서 반복되는 색이다. 공통 `--card`는 `--surface`의 별칭이다. 구현에 없는 색상 단계는 만들지 않았다. 빌드·브라우저·접근성 검사 결과는 이 문서가 증명하지 않는다.

## Colors

녹색 기운의 짙은 중성색 위에 밝은 글자와 옅은 녹색을 배치한다. 색상 값은 앞의 YAML을 기준으로 한다.

### Primary

- **관측 녹색** — `accent`: 선택된 관측 마커, 링크, 활성 표시, 포커스, 홈 문장의 강조.
- **차분한 선택 면** — `accent-soft`: 활성 필터와 최저 관측가 표시의 바탕.
- **동작 녹색** — `brand`와 `on-brand`: 기본 채움 버튼의 바탕과 글자.

### Neutral

- **광물성 바탕** — `bg`: 페이지, 내비게이션, 관측 판독부.
- **작업 면** — `surface`: 상품·판매처 카드, 입력, 모달.
- **올라온 면** — `surface-raised`: 선택 컨트롤, 이미지 자리표시, 비활성 버튼.
- **밝은 본문** — `ink`: 제목, 가격, 주요 정보.
- **보조 본문** — `muted`: 설명과 비활성 내비게이션.
- **메타데이터** — `subtle`: 날짜, 보조 아이콘, 자리표시 문구.
- **구조선** — `line`: 공통 테두리. `fine-rule`: 홈의 더 낮은 대비 구분선.
- **사진 바탕** — `image-paper`: 실제 상품 이미지의 가독성을 위한 밝은 면. 일반 작업 패널의 기본색으로 확장하지 않는다.

### Semantic feedback

`warning`·`warning-bg`와 `danger`·`danger-bg`는 기존 경고·오류 구분에 사용한다. 장식용 보조 브랜드 색으로 사용하지 않는다.

**The Evidence Accent Rule.** 녹색은 선택·이동·관측의 의미를 전달하는 데 쓴다. 경고와 오류는 별도의 의미 색을 유지한다.

## Typography

**Display Font:** SUIT Variable, `var(--font-suit), sans-serif`.
**Body Font:** 같은 SUIT Variable.
**Label/Mono Font:** 일반 라벨도 SUIT를 쓴다. 기존 식별자·코드 영역의 monospace는 해당 데이터 표시에만 유지한다.

서체는 `next/font/local`로 자체 제공하며 가변 굵기 범위는 100–900이다. `font-display: swap`으로 로딩 중에도 텍스트를 표시한다. 출처와 라이선스는 [ASSET_SOURCES.md](ASSET_SOURCES.md)에 기록되어 있다. 별도의 장식용 영문 디스플레이 서체는 없다.

### Hierarchy

| 역할 | YAML 키 | 적용 |
| --- | --- | --- |
| 홈 제목 | `display` | 큰 한글 문장. 강조 구절만 관측 녹색 |
| 작업 화면 제목 | `headline` | 상품·판매처 등 탐색 화면의 제목 |
| 섹션 제목 | `title` | 홈의 최근 기록 섹션 |
| 기본 본문 | `body` | 전역 기본값. 세부 컴포넌트는 목적에 맞는 크기를 지정 |
| 내비게이션 라벨 | `label` | 데스크톱 주요 탐색 |
| 관측 판독값 | `measurement` | 홈의 선택된 관측 단가 |
| 상품 카드 가격 | `card-price` | 작업 화면의 주요 가격 |

홈 소개문은 17px/1.8이며 좁은 화면에서 15px로 줄어든다. 홈 제목은 1050px 이하에서 53px, 760px 이하에서 `clamp(44px, 8vw, 62px)`를 적용한다. 작업 화면 제목은 모바일에서 29px가 된다. 본문 전체에 고정된 최대 글자 수 규칙은 구현되어 있지 않다.

**The Readable Measurement Rule.** 가격·날짜·기록 수에는 tabular numerals를 적용하고, 핵심 값과 출처를 도형 밖의 읽을 수 있는 텍스트로 제공한다.

## Layout

공유 헤더와 본문의 최대 너비는 1360px다. 넓은 화면의 좌우 여백은 42px, 1200px 이하에서는 30px, 760px 이하에서는 22px, 360px 이하에서는 16px다. 헤더 높이는 82px에서 모바일 68px로 바뀐다. 간격은 앞의 반복값을 사용하되, 실제 카드 내부 17px나 버튼 19px처럼 콘텐츠별 값도 존재한다. 모든 간격이 하나의 배수 체계라는 가정은 하지 않는다.

홈은 1:1.05 두 열과 48px 간격을 사용한다. 관측 현황은 네 칸, 최근 기록과 다음 탐색은 본문·290px 보조 열로 구성한다. 1050px 이하에서는 기록의 관측일을 상품 아래로 옮기며 보조 열을 240px로 줄인다. 760px 이하에서는 홈과 작업 구역을 한 열로 바꾸고 관측 현황은 두 칸으로 둔다. 1500px 이상에서 홈 두 열 간격은 90px다.

상품 그리드는 네 열, 1000px 이하 세 열, 760px 이하 두 열이다. 모바일의 필터는 토글로 펼치며 현재 선택 요약과 공식 채널의 범위 문구를 별도로 노출한다. 데스크톱 헤더 내비게이션은 760px 이하에서 하단 다섯 칸 내비게이션으로 바뀐다. 본문 하단 여백과 하단 내비게이션은 안전 영역을 고려한다.

모바일의 상품 이미지 자리표시는 실제 이미지가 있는 영역보다 낮다. 실제 사진 영역은 126px, 이미지가 없는 자리표시는 64px다. 같은 모양의 큰 빈 이미지 면을 반복하지 않는다.

## Elevation & Depth

기본 깊이는 `bg`·`surface`·`surface-raised`의 밝기 차이와 가는 테두리로 만든다. 상품·판매처·음식점 카드는 그림자 없이 놓이며, 판매처·음식점 카드의 호버는 테두리 변화를 사용한다. 선택된 분할 컨트롤과 카탈로그 탭의 안쪽 선은 깊이 표현이 아니라 선택 표시다.

### Shadow Vocabulary

| 역할 | 구현 값 | 적용 |
| --- | --- | --- |
| 모달 | `0 24px 100px #0008` | 인증·공식 상품·추이·영양 모달 |
| 떠 있는 장바구니 | `0 6px 24px #0005` | 데스크톱 장바구니 진입 |
| 선택 표시 | `inset 0 -2px var(--accent)` | 분할 컨트롤·카탈로그 탭 |

공통 모달 배경은 `#050a07c9`와 `backdrop-filter: blur(5px)`를 사용한다. 홈의 관측 도형은 900px perspective 안에서 SVG 기하만 기울인다. 가운데 가격 판독부는 기울이는 요소 밖에 있어 안정적으로 읽힌다.

**The Quiet Work Surface Rule.** 작업 화면의 카드는 면과 테두리로 구분한다. 큰 그림자는 모달의 분리에 사용하고, 떠 있는 장바구니에는 작은 그림자를 사용한다.

## Shapes

기본 입력과 버튼은 작게 둥근 모서리, 카드와 모달은 조금 더 큰 모서리를 사용한다. 정확한 값은 `rounded`의 역할별 값에 따른다. 선택 필터는 작은 모서리, 내비게이션 배지는 더 촘촘한 모서리를 가진다. 홈의 기록 행과 탐색 링크는 평평한 모서리와 가는 아래 구분선을 사용한다.

관측의 궤도와 점, 브랜드의 작은 표식은 각 역할에 필요한 도형이다. 원형 표식이 있다는 이유로 모든 컨트롤을 알약 모양으로 만들지 않는다. 모바일 모달은 위쪽 모서리만 10px로 둥글고 아래쪽은 화면 가장자리에 맞춘다. 기존 상세·관리 화면의 개별 모서리 값까지 공통 규칙으로 승격하지 않는다.

## Components

### Buttons

기본 작업 버튼은 동작 녹색의 채움과 밝은 글자를 사용한다. 전역 전환은 배경색·테두리색·글자색에 각각 160ms를 사용한다. 비활성 버튼은 올라온 면과 메타데이터 색으로 바뀌고 `not-allowed` 커서를 사용한다. 공통 버튼에 별도의 이동·확대 호버 효과는 없다.

홈의 첫 탐색 버튼은 밝은 바탕과 짙은 글자이며, 호버에서 관측 녹색 바탕으로 바뀐다. 높이는 최소 48px다. 두 번째 탐색 동작은 투명 바탕과 아래 구분선을 사용하고 호버에서 글자·선이 녹색으로 바뀐다. 작업 화면의 가격 기록 버튼은 투명 바탕·테두리를 사용한다.

키보드 포커스는 전역 `2px solid var(--accent)` outline과 4px offset을 사용한다. 원래의 버튼 의미와 접근 가능한 이름을 유지한다.

### Chips / selected controls

카테고리 필터의 선택 상태는 `accent-soft` 바탕과 `accent` 글자로 표시한다. 분할 컨트롤과 카탈로그 탭은 올라온 면, 밝은 글자, 녹색 아래선을 사용한다. 상태는 색과 기존 선택 속성·문구가 함께 전달한다.

### Cards / containers

상품 카드는 작업 면, 1px 구조선, 작은 카드 모서리, 그림자 없는 틀을 사용한다. 상품 사진이 있으면 밝은 사진 바탕 위에 실제 이미지를 놓는다. 사진이 없으면 선형 상품 아이콘과 자리표시 문구를 쓰며 관측 사실을 대신할 이미지를 만들지 않는다.

상품 정보 내부 여백은 넓은 화면에서 17px, 1200px 이하에서 14px, 모바일에서 12px, 360px 이하에서 10px다. 판매처 카드는 24px, 모바일에서 20px를 사용한다. 홈의 최근 기록은 카드 묶음 대신 구분선이 있는 버튼 행이다.

### Inputs / fields

기본 입력은 작업 면·구조선·기본 컨트롤 모서리를 쓴다. 검색 컨테이너는 포커스 진입 시 녹색 테두리를 보이고, 내부 입력의 outline을 제거한다. 일반 입력은 전역 포커스 outline을 유지한다. 자리표시 문구에는 `subtle`을 사용한다.

관측 상품 선택과 관측 시점 선택은 네이티브 `select`와 `input[type="range"]`다. range에는 label, 날짜·금액을 설명하는 `aria-valuetext`, 시점 output이 있다. 기록이 하나면 range만 비활성화되고 기록은 계속 읽힌다.

### Navigation

데스크톱 주요 내비게이션은 보조 글자, 호버와 활성 상태의 밝은 글자, 활성 항목 아래 녹색 2px 선으로 구성한다. 모바일은 아이콘과 짧은 이름을 함께 쓰는 하단 다섯 칸 내비게이션이다. 활성 항목은 관측 녹색, 개수 배지는 올라온 면을 사용한다. 페이지 상단에는 키보드용 본문 건너뛰기 링크가 있다.

### Observation instrument

홈의 관측 도형은 기존 `ProductGroup`의 실제 기록을 시간순으로 선택한다. SVG에는 최대 12개의 날짜 마커를 표시하고 모든 기록은 range에서 선택할 수 있다. 도형은 관계를 보여주는 배치이며 가격 축이나 정확한 시간 간격을 나타내지 않는다. 상품명·단가·날짜·판매처·전체 기록 이동은 별도의 HTML에 남는다. 관측이 없으면 준비 상태와 상품 목록 이동을 보여준다.

포인터 반응은 `prefers-reduced-motion: no-preference`와 `pointer: fine`일 때만 후보가 된다. 화면 안에 있고 탭이 보이며 터치 입력이 아닐 때, 포인터 이벤트가 최대 한 개의 대기 `requestAnimationFrame`을 예약한다. X 회전은 ±3도, Y 회전은 ±4도로 제한하며 CSS transform 전환은 180ms ease-out이다. 연속 프레임 루프나 자동 재생은 없다.

포인터가 떠나거나 화면 밖으로 나가거나 탭 가시성·모션 설정이 바뀌면 기울기를 초기화한다. `IntersectionObserver`가 없으면 정적으로 유지한다. 모션 축소 설정은 전역 애니메이션·전환과 도형 transform을 끈다. 터치 환경에서도 range와 상품 선택은 같은 데이터에 접근한다. 도형 영역 높이는 기본 330px, 1500px 이상 355px, 모바일 210px다.

### Assets and preview scope

새 도형은 네이티브 SVG와 CSS이며 생성·스톡 래스터는 추가하지 않았다. 서체는 SUIT, 인터페이스 아이콘은 Solar Linear의 보존된 경로다. 라이선스·출처와 기존 상품 사진의 데이터 출처는 별도 원장을 따른다.

`.impeccable/design.json`은 모션·그림자·반응형 값과 자체 렌더링 가능한 컴포넌트 예시를 보완한다. 예시의 상품명·날짜·금액 자리는 필드 설명이며 관측 레코드를 새로 만들지 않는다. 전체 관측 도형의 데이터 선택이나 React 상태를 JSON 미리보기가 재현한다는 의미는 아니다.

## Do's and Don'ts

### Do:

- Do 기존 CSS 토큰을 재사용하고, 선택된 데이터와 기본 동작에 녹색을 배치한다.
- Do 관측 가격 옆에 판매처와 관측 시점을 읽을 수 있게 둔다.
- Do 한글은 SUIT Variable로 조판하고, 가격·날짜·기록 수에 tabular numerals를 적용한다.
- Do 새 작업 화면에서도 검색·선택·필터와 본문 사이의 위계를 유지한다.
- Do 모션 없이도 같은 데이터와 탐색 동작을 제공한다.
- Do 기존 상품 이미지와 아이콘의 출처·라이선스를 ASSET_SOURCES.md에서 확인한다.

### Don't:

- Don't 근거 없는 가격·카운터·평가·파트너십을 시각 연출용으로 추가한다.
- Don't 관측가를 현재가나 재고 보장으로 표현한다.
- Don't 작업 화면을 불필요한 중첩 카드, 과한 발광, 보라·파랑 그라데이션으로 채운다.
- Don't 관측 도형의 위치나 거리를 가격 축·확률·정확한 시간 간격처럼 설명한다.
- Don't 핵심 정보나 이동 동작을 호버·애니메이션에만 의존시킨다.
- Don't 이 문서의 관측 도형을 위해 WebGL·GSAP·Lenis 또는 지속 렌더 루프를 기본 의존성으로 추가한다.

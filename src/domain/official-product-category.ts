import {
  categoryForProduct,
  type ProductCategory,
} from "./product-browser";

export const OFFICIAL_PRODUCT_CATEGORIES = [
  "식품",
  "생활용품",
  "주방용품",
  "신선식품",
  "음료",
  "간식",
] as const satisfies readonly ProductCategory[];

export type OfficialProductCategory = (typeof OFFICIAL_PRODUCT_CATEGORIES)[number];

export type ExistingCategoryProduct = {
  productName: string;
};

export type OfficialProductCategoryAssignment =
  | {
    method: "existing_product_match";
    basis: string;
  }
  | {
    method: "curated_rule";
    basis: string;
  };

export type OfficialProductCategoryResult = {
  category: OfficialProductCategory;
  assignment: OfficialProductCategoryAssignment;
};

type ExistingCategoryMatch = {
  category: OfficialProductCategory;
  productName: string;
};

type CategoryRule = {
  id: string;
  category: OfficialProductCategory;
  pattern: RegExp;
};

type OfficialProductCategoryInput = {
  sourceProductCode: string;
  sourceNameRaw: string;
};

const PX_CATEGORY_OVERRIDES = new Map<string, OfficialProductCategoryResult>([
  ["3118", {
    category: "식품",
    assignment: { method: "curated_rule", basis: "source-code-override:opaque-dongwon-food-product" },
  }],
  ["3854", {
    category: "간식",
    assignment: { method: "curated_rule", basis: "source-code-override:dried-prunes" },
  }],
  ["33050", {
    category: "음료",
    assignment: { method: "curated_rule", basis: "source-code-override:electrolyte-drink-mix" },
  }],
  ["34104", {
    category: "음료",
    assignment: { method: "curated_rule", basis: "source-code-override:coffee-drip-product" },
  }],
  ["34206", {
    category: "음료",
    assignment: { method: "curated_rule", basis: "source-code-override:coffee-drip-product" },
  }],
  ["35390", {
    category: "식품",
    assignment: { method: "curated_rule", basis: "source-code-override:rice-product" },
  }],
  ["35500", {
    category: "식품",
    assignment: { method: "curated_rule", basis: "source-code-override:health-supplement" },
  }],
  ["35886", {
    category: "식품",
    assignment: { method: "curated_rule", basis: "source-code-override:hangover-relief-jelly" },
  }],
  ["36034", {
    category: "생활용품",
    assignment: { method: "curated_rule", basis: "source-code-override:baby-wipes" },
  }],
  ["36782", {
    category: "음료",
    assignment: { method: "curated_rule", basis: "source-code-override:bottled-drink" },
  }],
  ["36870", {
    category: "식품",
    assignment: { method: "curated_rule", basis: "source-code-override:health-supplement" },
  }],
  ["36958", {
    category: "식품",
    assignment: { method: "curated_rule", basis: "source-code-override:rice-product" },
  }],
  ["36982", {
    category: "신선식품",
    assignment: { method: "curated_rule", basis: "source-code-override:packaged-eggs" },
  }],
  ["37066", {
    category: "식품",
    assignment: { method: "curated_rule", basis: "source-code-override:rice-product" },
  }],
]);

const CATEGORY_RULES: CategoryRule[] = [
  {
    id: "food-supplements-before-personal-care-terms",
    category: "식품",
    pattern: /홍삼 앰플/,
  },
  {
    id: "personal-household-before-kitchen-ambiguous",
    category: "생활용품",
    pattern: /핸드크림|리스트 랩|밀리터리.*언더셔츠|밀착덧신|버터플라이|이니스프리 퍼펙트9/,
  },
  {
    id: "snacks-before-kitchen-ambiguous",
    category: "간식",
    pattern: /약과도넛/,
  },
  {
    id: "prepared-food-before-kitchen-ambiguous",
    category: "식품",
    pattern: /(?:로얄|몬스터)크랩/,
  },
  {
    id: "prepared-meals-before-snack-keywords",
    category: "식품",
    pattern: /만능소스|만두|브리또|샌드위치|포켓그릴|순살치킨|콘치즈떡구이/,
  },
  {
    id: "kitchen-tools-and-storage",
    category: "주방용품",
    pattern: /젓가락|수저|숟가락|주방가위|식도|과도|도마|프라이팬|후라이팬|냄비|주전자|수세미|행주|키친타[월올]|위생백|지퍼백|롤백|쿠킹호일|종이호일|종이컵|아이스컵|빨대|밀폐용기|보관용기|찬통|반찬통|도시락통|식기|접시|대접|머그|텀블러|보틀|얼음틀|국자|뒤집개|주걱|채반|채칼|오프너|병따개|고무장갑|식탁보|랩$|크린백/,
  },
  {
    id: "personal-household-and-general-goods",
    category: "생활용품",
    pattern: /\(펫\)|big위생|샴푸|린스|트리트먼트|컨디셔너|두피|바디|탑투토 워시|그린핑거|핸드워시|핸드솝|아이깨끗해|핸드크림|선크림|선스틱|선쿠션|선스크린|썬크림|썬스틱|썬쿠션|썬스크린|썬패치|선패치|메디유브이|클렌[저징]|폼클렌저|페이셜워시|페이셜 워시|포밍워시|필링젤|토너|에멀젼|에센스|세럼|앰플|스킨|로션|리페어크림|수분 ?크림|탄력크림|아이크림|베리어 크림|수딩 크림|브라이트닝 크림|톤업크림|카밍다운크림|인텐스 크림|모이스처 풋 크림|패리어 수분 크림|바쿠치올 크림|클리어크림|크림 기획|크림 증정|크림 ?스페셜|크림 더블|크림 뉴트리션|크림 1\+1|크림\*|아쿠아\[|마스크팩|시트마스크|슬리핑 팩|슬리핑팩|코팩|패치|패드|리프팅 스팟|립밤|립케어|립틴트|블러 퍼지 틴트|립스루즈|아이라이너|파운데이션|쿠션|화장품|포 ?맨.*올인원|옴므.*올인원|올인원 ?플루이드|플루이드|리들샷|오일기획|오일컨트롤페이퍼|오드퍼퓸|미백제|센텔리안|마데카프라임|스네일|달팽이|카라콜|기프트세트|다이아몬드 리페어|클리오센스|치약|투스페이스트|칫솔|이중미세모|초극세모|혀클리너|치실|구강세정|스케일링케어|가글|리스테린|면도|질레트|쉐이빙|면봉|화장솜|시루콧토|생리대|탐폰|좋은느낌|순수한면|시크릿데이|언더웨어|화장지|휴지|티슈|물티슈|베이비 프리미엄|리꼬 베이비|크리넥스|모나리자|잘풀리는집|깨끗한나라|비누|사봉|세제|유연제|표백|드라이시트|딥클린|파워클린|참그린|유한젠|유한락스|액츠|퍼실|피지 |테크 |비트(?:드럼|아로마| 트리플| 마사지)|바르는비트|샤프란|피죤|울터치|세이프|베이킹소다|브레프|무때|자연퐁|드릴펑|청소|막대걸레|욕실용|욕실화|탈취|방향제|디퓨저|캘리포니아센트|제습|살충|모기|해피홈|홈키파|에프킬라|쓰레기봉투|종량제|재사용봉투|비닐봉투|위생장갑|건전지|에너자이저|배터리|충전기|충전 ?어댑터|무선 ?충전|충전보조|어댑터|이어폰|헤드셋|케이블|멀티탭|개별절전|랜턴|빔라이트|(?:와트 |멀티)후레쉬|후래쉬|손전등|시계|워치|선글라스|고글|electronic lighter|turbo lighter|라이터|부탄|연료|핫팩|보온대|파스(?:$|[ (])|에어로솔|카타플라즈마|휴족시간|밴드|블레미쉬|연고|소독|마스크|마데카 쿨링시트|깔개매트|안약|아물디|샤워|헤어|브러시|왁스|스프레이|염색|데오드란트|세안|여행용|트래블키트|진동클렌저|양말|팬티|드로즈|즈로즈|속바지|런닝|내의|반바지|반팔티|티셔츠|라운드티|쿨맥스티|쿨론티|로카티|숏슬리브|에어메쉬탱크|플리스|자켓|타이즈|타이츠|팔토시|쿨토시|장갑|글러브|스타킹|레깅스|풋커버|깔창|아치탭|헬멧내피|방한내피|귀마개|바라클라바|두건|넥워머|보호대|보조대|리스트랩|요대|고무링|조임이|전투화끈|군화끈|군번줄|태극기|태극마크|멀티위장|멀티하프|컴프레션발열|우산|우양산|우의|수건|타올|타월|세차|워셔액|워셔|와이퍼|불스원|엔진클리너|부동액|엔진오일|구두약|옷걸이|세탁물 ?바구니|빨래바구니|목욕바구니|리빙박스|장바구니|종이용기|접착제|테이프|볼펜|네임펜|라이트펜|클리어화일|노트|수첩|커터|칼날|방충|곰팡이|신발|슬리퍼|모자|벨트|캐리어|가방|백팩|골프공|탁구공|마사지 건|풋파일|담배|테리아|믹스 아이스|디스플러스|에쎄|레종|말보로|보헴|더원|심플|카트리지|전자라이터|손톱깍|손톱깎|블루투스|에그디바이스|프로컷s날/,
  },
  {
    id: "snack-products-with-dairy-terms",
    category: "간식",
    pattern: /끌레도르|^콘치 치즈크림|쌀칩|포테이토 크리스프|빵또아|빵빠레|prepack|뉴욕치즈케이크큐브|칼로리바란스|프링글스|버터와플|참그레인|엠[앤엔]엠즈|밀카|예감|스윙칩|눈을감자|오감자|닭다리너겟|뿌셔뿌셔|밀크칩스|게메즈 에낙|고래바|버터샌드|크룽지|허니버터.*칩|티각태각|바삭하고|오튀|쥐포|황태부각|넛츠 위드 에스프레소/,
  },
  {
    id: "dairy-bread-before-beverages",
    category: "식품",
    pattern: /치즈|식빵|생크림빵|크림치즈/,
  },
  {
    id: "snacks-confectionery-ice-cream-and-instant-noodles",
    category: "간식",
    pattern: /과자|스낵|스넥|감자칩|포테이토칩|팝칩|초코|초콜릿|쵸코|코코아칩스|코코아크림 웨이퍼|쿠앤크|엠엔엠즈|캔디|사탕|껌|자일리톨|xy[li]+tol|젤리|스키틀즈|마이쮸|아이셔|웨더스|젤리|쿠키|비스킷|크래커|웨하스|웨이퍼|(?<!스)파이|케이크|케익|카스테라|도넛|글레이즈|파운드|약과|호떡|꽈배기|팝콘|아몬드|마카다미아|코코넛|스트로베리큐브|땅콩|견과|믹스넛|넛엔베리|인조이넛츠|육포|아귀포|먹태포|맛다리|로스트비프|먹태열풍|맛좋은 오징어|촉촉한 오징어|얍실이오징어|문어콕콕|스테이크마블|아이스크림|아이스바|컵아이스|팥빙수|수박화채빙수|스크류바|메로나|누가바|돼지바|죠스바|수박바|비비빅|보석바|쌍쌍바|캔디바|고래바|정글망고바|주물러|프리팩|prepack|콘$|맥시콘|모나카|샤베트|바이트|싸만코|붕어|하겐다즈|요맘때|끌레도르|뽕따|아이스웰|딥앤로우|핫바|프로틴바|에너지바|시리얼바|더단백바|키커바|라면|사발면|컵면|비빔면|짬뽕면|오동통면|우동|짬뽕|팔도비빔면|진비빔면|짜파게티|짜슐랭|짜왕|너구리|안성탕면|불닭|쫄병|진짬뽕|왕뚜껑|컵누들|간짬뽕|새우탕|새우깡|포카칩|꼬깔콘|콘칩|포스틱|오레오|롯샌|빠다코코낫|허니뻥이요|스니커즈|트윅스|킷캣|로투스|하리보|예감|오잉|달달바삭|카롱|몽슈|홈런볼|오예스|몽쉘|초코파이|빼빼로|칸쵸|칙촉|하임|마가렛트|맛동산|양파링|프링글스|썬칩|태양의 맛 썬|허니버터칩|고래밥|에이스|크라운산도|쿠크다스|다이제|제크|죠리퐁|츄러스|후레쉬베리|연양갱|천하장사|맛밤|후르트링|뚜또|틴인틴|미니먼|바나나킥|감자깡|고구마깡|오 감자|감자알칩|마늘바게트|프리츠|곡물그대로|그랑쉘|건망고|건복숭아|고구마츄|둥근달 화이트크림|크림블/,
  },
  {
    id: "beverages-and-alcohol",
    category: "음료",
    pattern: /생수|샘물|워터|백산수|삼다수|몽베스트|아이시스|석수|사이다|콜라|스프라이트|펩시|웰치|탄산수|탄산음료|스파클링|씨그램|트레비|빅토리아|데미소다|오랑지나|분다버그|소다|토닉|진저에일|주스|쥬스|음료|에이드|식혜|감주|아침햇살|하늘청|하늘보리|황금보리|블랙보리|청보리차|맑게 우려낸 누룽지|갈아만든 ?배|초록매실|미에로 ?화이바|자연은 |카프리썬|피크닉|캐치 티니핑|따옴 |파워오투|이프로부족할때|환타|미닛메이드|매일야채|슈퍼부스트|과채|농장|아임리얼|델몬트|베지밀|커피|아메리카노|콜드브루|에스프레소|프라푸치노|스타벅스|밀크티|헤이즐넛 230ml|콘트라베이스|레쓰비|조지아|칸타타|카누|맥심|라떼|카페|드립백|커피믹스|커피빈|로스트 빈|핫코코아|코코아 믹스|코코아믹스|티백|녹차|홍차|블랙티|아이스티|우롱티|그린티|실론티|티즐|tealog|옥수수수염차|헛개수|생강차|루이보스|토레타|포카리|게토레이|파워에이드|핫식스|레드불|몬스터에너지|에너지드링크|테이크핏|우유|락토프리|두유|요구르트|요거트|요플레|요거톡|야쿠르트|불가리스|다논|쾌변|헬리코박터|프로젝트 윌|떠먹는 윌|남양 이오|프로틴드링크|밀키스|맥콜|박카스|비타500|구론산|컨디션|깨수깡|상쾌환 booster|주당의비결|비결energy|마시는|드링크|콤부차|유기농 레몬즙|차$|茶|소주|맥주|캔$|논알콜|알코올 ?프라이|와인|위스키|발렌타인|조니워커|잭다니엘|보드카|막걸리|청하|백세주|복분자|하이볼|싱글톤|스미노프|꼬냑|코냑|라가불린|글렌|화요|새로|진로|좋은데이|로얄샬루트|와일드터키|윈저|스카치블루|스카치하이|테라|처음처럼|참이슬|크롬바커|클라우드|에비스|독도 37|가브리엘xo|세인트레미xo|선양|귀주주중주|솔주|카사블랑카|호세쿠엘보|기리시마|기원 호랑이|사화 유자|코젤|하이네켄|쿠보다만쥬|연태구냥|소비뇽|마르께스|청풍|잎새주|선양린|더블벅|듀어스|심술7|쥰마이|순하리|엑스레이티드|공부가주|비잔크리어|프리미엄 리미티드|파스쿠아|파스칼xo/,
  },
  {
    id: "prepared-and-pantry-food",
    category: "식품",
    pattern: /햇반|오뚜기밥|볶음밥|비빔밥|덮밥|국밥|진밥|리조또|밥이랑|밥알|김밥|죽|호박죽|모닝죽|국$|국탕|탕$|찌개|전골|국수|소면|당면|파스타|스파게티|쫄면|냉면|소시지|소세지|프랑크|후랑크|킬바사|햄$|잠봉|슬라이스 씬|런천미트|리챔|스팸|로스팜|베이컨|어묵|맛살|만두|교자|돈까스|돈가스|통까스|떡갈비|함박스테이크|부어스트|흔들닭|마늘퐁닭|골뱅이|번데기|참치|삼치구이|안심유 야채사각|직화구이 오징어|조미 오징어|고등어구이|김$|돌자반|김말이|김치|미역|다시마|다시다|한알레시피|쌈장|된장|고추장|맛다시|비빔장|초장|간장|케찹|케첩|마요네[즈스]|머스타드|페스토|소스|드레싱|양념|소금|천일염|솔트|후추|참깨|설탕|알룰로스|식초|식용유|콩기름|옥수수유|포도씨유|해바라기유|올리브유|올리브오일|아보카도 오일|참기름|들기름|미림|마가린|밀가루|부침가루|튀김가루|전분|와플믹스|피클|단무지|유부|통조림|황도|스위트콘|카레|짜장|떡국|떡볶이|떡$|피자|브리또|라자냐|도시락|곰탕|육개장|부대찌개|설렁탕|삼계탕|갈비탕|감자탕|순대|족발|편육|보쌈|닭발|닭다리너겟|버팔로봉|가라아게|김치볶음|장조림|무침|크림 ?스프|양송이 ?스프|쇠고기 ?스프|콘 ?스프|옥수수 ?스프|스프(?:분말|컵|$)|수프|호빵|오트밀|시리얼|스페셜k|콘푸로스트|그래놀라|과일잼|잼$|콩포트|꿀$|허니스틱|야생화스틱|올리고당|물엿|액젓|젓갈|오징어젓|낙지젓|명란|김가루|후리가케|누룽지|누룽제비|쌀|도달미|상상예찬|잡곡|현미|흑미|병아리콩|콩$|견과류|나또|이유식|퓨레|분유|위드맘|플래티넘 [12]단계|비타민|비타구미|철분|유산균|락토핏|홍삼|흑삼|침향|녹용|건강기능|건강식|건강미식|발효효소|효소세트|밀크씨슬|오메가|루테인|프로바이오틱스|프로폴리스|콜라겐|단백질|더블유피아이|프로틴|산양유|초유|아르기닌|이뮨|칼슘|마그네슘|msm|레모나|뉴케어|메디웰|큐어웰|위편한|당케어|아르포텐|영양식|퍼펙트프로틴|상쾌환|모닝이즈백|속청|까스활액|활기력|미인활|에너린|턴업샷|치얼업|베터|원기|우루샷|바이옴|헬씨칸|관절/,
  },
  {
    id: "fresh-produce-meat-seafood-and-tofu",
    category: "신선식품",
    pattern: /사과|딸기|포도|수박|참외|복숭아|귤|오렌지|바나나|망고|키위|멜론|블루베리|라즈베리|샤인머스켓|토마토|감자|고구마|양파|마늘|대파|파프리카|상추|깻잎|버섯|채소|야채|과일|두부|순두부|콩나물|계란|달걀|유정란|특란|감동란|훈제란|참숯란|호유란|한돈|삼겹|목살|소고기|쇠고기|한우|돼지고기|닭가슴살|닭고기|오리고기|훈제오리|갈비|스테이크|새우|오징어|낙지|쭈꾸미|문어|꽃게|조개|관자|전복|고등어|갈치|굴비|연어|생선|해물|씨푸드|어패류|김치|냉동육|냉장육/,
  },
  {
    id: "bread-dairy-and-general-food",
    category: "식품",
    pattern: /빵|식빵|베이글|치즈|까망베르|버터|크림치즈|분유|요리|반찬|장조림|에그샐러드|튀김|김말이|커리|카레|분말|가루|즉석|냉동|냉장|조리|간편식|레토르트|선식|미숫가루|조미|육수|사골|메밀|보리|통밀|우리밀|곡물|콩가루|김밥|샌드위치|핫도그|토스트|부침|전$|완자|탕수육|꿔바로우|치킨|닭강정|불고기|주꾸미|쭈꾸미|고기|육류|수산|어육|어포|건어물|멸치|황태|명태|쥐포|오징어채|도라지|나물|장아찌|오튀|티각태각|바삭하고|스노우크랩킹/,
  },
];

export function normalizeOfficialProductMatchName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/^\((?:영외|영내)\)/, "")
    .replace(/[^0-9a-z가-힣]+/g, "");
}

export function buildExistingProductCategoryIndex(products: ExistingCategoryProduct[]) {
  const candidates = new Map<string, ExistingCategoryMatch[]>();
  for (const product of products) {
    const category = categoryForProduct(product.productName);
    if (category === "전체" || category === "미분류") continue;
    const key = normalizeOfficialProductMatchName(product.productName);
    const existing = candidates.get(key) ?? [];
    if (!existing.some((candidate) => candidate.category === category && candidate.productName === product.productName)) {
      existing.push({ category, productName: product.productName });
    }
    candidates.set(key, existing);
  }

  const index = new Map<string, ExistingCategoryMatch>();
  for (const [key, matches] of candidates) {
    const categories = new Set(matches.map((match) => match.category));
    if (categories.size === 1) index.set(key, matches[0]);
  }
  return index;
}

export function classifyOfficialProduct(
  product: OfficialProductCategoryInput,
  existingIndex: Map<string, ExistingCategoryMatch>,
): OfficialProductCategoryResult | null {
  const { sourceNameRaw, sourceProductCode } = product;
  const existing = existingIndex.get(normalizeOfficialProductMatchName(sourceNameRaw));
  if (existing) {
    return {
      category: existing.category,
      assignment: {
        method: "existing_product_match",
        basis: existing.productName,
      },
    };
  }

  const override = PX_CATEGORY_OVERRIDES.get(sourceProductCode);
  if (override) return override;

  const normalizedName = sourceNameRaw.normalize("NFKC").toLocaleLowerCase("ko-KR");
  const rule = CATEGORY_RULES.find((candidate) => candidate.pattern.test(normalizedName));
  if (!rule) return null;
  return {
    category: rule.category,
    assignment: {
      method: "curated_rule",
      basis: rule.id,
    },
  };
}

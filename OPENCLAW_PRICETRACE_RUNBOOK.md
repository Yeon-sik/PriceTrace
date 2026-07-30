# PriceTrace OpenClaw 운영 가이드

Windows에서 Docker로 격리된 `pricetrace` 에이전트를 실행하고, Telegram으로 PriceTrace 표준 상품을 한 건씩 조사·승인·등록하는 절차다.

## 1. 현재 확인 상태

2026-07-30 로컬 환경에서 다음을 확인했다.

| 항목 | 확인 상태 |
|---|---|
| OpenClaw | `2026.6.8` |
| Gateway | Scheduled Task 등록, `127.0.0.1:18789`, 실행 중, probe 정상 |
| Telegram | `@Yeonsik_Agent_Bot`, 연결·polling·probe 정상 |
| 에이전트 | `pricetrace` |
| 샌드박스 | `runtime=sandboxed`, `mode=all`, `scope=session` |
| 호스트 작업공간 | `workspaceAccess=none` |
| Elevated | 비활성화 |
| Skill | `pricetrace-register-standard-products`, Ready, 모델 노출·명령 호출 가능 |
| Docker | Client 설치 확인, 점검 시점에는 Desktop 엔진이 꺼져 있어 Server 연결 실패 |

이 표는 확인 당시의 스냅샷이다. OpenClaw 업데이트, 설정 변경, Windows 재부팅 뒤에는 아래 점검 명령으로 다시 확인한다.

## 2. 보안 경계

현재 `pricetrace` 에이전트의 의도한 정책은 다음과 같다.

- 허용 도구: `read`, `browser`, `web_search`, `web_fetch`, `image`
- 차단 도구: `exec`, `process`, `code_execution`, `write`, `edit`, `apply_patch`, 세션·서브에이전트·cron·gateway·nodes·computer 제어
- 호스트 작업공간 접근: 없음
- Elevated 실행: 비활성화
- 에이전트가 볼 수 있는 Skill: `pricetrace-register-standard-products` 한 개
- PriceTrace 접속 허용 호스트: `host.docker.internal`

브라우저 도구는 관리자 화면의 저장 버튼을 누를 수 있다. 따라서 반드시 다음 순서를 지킨다.

```text
상품 한 건 조사 → 근거 검토 → 상품 코드가 포함된 승인 → 한 번 저장 → 화면 재조회
```

## 3. 매일 가동하는 순서

### 3-1. Docker Desktop 실행

Windows 시작 메뉴에서 Docker Desktop을 실행하고 엔진 준비가 끝날 때까지 기다린다.

PowerShell에서 확인한다.

```powershell
docker version
```

정상 기준:

- `Client`와 `Server`가 모두 표시된다.
- `failed to connect to the docker API`가 없어야 한다.

`Client`만 보이면 에이전트 브라우저 샌드박스를 시작할 수 없다. Docker Desktop을 다시 확인한다.

### 3-2. OpenClaw 명령 경로 준비

일반 터미널에서 `openclaw` 명령을 바로 찾지 못하면 다음 변수를 사용한다.

```powershell
$openclawCli = Join-Path $env:APPDATA 'npm\openclaw.cmd'
& $openclawCli --version
```

이 문서의 나머지 PowerShell 예시는 `$openclawCli`를 사용한다.

### 3-3. Gateway 확인

```powershell
& $openclawCli gateway status
```

정상 기준:

- `Runtime: running`
- `Connectivity probe: ok`
- `Listening: 127.0.0.1:18789`

중지돼 있으면 시작한다.

```powershell
& $openclawCli gateway start
```

설정 변경 후이거나 응답이 이상하면 재시작한다.

```powershell
& $openclawCli gateway restart
```

### 3-4. Telegram 연결 확인

```powershell
& $openclawCli channels status --probe
```

정상 기준:

- `enabled`
- `configured`
- `running`
- `connected`
- `works`

### 3-5. 격리 정책과 Skill 확인

```powershell
& $openclawCli sandbox explain --agent pricetrace
& $openclawCli skills check --agent pricetrace
& $openclawCli skills info pricetrace-register-standard-products --agent pricetrace
```

다음을 확인한다.

- `runtime: sandboxed`
- `mode: all`
- `scope: session`
- `workspaceAccess: none`
- Elevated 비활성화
- `pricetrace-register-standard-products`가 Ready
- `Visible to model: yes`
- `Available as command: yes`

### 3-6. PriceTrace 개발 서버 실행

새 PowerShell 창에서 실행한다.

```powershell
Set-Location 'C:\Github\창팡맨'
npm.cmd run dev -- --hostname 0.0.0.0
```

이 창은 작업이 끝날 때까지 닫지 않는다.

접속 주소:

- Windows 브라우저: `http://localhost:3000/PriceTrace`
- OpenClaw Docker 브라우저: `http://host.docker.internal:3000/PriceTrace`

에이전트에게 `localhost`를 주면 컨테이너 자신을 가리키므로 사용하지 않는다. `/PriceTrace`를 `/`로 바꾸지 않는다.

### 3-7. 선택 점검

모델과 에이전트 응답을 확인하려면 실행한다. 모델 사용량이 발생할 수 있다.

```powershell
& $openclawCli agent --agent pricetrace --message 'Reply with OK only.' --json
```

## 4. 작업 화면 관찰

### Dashboard

```powershell
& $openclawCli dashboard
```

브라우저에서 `pricetrace`의 현재 Telegram 세션을 선택해 도구 호출과 진행 상태를 확인한다.

Gateway Dashboard 기본 주소:

```text
http://127.0.0.1:18789/
```

### 실시간 로그

별도 PowerShell 창에서 실행한다.

```powershell
& $openclawCli logs --follow --local-time
```

종료할 때 `Ctrl+C`를 누른다.

### Telegram 세션의 noVNC 화면

Telegram에서 다음 메시지를 먼저 보낸다.

```text
샌드박스 브라우저를 시작하되 아직 이동하거나 조작하지 마.
현재 Telegram 세션의 noVNC observer URL만 보내줘.
```

받은 URL을 Windows 브라우저에서 연다. CLI 기본 세션과 Telegram 세션은 서로 다른 브라우저 컨테이너를 사용할 수 있으므로 실제 작업 중인 Telegram 세션의 URL을 사용한다.

## 5. 상품 한 건 조사

### 5-1. 새 세션 시작

Telegram에서 다음 명령을 단독으로 보낸다.

```text
/new
```

Skill을 갱신한 뒤에는 반드시 새 세션을 시작한다. 이전 세션이 오래된 Skill 내용을 유지할 수 있다.

### 5-2. 조사 명령

다음 프롬프트를 복사해 보낸다.

```text
/skill pricetrace-register-standard-products

샌드박스 브라우저만 사용해
http://host.docker.internal:3000/PriceTrace
에 접속해.

관리자 > 표준 상품 관리 > 연결 대기 상품에서 맨 위 상품 1건만 조사해.

먼저 판매처, 판매처 상품 코드, 영수증 판매 규격명을 기록해.
같은 판매처+상품 코드가 다른 판매 규격에 이미 연결돼 있으면 중단해.

기존 표준 상품을 재사용할지 새 표준 상품을 만들지 판단하고 다음 값을 준비해:

[표준 상품·판매 규격]
- 표준 상품명
- 판매 규격명
- 제조사 또는 브랜드의 공식 상품 URL
- 신규 상품이면 직접 HTTPS 대표 이미지 URL
- 개당 내용량
- 내용 단위
- 영수증 판매 규격의 묶음 수
- 단위가격 기준
- verified 또는 placeholder

[쿠팡 필수 판매]
- 정확히 같은 제품과 선택 옵션의 쿠팡 URL
- 현재 선택 옵션의 총 판매 가격
- 그 가격으로 제공되는 판매 개수
- 판매 개수 하나당 내용량
- 내용 단위

[최대 묶음 — 확인 가능한 경우만]
- 같은 URL과 옵션에서 선택 가능한 최대 묶음 개수
- 그 묶음의 총가격

영수증 판매 규격의 묶음 수와 쿠팡 판매 개수를 혼동하지 마.
쿠팡 총가격 대신 개당 환산 가격을 입력하지 마.
최대 묶음의 두 값 중 하나만 확인되면 둘 다 입력하지 마.

규격을 공식 근거로 확인할 수 없으면 왼쪽의 전용 placeholder 경로만 사용해.
placeholder sentinel을 쿠팡 필드에 복사하지 마.
쿠팡 필수 URL·가격·판매 개수·개당 내용량은 실제 값이 모두 확인돼야 해.

지금은 저장, 등록, 연결, 제출 버튼을 누르지 마.
근거 URL과 입력 예정값만 보고하고 내 승인을 기다려.
로그인, 2FA, CAPTCHA, 브라우저 정책 차단, 상품 불일치, 근거 부족이 발생하면 아무것도 저장하지 말고 중단 사유를 보고해.
```

## 6. 조사 결과 검토

승인 전에 다음을 확인한다.

- 대상이 정확히 한 건인가
- 판매처와 상품 코드가 맞는가
- 기존 상품 재사용 또는 신규 생성 근거가 타당한가
- 판매 규격명이 영수증 표기와 맞는가
- 공식 URL이 실제 제조사·브랜드 상품 페이지인가
- 신규 상품 이미지가 직접 HTTPS 이미지 URL인가
- 판매 규격의 내용량·단위·묶음 수·기준 단위가 구분됐는가
- placeholder 여부가 명시됐는가
- 쿠팡 상품과 선택 옵션이 정확히 같은가
- 쿠팡 가격이 현재 옵션의 총가격인가
- 쿠팡 판매 개수와 개당 내용량이 구분됐는가
- 최대 묶음은 수량과 총가격이 함께 확인됐는가
- 아직 어떤 저장 버튼도 누르지 않았는가

조사 결과만 보고된 상태가 정상적인 승인 대기 상태다. 아직 PriceTrace 데이터는 변경되지 않았다.

## 7. 상품 한 건 승인

값이 모두 맞을 때만 다음 형식으로 승인한다.

```text
승인한다. 방금 요약한 판매처 상품 코드 <상품코드>의 1건만 저장해.

승인한 값 그대로 현재 연결 모달의 왼쪽과 오른쪽을 입력하고
`표준 상품 등록`을 한 번만 눌러.

이번 버튼은 다음 항목을 함께 저장한다:
- 표준 상품 생성 또는 재사용
- 판매 규격 생성 또는 재사용
- 판매처 상품 코드 매핑
- 쿠팡 필수 판매 가격
- 조사된 경우 최대 묶음 가격

별도 쿠팡가 화면으로 이동해 다시 등록하지 마.
다른 상품으로 넘어가지 마.

저장 후 화면을 다시 읽어 대기열 제거, 판매 규격, 매핑, 쿠팡 가격,
최대 묶음, 대표 이미지의 실제 반영 여부를 보고하고 종료해.
이미지만 실패했다면 전체 등록을 다시 실행하지 마.
```

`<상품코드>`를 실제 코드로 바꾼다. 승인 후 에이전트가 값을 바꾸겠다고 보고하면 다시 검토하고 재승인한다.

## 8. 저장 후 확인

최신 연결 방식은 `표준 상품 등록` 버튼 한 번으로 다음을 원자적으로 저장한다.

- 표준 상품
- 판매 규격
- 판매처 상품 코드 매핑
- 쿠팡 필수 판매 가격
- 선택적으로 최대 묶음 가격

대표 이미지는 위 등록 성공 후 별도로 저장된다.

완료 보고에서 다음을 확인한다.

- 처리한 판매처와 상품 코드
- 표준 상품명
- 판매 규격명
- 규격 상태: `verified` 또는 `placeholder`
- 공식 URL
- 신규·기존 표준 상품 여부
- 이미지 등록·기존 이미지 재사용·이미지 실패 여부
- 쿠팡 URL
- 쿠팡 필수 판매 총가격
- 쿠팡 판매 개수
- 개당 내용량과 단위
- 최대 묶음 개수와 총가격 또는 `not-observed`
- 대기열 제거 또는 매핑 수 증가
- 다른 상품을 처리하지 않았다는 확인

가능하면 본인의 Windows 브라우저에서도 같은 값을 확인한다.

### 실패 해석

- 등록 요청 자체가 실패하면 표준 상품·판매 규격·매핑·쿠팡 가격이 모두 저장되지 않은 것으로 보고 재조회한다.
- 이미지만 실패하면 나머지 등록은 성공했을 수 있다. 전체 등록을 반복하지 말고 대표 이미지 관리에서 별도로 복구한다.
- 성공 여부가 불명확하면 재클릭하지 말고 대기열·등록 상품·쿠팡 가격을 먼저 조회한다.
- 쿠팡 필수 값 중 하나라도 확인할 수 없으면 신규 연결 전체를 저장하지 않는다.

## 9. 작업 중단

에이전트가 승인 없이 저장하려 하거나 다른 상품으로 이동하면 Telegram에서 단독으로 보낸다.

```text
/stop
```

`/stop`은 이미 완료된 저장을 되돌리지 않는다. 그래서 저장 전 승인 분리가 필요하다.

## 10. 작업 종료

1. 진행 중인 에이전트 작업이 없는지 확인한다.
2. 로그 PowerShell에서 `Ctrl+C`를 누른다.
3. PriceTrace 개발 서버 PowerShell에서 `Ctrl+C`를 누른다.
4. 필요하면 Gateway를 중지한다.

```powershell
& $openclawCli gateway stop
```

5. Docker Desktop을 종료한다.
6. Windows를 정상 종료한다.

Gateway는 Scheduled Task로 등록돼 있으므로 매일 반드시 중지할 필요는 없다.

## 11. 문제 해결

### Docker `Server`가 없음

- Docker Desktop이 완전히 실행됐는지 확인한다.
- `docker version`에 `Server`가 나올 때까지 에이전트 작업을 시작하지 않는다.
- 계속 실패하면 Docker Desktop을 재시작한다.

### Gateway가 동작하지 않음

```powershell
& $openclawCli gateway status --deep
& $openclawCli status
& $openclawCli doctor
& $openclawCli gateway restart
```

### Telegram이 연결되지 않음

```powershell
& $openclawCli channels status --probe
& $openclawCli logs --follow --local-time
```

`pairing`, `blocked`, `allowlist`, 인증 오류를 확인한다.

### PriceTrace 접속이 거부됨

1. 개발 서버 창이 열려 있는지 확인한다.
2. Windows에서 `http://localhost:3000/PriceTrace`를 확인한다.
3. 에이전트에는 `http://host.docker.internal:3000/PriceTrace`를 전달했는지 확인한다.
4. 개발 서버가 `--hostname 0.0.0.0`으로 실행됐는지 확인한다.

### `Navigation blocked` 또는 SSRF 오류

```powershell
& $openclawCli config get browser.ssrfPolicy --json
```

의도한 최소 허용 형태:

```json
{
  "dangerouslyAllowPrivateNetwork": false,
  "allowedHostnames": [
    "host.docker.internal"
  ]
}
```

전체 사설망을 허용하는 `dangerouslyAllowPrivateNetwork=true`로 바꾸지 않는다.

### Skill이 보이지 않음

```powershell
& $openclawCli skills check --agent pricetrace
& $openclawCli skills info pricetrace-register-standard-products --agent pricetrace
```

Ready인데 기존 Telegram 세션에서만 오래된 절차가 보이면 `/new`로 새 세션을 시작한다.

### OpenAI 모델 인증 오류

먼저 상태를 확인한다.

```powershell
& $openclawCli models status
& $openclawCli models auth list --provider openai
```

OAuth를 다시 연결한다.

```powershell
& $openclawCli models auth login --provider openai
```

브라우저 callback을 열 수 없으면 device code를 사용한다.

```powershell
& $openclawCli models auth login --provider openai --device-code
```

기존 프로필을 의도적으로 교체할 때만 `--force`를 추가한다. 실제 Gateway가 사용하는 동일한 Windows/OpenClaw 환경에서 인증한다.

## 12. 설정 변경 뒤 점검

매일 실행할 필요는 없다. OpenClaw 설정이나 버전을 변경한 뒤에만 수행한다.

```powershell
& $openclawCli config validate
& $openclawCli gateway restart
& $openclawCli sandbox recreate --agent pricetrace --browser --force
& $openclawCli sandbox explain --agent pricetrace
& $openclawCli channels status --probe
& $openclawCli skills check --agent pricetrace
```

`sandbox recreate`의 `No sandbox runtimes found`는 삭제할 기존 컨테이너가 없다는 뜻일 수 있다. 다음 작업에서 새 샌드박스가 생성된다.

에이전트 배열 인덱스를 수정해야 할 때는 먼저 확인한다.

```powershell
& $openclawCli config get agents.list --json
```

확인하지 않고 `agents.list[1]` 같은 인덱스를 가정하지 않는다.

## 13. 백업

OpenClaw 업데이트 전이나 설정을 크게 바꾼 뒤에만 수행한다.

```powershell
$backupDirectory = Join-Path $env:USERPROFILE 'OpenClaw-Backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
Set-Location $backupDirectory
& $openclawCli backup create --verify --no-include-workspace
```

백업에는 설정·인증 프로필·세션·채널 자격 증명이 포함될 수 있다. Git에 커밋하거나 공유하지 않는다.

## 14. 최소 일일 체크리스트

1. Docker Desktop 실행
2. `docker version`에서 `Server` 확인
3. Gateway `running`·probe 정상 확인
4. Telegram `connected`·`works` 확인
5. Skill Ready 확인
6. PriceTrace 서버를 `0.0.0.0`으로 실행하고 창 유지
7. Telegram `/new`
8. Skill로 상품 한 건 조사
9. 상품 코드와 모든 값을 검토
10. 한 건만 승인
11. 저장 결과 재조회
12. 다음 상품으로 자동 진행하지 않았는지 확인

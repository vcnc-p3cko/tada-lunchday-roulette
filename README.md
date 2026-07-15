# 타다 유틸리티

VCNC 내부에서 쓰는 유틸리티 페이지 모음입니다. 첫 화면(`/`)에서 원하는 도구를 선택해 진입합니다.

| 경로 | 도구 | 설명 |
| --- | --- | --- |
| `/` | 유틸리티 허브 | 도구 선택 랜딩 페이지 |
| `/roulette` | 타다 룰렛 | 런치데이 팀 편성 · 뽑기 구슬 레이스 (`lazygyu/roulette` 기반) |
| `/vote` | 타다 투표 | 투표 생성 · 링크 공유 · 실시간 결과 확인 |

## 타다 투표

투표 라이프사이클: **세팅(대기 중) → 시작(진행 중, 타이머) → 마감(최종 순위)**

- 관리자가 "새 투표 만들기" 모달에서 주제와 항목 리스트를 세팅합니다. 각 항목에 이름(필수), 설명, 사진, **투표 제한**을 넣을 수 있습니다.
- **투표자 이름은 필수**입니다. 이름을 입력하지 않으면 투표할 수 없으며(취소는 가능), 서버에서도 검증합니다.
- **투표 제한**: 항목에 이름을 지정하면, 같은 이름을 입력한 투표자는 그 항목에 투표할 수 없습니다(본인 항목 투표 방지). 공백/대소문자를 무시하고 비교하며 서버에서도 검증합니다.
- 사진이 있는 항목은 사진이 메인 콘텐츠로, 카드 상단에 16:9로 크게 표시됩니다.
- 1인당 투표 수(1~10)와 진행 시간(분)을 설정할 수 있습니다.
- **참여 링크**(`?poll=<id>&view=vote`)는 투표 전용 화면입니다 — 세팅/목록/관리 버튼 없이 투표 UI만 모바일 친화적으로 표시됩니다. "참여 링크 복사" 버튼이 이 링크를 복사합니다.
- 만든 직후는 `대기 중` 상태로, 링크를 공유해도 아직 투표할 수 없습니다.
- 관리자가 **투표 시작**을 누르면 그 순간부터 타이머가 돌아가고, 시간이 다 되면 서버가 자동으로 마감합니다(조기 마감도 가능).
- **대시보드**(`?poll=<id>&board=1`)는 전체화면 라이브 순위 보드입니다. 실시간 카운트, 순위 변동 애니메이션, 카운트다운이 표시되고, 마감되면 최종 순위(1위 👑)로 전환됩니다. 프로젝터 화면에 띄워두는 용도입니다.
- 결과는 SSE(`/api/vote-events`)로 모든 참여자 화면에 실시간 반영됩니다.
- 시작/마감 권한은 투표 생성자에게만 있습니다(브라우저에 admin 토큰 저장).
- 서버 API가 없는 환경(GitHub Pages, 순수 `parcel dev`)에서는 **로컬 모드**로 자동 전환되어, 같은 브라우저의 탭 간에만 공유됩니다.
- 투표 데이터와 업로드 이미지는 서버 메모리에만 저장됩니다. Cloud Run 배포 시 `--max-instances 1`을 권장합니다(인스턴스 간 상태 공유 없음, 재시작 시 초기화).

### 투표 페이지 기술 스택

- 투표 페이지(`/vote`)는 **React 19 + Astryx 디자인 시스템**(`@astryxdesign/core`, comfyride-console과 동일)으로 작성되어 있습니다. 룰렛/허브 페이지는 기존 vanilla TS + SCSS를 유지합니다.
- Astryx는 프리컴파일된 dist가 `react/jsx-dev-runtime`(jsxDEV)을 참조하는데 React 19 프로덕션 번들에는 jsxDEV가 없어, `src/jsxDevRuntimeShim.js`를 package.json `alias`로 연결해 프로덕션 `jsx/jsxs`로 위임합니다.
- Parcel에서 Astryx의 package `exports` 서브패스를 읽도록 package.json에 `@parcel/resolver-default.packageExports: true`가 설정되어 있습니다.
- 컴포넌트 문서는 `node node_modules/@astryxdesign/core/docs.mjs <Component>`로 조회할 수 있습니다.

## 타다 룰렛 핵심 기능

- 직원 이름/팀 환경설정 로딩
- 시트 복사 붙여넣기용 직원 명단 입력
- 직원 1인당 구슬 1개 생성
- 참여자 선택 후 구슬 레이스 시작
- `런치데이` 모드: 완주 순서대로 `A1 → B1 → C1 → A2` 방식의 라운드로빈 슬롯 편성
- `뽑기` 모드: 원하는 순위를 지정하고 완주 순서대로 결과 집계
- 같은 조직팀은 같은 공 색상 사용
- 완료된 결과를 Slack용 마크다운으로 복사
- Cloud Run 배포용 `Express + Dockerfile` 구성

## 런타임 설정

다음 세 방식 중 하나로 설정할 수 있습니다.

1. `APP_CONFIG_JSON` 환경변수
2. `EMPLOYEES_JSON` 환경변수
3. `config/employees.json` 파일

기본 예시는 `config/employees.example.json`에 들어 있습니다.

### `APP_CONFIG_JSON` 예시

```json
{
  "title": "타다 룰렛",
  "subtitle": "직원 한 명당 구슬 하나. 런치데이 팀 편성과 뽑기를 한 화면에서 진행합니다.",
  "organization": "타다",
  "slackChannelLabel": "#lunchday",
  "minTeamSize": 4,
  "maxTeamSize": 5,
  "employees": [
    { "id": "EMP-001", "name": "가은", "team": "Product" },
    { "id": "EMP-002", "name": "도윤", "team": "Product" }
  ]
}
```

## 로컬 실행

```bash
npm install
npm run build
npm run start
```

개발 프리뷰는 다음처럼 확인할 수 있습니다.

```bash
npm run dev
```

`npm run dev`에서 `/api/config`가 없으면 번들에 포함된 샘플 설정으로 동작합니다.

투표를 실시간 공유 모드로 개발하려면 API 서버를 함께 띄웁니다. `.proxyrc.json`이 `/api` 요청을 `localhost:8080`으로 프록시합니다.

```bash
npm run start   # 터미널 1: API 서버 (dist 필요, npm run build 선행)
npm run dev     # 터미널 2: 프론트 개발 서버 (localhost:1235)
```

## Cloud Run 배포

프로젝트 ID와 리전을 정한 뒤 아래 명령으로 배포할 수 있습니다.

```bash
gcloud run deploy tada-marble-roulette \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated
```

실제 직원 데이터를 환경변수로 넣고 싶다면 배포 시 함께 지정하면 됩니다.

```bash
gcloud run deploy tada-marble-roulette \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --set-env-vars APP_CONFIG_JSON='{"title":"타다 룰렛","organization":"타다","slackChannelLabel":"#lunchday","minTeamSize":4,"maxTeamSize":5,"employees":[{"id":"EMP-001","name":"가은","team":"Product"}]}',SLACK_WEBHOOK_URL='https://hooks.slack.com/services/XXX/YYY/ZZZ'
```

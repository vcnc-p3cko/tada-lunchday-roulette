# 타다 룰렛

`lazygyu/roulette`를 기반으로, TADA 내부 이벤트용으로 커스터마이즈한 Cloud Run 배포 대상 앱입니다.

## 핵심 기능

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

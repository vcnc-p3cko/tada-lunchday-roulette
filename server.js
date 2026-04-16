const fs = require('node:fs');
const path = require('node:path');

const express = require('express');

const app = express();
const port = Number(process.env.PORT || 8080);
const distDirectory = path.join(__dirname, 'dist');

app.use(express.json({ limit: '200kb' }));

app.get('/healthz', (_request, response) => {
  response.json({ ok: true, service: 'tada-marble-roulette' });
});

app.get('/api/config', (_request, response) => {
  try {
    response.json(loadRuntimeSettings().publicConfig);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : '설정 파일을 읽는 중 오류가 발생했습니다.',
    });
  }
});

app.post('/api/publish-results', async (request, response) => {
  try {
    const { slackWebhookUrl } = loadRuntimeSettings();
    if (!slackWebhookUrl) {
      response.status(400).json({ error: 'Slack webhook 설정이 없습니다.' });
      return;
    }

    const message = buildSlackMessage(request.body);
    const slackResponse = await fetch(slackWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });

    if (!slackResponse.ok) {
      const errorText = await slackResponse.text();
      throw new Error(`Slack webhook 호출 실패 (${slackResponse.status}): ${errorText}`);
    }

    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Slack 게시 중 오류가 발생했습니다.',
    });
  }
});

app.use(express.static(distDirectory, { extensions: ['html'] }));

app.get('*', (_request, response) => {
  response.sendFile(path.join(distDirectory, 'index.html'));
});

app.listen(port, () => {
  console.log(`tada-marble-roulette listening on :${port}`);
});

function loadRuntimeSettings() {
  if (process.env.APP_CONFIG_JSON) {
    return normalizeConfig(JSON.parse(process.env.APP_CONFIG_JSON), 'env:APP_CONFIG_JSON');
  }

  if (process.env.EMPLOYEES_JSON) {
    return normalizeConfig(
      {
        employees: JSON.parse(process.env.EMPLOYEES_JSON),
        maxTeamSize: process.env.MAX_TEAM_SIZE,
        minTeamSize: process.env.MIN_TEAM_SIZE,
        organization: process.env.ORGANIZATION,
        slackChannelLabel: process.env.SLACK_CHANNEL_LABEL,
        slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
        subtitle: process.env.APP_SUBTITLE,
        title: process.env.APP_TITLE,
      },
      'env:EMPLOYEES_JSON'
    );
  }

  const configuredPath = process.env.CONFIG_PATH ? path.resolve(process.env.CONFIG_PATH) : null;
  const candidatePaths = [
    configuredPath,
    path.join(__dirname, 'config', 'employees.json'),
    path.join(__dirname, 'config', 'employees.example.json'),
  ].filter(Boolean);

  for (const filePath of candidatePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizeConfig(raw, path.relative(process.cwd(), filePath));
  }

  throw new Error('환경설정을 찾을 수 없습니다. APP_CONFIG_JSON 또는 config/employees.json을 설정해주세요.');
}

function normalizeConfig(rawConfig, configSource) {
  const sourceEmployees = Array.isArray(rawConfig) ? rawConfig : rawConfig.employees;
  if (!Array.isArray(sourceEmployees) || !sourceEmployees.length) {
    throw new Error('employees 배열이 비어 있습니다.');
  }

  const employees = sourceEmployees.map((employee, index) => normalizeEmployee(employee, index));
  const slackWebhookUrl = normalizeString(process.env.SLACK_WEBHOOK_URL || rawConfig.slackWebhookUrl, '');
  const slackChannelLabel = normalizeString(process.env.SLACK_CHANNEL_LABEL || rawConfig.slackChannelLabel, '');

  return {
    publicConfig: {
      configSource,
      employees,
      maxTeamSize: normalizeNumber(rawConfig.maxTeamSize, 5),
      minTeamSize: normalizeNumber(rawConfig.minTeamSize, 4),
      organization: normalizeString(rawConfig.organization, '타다'),
      slackChannelLabel,
      slackEnabled: Boolean(slackWebhookUrl),
      subtitle: normalizeString(
        rawConfig.subtitle,
        '직원 한 명당 구슬 하나. 런치데이 팀 편성과 몇번째 뽑기를 한 화면에서 진행합니다.'
      ),
      title: normalizeString(rawConfig.title, '타다 룰렛'),
    },
    slackChannelLabel,
    slackWebhookUrl,
  };
}

function normalizeEmployee(rawEmployee, index) {
  const name = normalizeString(rawEmployee.name, '');
  if (!name) {
    throw new Error(`employees[${index}]의 name 값이 비어 있습니다.`);
  }

  const team = normalizeString(rawEmployee.team, '미지정 팀');
  const marbleLabel = buildMarbleLabel(name, team, rawEmployee.marbleLabel);

  return {
    enabled: rawEmployee.enabled !== false,
    id: normalizeString(rawEmployee.id, `EMP-${String(index + 1).padStart(3, '0')}`),
    marbleLabel,
    name,
    team,
  };
}

function buildMarbleLabel(name, team, explicitLabel) {
  const candidate = normalizeString(explicitLabel, '') || name;
  return candidate.replaceAll('/', '·').replaceAll('*', '•');
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeString(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function buildSlackMessage(payload) {
  const title = normalizeString(payload?.title, '타다 룰렛 결과');
  const organization = normalizeString(payload?.organization, '타다');
  const teams = Array.isArray(payload?.teams) ? payload.teams : [];

  if (!teams.length) {
    throw new Error('게시할 팀 결과가 없습니다.');
  }

  const lines = [`${title}`, `${organization} 런치데이 결과`];

  teams.forEach((team) => {
    const teamLabel = normalizeString(team?.teamLabel, '런치팀');
    lines.push('');
    lines.push(`[${teamLabel}]`);

    const members = Array.isArray(team?.members) ? team.members : [];
    if (!members.length) {
      lines.push('- 대기 중');
      return;
    }

    members.forEach((member) => {
      const name = normalizeString(member?.name, '이름 미지정');
      const memberTeam = normalizeString(member?.team, '미지정 팀');
      lines.push(`- ${name} | ${memberTeam}`);
    });
  });

  return lines.join('\n');
}

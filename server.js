const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const express = require('express');

const app = express();
const port = Number(process.env.PORT || 8080);
const distDirectory = path.join(__dirname, 'dist');

app.use(express.json({ limit: '8mb' }));

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

// ---------------------------------------------------------------------------
// 투표 API (in-memory 저장 — Cloud Run에서는 max-instances=1 권장)
// 라이프사이클: draft(세팅) → open(시작, 타이머 진행) → closed(마감)
// ---------------------------------------------------------------------------

const MAX_POLLS = 200;
const MAX_UPLOADS = 400;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const polls = new Map();
const uploads = new Map();
const pollTimers = new Map();
const voteEventClients = new Set();

app.post('/api/uploads', (request, response) => {
  const dataUrl = typeof request.body?.dataUrl === 'string' ? request.body.dataUrl : '';
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    response.status(400).json({ error: '이미지 데이터 형식이 올바르지 않습니다.' });
    return;
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    response.status(400).json({ error: '이미지는 3MB 이하만 업로드할 수 있습니다.' });
    return;
  }

  if (uploads.size >= MAX_UPLOADS) {
    uploads.delete(uploads.keys().next().value);
  }

  const imageId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  uploads.set(imageId, { buffer, mime: match[1] });
  response.status(201).json({ imageId, imageUrl: `/api/uploads/${imageId}` });
});

app.get('/api/uploads/:imageId', (request, response) => {
  const upload = uploads.get(request.params.imageId);
  if (!upload) {
    response.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
    return;
  }
  response.set('content-type', upload.mime);
  response.set('cache-control', 'public, max-age=86400, immutable');
  response.send(upload.buffer);
});

app.get('/api/polls', (_request, response) => {
  polls.forEach((poll) => finalizePollIfDue(poll));
  response.json({ polls: [...polls.values()].map(toPublicPoll) });
});

app.post('/api/polls', (request, response) => {
  try {
    const title = normalizeString(request.body?.title, '');
    const rawItems = Array.isArray(request.body?.items) ? request.body.items : [];
    const items = [];
    rawItems.slice(0, 30).forEach((rawItem) => {
      const itemTitle = normalizeString(rawItem?.title, '');
      if (!itemTitle) {
        return;
      }
      const imageId = normalizeString(rawItem?.imageId, '');
      items.push({
        description: normalizeString(rawItem?.description, '').slice(0, 300),
        id: `i-${items.length + 1}`,
        imageUrl: imageId && uploads.has(imageId) ? `/api/uploads/${imageId}` : null,
        restriction: normalizeString(rawItem?.restriction, '').slice(0, 30),
        title: itemTitle.slice(0, 80),
      });
    });

    if (!title) {
      response.status(400).json({ error: '투표 주제를 입력해주세요.' });
      return;
    }
    if (items.length < 2) {
      response.status(400).json({ error: '항목을 2개 이상 입력해주세요.' });
      return;
    }

    const poll = {
      adminToken: crypto.randomUUID(),
      ballots: new Map(),
      closedAt: null,
      closesAt: null,
      createdAt: new Date().toISOString(),
      durationSeconds: clampInt(request.body?.durationSeconds, 30, 7200, 300),
      id: `p-${crypto.randomUUID().slice(0, 13)}`,
      items,
      maxChoices: clampInt(request.body?.maxChoices, 1, Math.min(10, items.length), 1),
      startedAt: null,
      status: 'draft',
      title: title.slice(0, 120),
    };

    polls.set(poll.id, poll);
    evictOldPolls();
    broadcastVoteEvent('poll-created', poll);
    response.status(201).json({ adminToken: poll.adminToken, poll: toPublicPoll(poll) });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : '투표 생성에 실패했습니다.' });
  }
});

app.get('/api/polls/:pollId', (request, response) => {
  const poll = polls.get(request.params.pollId);
  if (!poll) {
    response.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    return;
  }
  finalizePollIfDue(poll);
  response.json({ poll: toPublicPoll(poll) });
});

app.post('/api/polls/:pollId/start', (request, response) => {
  const poll = polls.get(request.params.pollId);
  if (!poll) {
    response.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    return;
  }
  if (normalizeString(request.body?.adminToken, '') !== poll.adminToken) {
    response.status(403).json({ error: '투표를 시작할 권한이 없습니다.' });
    return;
  }
  if (poll.status !== 'draft') {
    response.status(409).json({ error: '이미 시작되었거나 마감된 투표입니다.' });
    return;
  }

  const now = Date.now();
  poll.status = 'open';
  poll.startedAt = new Date(now).toISOString();
  poll.closesAt = new Date(now + poll.durationSeconds * 1000).toISOString();
  pollTimers.set(
    poll.id,
    setTimeout(() => finalizePollIfDue(poll), poll.durationSeconds * 1000 + 200)
  );

  broadcastVoteEvent('poll-updated', poll);
  response.json({ poll: toPublicPoll(poll) });
});

app.post('/api/polls/:pollId/vote', (request, response) => {
  const poll = polls.get(request.params.pollId);
  if (!poll) {
    response.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    return;
  }

  finalizePollIfDue(poll);
  if (poll.status === 'draft') {
    response.status(409).json({ error: '아직 시작되지 않은 투표입니다.' });
    return;
  }
  if (poll.status === 'closed') {
    response.status(409).json({ error: '이미 마감된 투표입니다.' });
    return;
  }

  const voterId = normalizeString(request.body?.voterId, '');
  if (!voterId) {
    response.status(400).json({ error: 'voterId가 필요합니다.' });
    return;
  }

  const validItemIds = new Set(poll.items.map((item) => item.id));
  const rawItemIds = Array.isArray(request.body?.itemIds) ? request.body.itemIds : [];
  const itemIds = [...new Set(rawItemIds)].filter((itemId) => validItemIds.has(itemId));

  if (itemIds.length > poll.maxChoices) {
    response.status(400).json({ error: `1인당 최대 ${poll.maxChoices}개까지 투표할 수 있습니다.` });
    return;
  }

  const voterName = normalizeString(request.body?.voterName, '').slice(0, 30);
  if (itemIds.length && !voterName) {
    response.status(400).json({ error: '투표자 이름을 입력해주세요.' });
    return;
  }

  const restrictedItem = poll.items.find(
    (item) => itemIds.includes(item.id) && isRestrictedVoter(item.restriction, voterName)
  );
  if (restrictedItem) {
    response.status(403).json({ error: `"${restrictedItem.title}" 항목에는 투표할 수 없습니다.` });
    return;
  }

  if (itemIds.length) {
    poll.ballots.set(voterId, {
      itemIds,
      voterName,
    });
  } else {
    poll.ballots.delete(voterId);
  }

  broadcastVoteEvent('poll-updated', poll);
  response.json({ poll: toPublicPoll(poll) });
});

app.post('/api/polls/:pollId/close', (request, response) => {
  const poll = polls.get(request.params.pollId);
  if (!poll) {
    response.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    return;
  }
  if (normalizeString(request.body?.adminToken, '') !== poll.adminToken) {
    response.status(403).json({ error: '마감 권한이 없습니다.' });
    return;
  }

  if (poll.status !== 'closed') {
    closePollNow(poll);
  }
  response.json({ poll: toPublicPoll(poll) });
});

app.get('/api/vote-events', (request, response) => {
  response.writeHead(200, {
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  });
  response.write(': connected\n\n');

  voteEventClients.add(response);
  const heartbeat = setInterval(() => response.write(': ping\n\n'), 25000);

  request.on('close', () => {
    clearInterval(heartbeat);
    voteEventClients.delete(response);
  });
});

app.use(express.static(distDirectory, { extensions: ['html'] }));

app.get('*', (_request, response) => {
  response.sendFile(path.join(distDirectory, 'index.html'));
});

app.listen(port, () => {
  console.log(`tada-marble-roulette listening on :${port}`);
});

function toPublicPoll(poll) {
  const votersByItem = new Map();
  poll.ballots.forEach((ballot) => {
    ballot.itemIds.forEach((itemId) => {
      const voters = votersByItem.get(itemId) || [];
      voters.push(ballot.voterName || '익명');
      votersByItem.set(itemId, voters);
    });
  });

  return {
    closedAt: poll.closedAt,
    closesAt: poll.closesAt,
    createdAt: poll.createdAt,
    durationSeconds: poll.durationSeconds,
    id: poll.id,
    items: poll.items.map((item) => ({
      count: (votersByItem.get(item.id) || []).length,
      description: item.description,
      id: item.id,
      imageUrl: item.imageUrl,
      restriction: item.restriction || '',
      title: item.title,
      voters: votersByItem.get(item.id) || [],
    })),
    maxChoices: poll.maxChoices,
    serverNow: new Date().toISOString(),
    startedAt: poll.startedAt,
    status: poll.status,
    title: poll.title,
    totalVoters: poll.ballots.size,
  };
}

function finalizePollIfDue(poll) {
  if (poll.status === 'open' && poll.closesAt && Date.now() >= Date.parse(poll.closesAt)) {
    closePollNow(poll, poll.closesAt);
  }
}

function closePollNow(poll, closedAtIso) {
  poll.status = 'closed';
  poll.closedAt = closedAtIso || new Date().toISOString();

  const timer = pollTimers.get(poll.id);
  if (timer) {
    clearTimeout(timer);
    pollTimers.delete(poll.id);
  }

  broadcastVoteEvent('poll-updated', poll);
}

function isRestrictedVoter(restriction, voterName) {
  const normalizedRestriction = normalizeString(restriction, '').replace(/\s+/g, '').toLowerCase();
  const normalizedVoter = normalizeString(voterName, '').replace(/\s+/g, '').toLowerCase();
  return Boolean(normalizedRestriction) && normalizedRestriction === normalizedVoter;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function broadcastVoteEvent(type, poll) {
  const payload = `data: ${JSON.stringify({ poll: toPublicPoll(poll), type })}\n\n`;
  voteEventClients.forEach((client) => {
    try {
      client.write(payload);
    } catch {
      voteEventClients.delete(client);
    }
  });
}

function evictOldPolls() {
  if (polls.size <= MAX_POLLS) {
    return;
  }

  const sorted = [...polls.values()].sort((a, b) => {
    const aClosed = a.closedAt ? 0 : 1;
    const bClosed = b.closedAt ? 0 : 1;
    if (aClosed !== bClosed) {
      return aClosed - bClosed;
    }
    return a.createdAt.localeCompare(b.createdAt);
  });

  while (polls.size > MAX_POLLS && sorted.length) {
    const evicted = sorted.shift();
    const timer = pollTimers.get(evicted.id);
    if (timer) {
      clearTimeout(timer);
      pollTimers.delete(evicted.id);
    }
    polls.delete(evicted.id);
  }
}

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
        '직원 한 명당 구슬 하나. 런치데이 팀 편성과 뽑기를 한 화면에서 진행합니다.'
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
  const teams = Array.isArray(payload?.teams) ? payload.teams : [];

  if (!teams.length) {
    throw new Error('게시할 팀 결과가 없습니다.');
  }

  const lines = [`*${formatKstDate(new Date())} 런치데이 조편성 안내*`, ''];

  teams.forEach((team) => {
    const teamLabel = normalizeString(team?.teamCode, team?.teamLabel || '팀').replace('TEAM-', '팀');
    const members = Array.isArray(team?.members) ? team.members : [];
    if (!members.length) {
      lines.push(`*${teamLabel}* : 대기 중`);
      return;
    }

    const memberNames = members.map((member) => normalizeString(member?.name, '이름 미지정')).join(', ');
    lines.push(`*${teamLabel}* : ${memberNames}`);
  });

  return lines.join('\n');
}

function formatKstDate(date) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Seoul',
    year: 'numeric',
  }).formatToParts(date);
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

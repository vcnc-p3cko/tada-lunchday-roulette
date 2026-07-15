export type PollStatus = 'draft' | 'open' | 'closed';

export interface PublicPollItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  /** 이 이름과 같은 투표자는 해당 항목에 투표할 수 없다 (빈 문자열이면 제한 없음). */
  restriction: string;
  count: number;
  voters: string[];
}

export function isRestrictedVoter(restriction: string, voterName: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, '').toLowerCase();
  const normalizedRestriction = normalize(restriction || '');
  return Boolean(normalizedRestriction) && normalizedRestriction === normalize(voterName || '');
}

export interface PublicPoll {
  id: string;
  title: string;
  status: PollStatus;
  maxChoices: number;
  durationSeconds: number;
  createdAt: string;
  startedAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  serverNow?: string;
  totalVoters: number;
  items: PublicPollItem[];
}

export interface CreatePollItemInput {
  title: string;
  description: string;
  restriction: string;
  imageDataUrl: string | null;
}

export interface CreatePollInput {
  title: string;
  maxChoices: number;
  durationSeconds: number;
  items: CreatePollItemInput[];
}

export interface VoteInput {
  voterId: string;
  voterName: string;
  itemIds: string[];
}

export type VoteStoreEvent = { type: 'poll-updated' | 'poll-created'; poll: PublicPoll };

export interface VoteStore {
  readonly mode: 'server' | 'local';
  createPoll(input: CreatePollInput): Promise<{ poll: PublicPoll; adminToken: string }>;
  listPolls(): Promise<PublicPoll[]>;
  getPoll(pollId: string): Promise<PublicPoll | null>;
  startPoll(pollId: string, adminToken: string): Promise<PublicPoll>;
  vote(pollId: string, input: VoteInput): Promise<PublicPoll>;
  closePoll(pollId: string, adminToken: string): Promise<PublicPoll>;
  subscribe(listener: (event: VoteStoreEvent) => void): () => void;
}

const LOCAL_POLLS_KEY = 'tada-vote-local-polls-v2';
const LOCAL_CHANNEL_NAME = 'tada-vote-local';

const STATUS_ORDER: Record<PollStatus, number> = { closed: 2, draft: 1, open: 0 };

export function sortPolls(polls: PublicPoll[]): PublicPoll[] {
  return [...polls].sort((a, b) => {
    if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) {
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('서버 응답이 JSON이 아닙니다.');
  }

  const body = await response.json();
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `요청 실패 (${response.status})`);
  }
  return body as T;
}

function postJson<T>(url: string, payload: unknown): Promise<T> {
  return requestJson<T>(url, {
    body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

class ServerVoteStore implements VoteStore {
  readonly mode = 'server' as const;

  async createPoll(input: CreatePollInput) {
    const items = await Promise.all(
      input.items.map(async (item) => {
        let imageId: string | null = null;
        if (item.imageDataUrl) {
          const uploaded = await postJson<{ imageId: string }>('/api/uploads', { dataUrl: item.imageDataUrl });
          imageId = uploaded.imageId;
        }
        return { description: item.description, imageId, restriction: item.restriction, title: item.title };
      })
    );

    return postJson<{ poll: PublicPoll; adminToken: string }>('/api/polls', {
      durationSeconds: input.durationSeconds,
      items,
      maxChoices: input.maxChoices,
      title: input.title,
    });
  }

  async listPolls() {
    const body = await requestJson<{ polls: PublicPoll[] }>('/api/polls');
    return sortPolls(body.polls);
  }

  async getPoll(pollId: string) {
    try {
      const body = await requestJson<{ poll: PublicPoll }>(`/api/polls/${encodeURIComponent(pollId)}`);
      return body.poll;
    } catch {
      return null;
    }
  }

  async startPoll(pollId: string, adminToken: string) {
    const body = await postJson<{ poll: PublicPoll }>(`/api/polls/${encodeURIComponent(pollId)}/start`, {
      adminToken,
    });
    return body.poll;
  }

  async vote(pollId: string, input: VoteInput) {
    const body = await postJson<{ poll: PublicPoll }>(`/api/polls/${encodeURIComponent(pollId)}/vote`, input);
    return body.poll;
  }

  async closePoll(pollId: string, adminToken: string) {
    const body = await postJson<{ poll: PublicPoll }>(`/api/polls/${encodeURIComponent(pollId)}/close`, {
      adminToken,
    });
    return body.poll;
  }

  subscribe(listener: (event: VoteStoreEvent) => void) {
    const source = new EventSource('/api/vote-events');
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as VoteStoreEvent;
        if (event?.poll) {
          listener(event);
        }
      } catch {
        // 형식이 어긋난 이벤트는 무시합니다.
      }
    };
    return () => source.close();
  }
}

interface LocalStoredPoll {
  id: string;
  title: string;
  status: PollStatus;
  maxChoices: number;
  durationSeconds: number;
  createdAt: string;
  startedAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  adminToken: string;
  items: { id: string; title: string; description: string; restriction: string; imageUrl: string | null }[];
  ballots: Record<string, { voterName: string; itemIds: string[] }>;
}

class LocalVoteStore implements VoteStore {
  readonly mode = 'local' as const;
  private channel: BroadcastChannel | null =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(LOCAL_CHANNEL_NAME);

  private readAll(): Record<string, LocalStoredPoll> {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_POLLS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  private writeAll(polls: Record<string, LocalStoredPoll>) {
    localStorage.setItem(LOCAL_POLLS_KEY, JSON.stringify(polls));
  }

  private finalizeIfDue(stored: LocalStoredPoll): boolean {
    if (stored.status === 'open' && stored.closesAt && Date.now() >= Date.parse(stored.closesAt)) {
      stored.status = 'closed';
      stored.closedAt = stored.closesAt;
      return true;
    }
    return false;
  }

  private toPublic(stored: LocalStoredPoll): PublicPoll {
    const votersByItem = new Map<string, string[]>();
    Object.values(stored.ballots).forEach((ballot) => {
      ballot.itemIds.forEach((itemId) => {
        const voters = votersByItem.get(itemId) || [];
        voters.push(ballot.voterName || '익명');
        votersByItem.set(itemId, voters);
      });
    });

    return {
      closedAt: stored.closedAt,
      closesAt: stored.closesAt,
      createdAt: stored.createdAt,
      durationSeconds: stored.durationSeconds,
      id: stored.id,
      items: stored.items.map((item) => ({
        count: (votersByItem.get(item.id) || []).length,
        description: item.description,
        id: item.id,
        imageUrl: item.imageUrl,
        restriction: item.restriction || '',
        title: item.title,
        voters: votersByItem.get(item.id) || [],
      })),
      maxChoices: stored.maxChoices,
      serverNow: new Date().toISOString(),
      startedAt: stored.startedAt,
      status: stored.status,
      title: stored.title,
      totalVoters: Object.keys(stored.ballots).length,
    };
  }

  private broadcast(event: VoteStoreEvent) {
    this.channel?.postMessage(event);
  }

  async createPoll(input: CreatePollInput) {
    const polls = this.readAll();
    const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const adminToken = `t-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    const stored: LocalStoredPoll = {
      adminToken,
      ballots: {},
      closedAt: null,
      closesAt: null,
      createdAt: new Date().toISOString(),
      durationSeconds: input.durationSeconds,
      id,
      items: input.items.map((item, index) => ({
        description: item.description,
        id: `i-${index + 1}`,
        imageUrl: item.imageDataUrl,
        restriction: item.restriction,
        title: item.title,
      })),
      maxChoices: input.maxChoices,
      startedAt: null,
      status: 'draft',
      title: input.title,
    };
    polls[id] = stored;
    this.writeAll(polls);

    const poll = this.toPublic(stored);
    this.broadcast({ poll, type: 'poll-created' });
    return { adminToken, poll };
  }

  async listPolls() {
    const polls = this.readAll();
    let changed = false;
    Object.values(polls).forEach((stored) => {
      changed = this.finalizeIfDue(stored) || changed;
    });
    if (changed) {
      this.writeAll(polls);
    }
    return sortPolls(Object.values(polls).map((stored) => this.toPublic(stored)));
  }

  async getPoll(pollId: string) {
    const polls = this.readAll();
    const stored = polls[pollId];
    if (!stored) {
      return null;
    }
    if (this.finalizeIfDue(stored)) {
      this.writeAll(polls);
      this.broadcast({ poll: this.toPublic(stored), type: 'poll-updated' });
    }
    return this.toPublic(stored);
  }

  async startPoll(pollId: string, adminToken: string) {
    const polls = this.readAll();
    const stored = polls[pollId];
    if (!stored) {
      throw new Error('투표를 찾을 수 없습니다.');
    }
    if (stored.adminToken !== adminToken) {
      throw new Error('투표를 시작할 권한이 없습니다.');
    }
    if (stored.status !== 'draft') {
      throw new Error('이미 시작되었거나 마감된 투표입니다.');
    }

    const now = Date.now();
    stored.status = 'open';
    stored.startedAt = new Date(now).toISOString();
    stored.closesAt = new Date(now + stored.durationSeconds * 1000).toISOString();
    this.writeAll(polls);

    const poll = this.toPublic(stored);
    this.broadcast({ poll, type: 'poll-updated' });
    return poll;
  }

  async vote(pollId: string, input: VoteInput) {
    const polls = this.readAll();
    const stored = polls[pollId];
    if (!stored) {
      throw new Error('투표를 찾을 수 없습니다.');
    }
    this.finalizeIfDue(stored);
    if (stored.status === 'draft') {
      throw new Error('아직 시작되지 않은 투표입니다.');
    }
    if (stored.status === 'closed') {
      throw new Error('이미 마감된 투표입니다.');
    }

    const validIds = new Set(stored.items.map((item) => item.id));
    const itemIds = [...new Set(input.itemIds)].filter((itemId) => validIds.has(itemId));
    if (itemIds.length > stored.maxChoices) {
      throw new Error(`1인당 최대 ${stored.maxChoices}개까지 투표할 수 있습니다.`);
    }
    if (itemIds.length && !input.voterName.trim()) {
      throw new Error('투표자 이름을 입력해주세요.');
    }

    const restrictedItem = stored.items.find(
      (item) => itemIds.includes(item.id) && isRestrictedVoter(item.restriction || '', input.voterName)
    );
    if (restrictedItem) {
      throw new Error(`"${restrictedItem.title}" 항목에는 투표할 수 없습니다.`);
    }

    if (itemIds.length) {
      stored.ballots[input.voterId] = { itemIds, voterName: input.voterName };
    } else {
      delete stored.ballots[input.voterId];
    }
    this.writeAll(polls);

    const poll = this.toPublic(stored);
    this.broadcast({ poll, type: 'poll-updated' });
    return poll;
  }

  async closePoll(pollId: string, adminToken: string) {
    const polls = this.readAll();
    const stored = polls[pollId];
    if (!stored) {
      throw new Error('투표를 찾을 수 없습니다.');
    }
    if (stored.adminToken !== adminToken) {
      throw new Error('마감 권한이 없습니다.');
    }

    if (stored.status !== 'closed') {
      stored.status = 'closed';
      stored.closedAt = new Date().toISOString();
    }
    this.writeAll(polls);

    const poll = this.toPublic(stored);
    this.broadcast({ poll, type: 'poll-updated' });
    return poll;
  }

  subscribe(listener: (event: VoteStoreEvent) => void) {
    const onChannelMessage = (message: MessageEvent) => {
      const event = message.data as VoteStoreEvent;
      if (event?.poll) {
        listener(event);
      }
    };
    const onStorage = async (event: StorageEvent) => {
      if (event.key !== LOCAL_POLLS_KEY) {
        return;
      }
      const polls = await this.listPolls();
      polls.forEach((poll) => listener({ poll, type: 'poll-updated' }));
    };

    this.channel?.addEventListener('message', onChannelMessage);
    window.addEventListener('storage', onStorage);
    return () => {
      this.channel?.removeEventListener('message', onChannelMessage);
      window.removeEventListener('storage', onStorage);
    };
  }
}

export async function createVoteStore(): Promise<VoteStore> {
  try {
    const response = await fetch('/api/polls', { method: 'GET' });
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('application/json')) {
      return new ServerVoteStore();
    }
  } catch {
    // 서버 API가 없으면 로컬 모드로 내려갑니다.
  }
  return new LocalVoteStore();
}

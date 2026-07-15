import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Heading } from '@astryxdesign/core/Heading';
import { Item } from '@astryxdesign/core/Item';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Section } from '@astryxdesign/core/Section';
import { SelectableCard } from '@astryxdesign/core/SelectableCard';
import { HStack, Stack, StackItem } from '@astryxdesign/core/Stack';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { useToast } from '@astryxdesign/core/Toast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { VoteBoard } from './VoteBoard';
import {
  type CreatePollItemInput,
  createVoteStore,
  isRestrictedVoter,
  type PublicPoll,
  sortPolls,
  type VoteStore,
} from './voteStore';

const VOTER_ID_KEY = 'tada-vote-voter-id';
const VOTER_NAME_KEY = 'tada-vote-voter-name';
const ADMIN_TOKENS_KEY = 'tada-vote-admin-tokens';
const MY_BALLOTS_KEY = 'tada-vote-my-ballots';
const IMAGE_MAX_DIMENSION = 1200;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function ensureVoterId(): string {
  let voterId = localStorage.getItem(VOTER_ID_KEY);
  if (!voterId) {
    voterId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(VOTER_ID_KEY, voterId);
  }
  return voterId;
}

function formatDateTime(isoText: string): string {
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) {
    return isoText;
  }
  return new Intl.DateTimeFormat('ko-KR', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'long',
  }).format(date);
}

export function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function statusLabel(poll: PublicPoll): string {
  if (poll.status === 'draft') {
    return '대기 중';
  }
  return poll.status === 'open' ? '진행 중' : '마감됨';
}

function PollStatus({ poll }: { poll: PublicPoll }) {
  const label = statusLabel(poll);
  return (
    <HStack gap={1} vAlign="center">
      <StatusDot
        variant={poll.status === 'open' ? 'success' : poll.status === 'draft' ? 'neutral' : 'error'}
        label={label}
        isPulsing={poll.status === 'open'}
      />
      <Text type="supporting">{label}</Text>
    </HStack>
  );
}

async function readImageAsDataUrl(file: File): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('이미지 형식을 해석하지 못했습니다.'));
    element.src = rawDataUrl;
  });

  const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    return rawDataUrl;
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

interface EditorItem {
  key: number;
  title: string;
  description: string;
  restriction: string;
  imageDataUrl: string | null;
}

let editorKeySequence = 0;
function newEditorItem(): EditorItem {
  editorKeySequence += 1;
  return { description: '', imageDataUrl: null, key: editorKeySequence, restriction: '', title: '' };
}

export function VoteApp() {
  const toast = useToast();
  const voterId = useMemo(ensureVoterId, []);
  const [store, setStore] = useState<VoteStore | null>(null);
  const [polls, setPolls] = useState<Map<string, PublicPoll>>(new Map());
  // URL 동기화 effect가 첫 렌더에서 파라미터를 지우기 전에, 딥링크는 초기 상태로 캡처한다.
  const [selectedPollId, setSelectedPollId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('poll')
  );
  const [boardOpen, setBoardOpen] = useState(() => new URLSearchParams(window.location.search).get('board') === '1');
  // 참여자 전용 뷰: 공유 링크(?view=vote)로 진입한 모바일 투표 화면. 세팅/목록/관리 기능을 숨긴다.
  const [participantView] = useState(() => new URLSearchParams(window.location.search).get('view') === 'vote');
  const [createOpen, setCreateOpen] = useState(false);
  const [voterName, setVoterName] = useState(() => localStorage.getItem(VOTER_NAME_KEY) || '');
  const [adminTokens, setAdminTokens] = useState<Record<string, string>>(() => readJson(ADMIN_TOKENS_KEY, {}));
  const [myBallots, setMyBallots] = useState<Record<string, string[]>>(() => readJson(MY_BALLOTS_KEY, {}));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const clockOffsetRef = useRef(0);
  const dueSyncRef = useRef(false);

  const [formTitle, setFormTitle] = useState('');
  const [formItems, setFormItems] = useState<EditorItem[]>(() => [newEditorItem(), newEditorItem()]);
  const [formMaxChoices, setFormMaxChoices] = useState(1);
  const [formDurationMinutes, setFormDurationMinutes] = useState(5);
  const [creating, setCreating] = useState(false);

  const notify = useCallback((body: string, type: 'info' | 'error' = 'info') => toast({ body, type }), [toast]);

  const applyPollUpdate = useCallback((poll: PublicPoll, storeMode: 'server' | 'local') => {
    if (poll.serverNow && storeMode === 'server') {
      clockOffsetRef.current = Date.parse(poll.serverNow) - Date.now();
    }
    setPolls((previous) => {
      const next = new Map(previous);
      next.set(poll.id, poll);
      return next;
    });
  }, []);

  // 스토어 초기화 + SSE 구독 + 딥링크(?poll=) 보강
  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;

    void createVoteStore().then(async (created) => {
      if (cancelled) {
        return;
      }
      setStore(created);
      unsubscribe = created.subscribe((event) => applyPollUpdate(event.poll, created.mode));

      try {
        const list = await created.listPolls();
        if (cancelled) {
          return;
        }
        if (list[0]?.serverNow && created.mode === 'server') {
          clockOffsetRef.current = Date.parse(list[0].serverNow) - Date.now();
        }
        setPolls(new Map(list.map((poll) => [poll.id, poll])));

        // 딥링크로 들어온 투표가 목록에 없으면 단건 조회로 보강한다.
        setSelectedPollId((requested) => {
          if (requested && !list.some((poll) => poll.id === requested)) {
            void created.getPoll(requested).then((fetched) => {
              if (fetched) {
                applyPollUpdate(fetched, created.mode);
              } else {
                notify('해당 투표를 찾을 수 없습니다.', 'error');
                setSelectedPollId(null);
                setBoardOpen(false);
              }
            });
          }
          return requested;
        });
      } catch (error) {
        notify(error instanceof Error ? error.message : '투표 목록을 불러오지 못했습니다.', 'error');
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applyPollUpdate, notify]);

  // 카운트다운 틱
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const selectedPoll = selectedPollId ? (polls.get(selectedPollId) ?? null) : null;
  const now = nowMs + clockOffsetRef.current;
  const remainingMs =
    selectedPoll?.status === 'open' && selectedPoll.closesAt ? Date.parse(selectedPoll.closesAt) - now : null;

  // 타이머 만료 시 상태 재동기화 (서버 자동 마감 반영)
  useEffect(() => {
    if (!store || !selectedPoll || remainingMs === null || remainingMs > 0 || dueSyncRef.current) {
      return;
    }
    dueSyncRef.current = true;
    void store.getPoll(selectedPoll.id).then((updated) => {
      dueSyncRef.current = false;
      if (updated) {
        applyPollUpdate(updated, store.mode);
      }
    });
  }, [store, selectedPoll, remainingMs, applyPollUpdate]);

  // URL 동기화
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedPollId) {
      url.searchParams.set('poll', selectedPollId);
    } else {
      url.searchParams.delete('poll');
    }
    if (boardOpen) {
      url.searchParams.set('board', '1');
    } else {
      url.searchParams.delete('board');
    }
    window.history.replaceState(null, '', url.toString());
  }, [selectedPollId, boardOpen]);

  const refreshPolls = useCallback(async () => {
    if (!store) {
      return;
    }
    try {
      const list = await store.listPolls();
      setPolls(new Map(list.map((poll) => [poll.id, poll])));
    } catch (error) {
      notify(error instanceof Error ? error.message : '투표 목록을 불러오지 못했습니다.', 'error');
    }
  }, [store, notify]);

  const createPoll = useCallback(async () => {
    if (!store) {
      return;
    }
    const items: CreatePollItemInput[] = formItems
      .map((item) => ({
        description: item.description.trim(),
        imageDataUrl: item.imageDataUrl,
        restriction: item.restriction.trim(),
        title: item.title.trim(),
      }))
      .filter((item) => item.title);

    if (!formTitle.trim()) {
      notify('투표 주제를 입력해주세요.', 'error');
      return;
    }
    if (items.length < 2) {
      notify('제목이 있는 항목을 2개 이상 입력해주세요.', 'error');
      return;
    }
    if (formMaxChoices > items.length) {
      notify('1인당 투표 수는 항목 수보다 클 수 없습니다.', 'error');
      return;
    }

    setCreating(true);
    try {
      const { poll, adminToken } = await store.createPoll({
        durationSeconds: Math.min(120, Math.max(1, formDurationMinutes)) * 60,
        items,
        maxChoices: Math.min(10, Math.max(1, formMaxChoices)),
        title: formTitle.trim(),
      });
      const nextTokens = { ...adminTokens, [poll.id]: adminToken };
      setAdminTokens(nextTokens);
      writeJson(ADMIN_TOKENS_KEY, nextTokens);
      applyPollUpdate(poll, store.mode);
      setFormTitle('');
      setFormItems([newEditorItem(), newEditorItem()]);
      setFormMaxChoices(1);
      setFormDurationMinutes(5);
      setCreateOpen(false);
      setSelectedPollId(poll.id);
      notify('투표가 준비됐습니다. 참여 링크를 공유하고 "투표 시작"을 누르세요.');
    } catch (error) {
      notify(error instanceof Error ? error.message : '투표 생성에 실패했습니다.', 'error');
    } finally {
      setCreating(false);
    }
  }, [store, formItems, formTitle, formMaxChoices, formDurationMinutes, adminTokens, applyPollUpdate, notify]);

  const startPoll = useCallback(async () => {
    const adminToken = selectedPollId ? adminTokens[selectedPollId] : null;
    if (!store || !selectedPollId || !adminToken) {
      notify('이 투표를 시작할 권한이 없습니다.', 'error');
      return;
    }
    try {
      const updated = await store.startPoll(selectedPollId, adminToken);
      applyPollUpdate(updated, store.mode);
      setBoardOpen(true);
      notify('투표가 시작됐습니다!');
    } catch (error) {
      notify(error instanceof Error ? error.message : '투표 시작에 실패했습니다.', 'error');
    }
  }, [store, selectedPollId, adminTokens, applyPollUpdate, notify]);

  const closePoll = useCallback(async () => {
    const adminToken = selectedPollId ? adminTokens[selectedPollId] : null;
    if (!store || !selectedPollId || !adminToken) {
      notify('이 투표를 마감할 권한이 없습니다.', 'error');
      return;
    }
    try {
      const updated = await store.closePoll(selectedPollId, adminToken);
      applyPollUpdate(updated, store.mode);
      notify('투표를 마감했습니다.');
    } catch (error) {
      notify(error instanceof Error ? error.message : '투표 마감에 실패했습니다.', 'error');
    }
  }, [store, selectedPollId, adminTokens, applyPollUpdate, notify]);

  const toggleVote = useCallback(
    async (poll: PublicPoll, itemId: string) => {
      if (!store) {
        return;
      }
      if (poll.status !== 'open') {
        notify(poll.status === 'draft' ? '아직 시작되지 않은 투표입니다.' : '이미 마감된 투표입니다.', 'error');
        return;
      }

      const targetItem = poll.items.find((item) => item.id === itemId);
      if (targetItem && isRestrictedVoter(targetItem.restriction, voterName)) {
        notify(`"${targetItem.title}" 항목에는 투표할 수 없습니다.`, 'error');
        return;
      }

      const isAddingVote = !(myBallots[poll.id] || []).includes(itemId);
      if (isAddingVote && !voterName.trim()) {
        notify('투표자 이름을 먼저 입력해주세요.', 'error');
        return;
      }

      const current = new Set(myBallots[poll.id] || []);
      if (current.has(itemId)) {
        current.delete(itemId);
      } else if (poll.maxChoices === 1) {
        current.clear();
        current.add(itemId);
      } else if (current.size >= poll.maxChoices) {
        notify(`1인당 최대 ${poll.maxChoices}개까지 투표할 수 있습니다.`, 'error');
        return;
      } else {
        current.add(itemId);
      }

      const itemIds = [...current];
      try {
        const updated = await store.vote(poll.id, { itemIds, voterId, voterName: voterName.trim() });
        const nextBallots = { ...myBallots, [poll.id]: itemIds };
        setMyBallots(nextBallots);
        writeJson(MY_BALLOTS_KEY, nextBallots);
        applyPollUpdate(updated, store.mode);
      } catch (error) {
        notify(error instanceof Error ? error.message : '투표에 실패했습니다.', 'error');
      }
    },
    [store, myBallots, voterId, voterName, applyPollUpdate, notify]
  );

  const copyParticipantLink = useCallback(async () => {
    if (!selectedPollId) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('poll', selectedPollId);
    url.searchParams.set('view', 'vote');
    url.searchParams.delete('board');
    try {
      await navigator.clipboard.writeText(url.toString());
      notify('참여 링크를 복사했습니다. 모바일에서 바로 투표할 수 있습니다.');
    } catch {
      notify('복사에 실패했습니다. 주소창의 링크를 직접 공유해주세요.', 'error');
    }
  }, [selectedPollId, notify]);

  const attachImage = useCallback(
    (key: number, file: File | null) => {
      if (!file) {
        return;
      }
      void readImageAsDataUrl(file)
        .then((dataUrl) => {
          setFormItems((previous) =>
            previous.map((item) => (item.key === key ? { ...item, imageDataUrl: dataUrl } : item))
          );
        })
        .catch((error: Error) => notify(error.message, 'error'));
    },
    [notify]
  );

  const updateEditorItem = useCallback((key: number, patch: Partial<EditorItem>) => {
    setFormItems((previous) => previous.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  const sortedPolls = useMemo(() => sortPolls([...polls.values()]), [polls]);
  const isAdmin = Boolean(selectedPoll && adminTokens[selectedPoll.id]);
  const myIds = new Set(selectedPoll ? myBallots[selectedPoll.id] || [] : []);
  const maxCount = selectedPoll ? Math.max(1, ...selectedPoll.items.map((item) => item.count)) : 1;
  const detailItems = selectedPoll
    ? selectedPoll.status === 'closed'
      ? [...selectedPoll.items].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
      : selectedPoll.items
    : [];

  return (
    <Stack gap={4} maxWidth={participantView ? 560 : 760} padding={participantView ? 2 : 4} width="100%">
      <Stack gap={1}>
        {!participantView && (
          <Link href="./" color="secondary">
            ← 유틸리티 홈
          </Link>
        )}
        <HStack gap={3} vAlign="center" wrap="wrap">
          <StackItem size="fill">
            <Heading level={1}>{participantView && selectedPoll ? selectedPoll.title : '타다 투표'}</Heading>
          </StackItem>
          {store ? (
            <Badge
              label={store.mode === 'server' ? '실시간 공유 모드' : '로컬 모드'}
              variant={store.mode === 'server' ? 'success' : 'warning'}
            />
          ) : (
            <Badge label="연결 확인 중" />
          )}
        </HStack>
        {!participantView && (
          <Text type="supporting">투표를 세팅하고 시작 버튼을 누르면, 타이머와 함께 실시간 순위가 집계됩니다.</Text>
        )}
      </Stack>

      {store?.mode === 'local' && (
        <Banner
          status="warning"
          title="로컬 모드"
          description="서버 API가 없어 이 브라우저 안에서만 공유됩니다. 배포 서버에서는 모든 참여자와 실시간 공유됩니다."
        />
      )}

      {participantView && !selectedPoll && (
        <Banner status="info" title="투표를 찾는 중" description="링크가 올바른지 확인해주세요." />
      )}

      {selectedPoll && (
        <Section>
          <Stack gap={3}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <StackItem size="fill">
                <HStack gap={2} vAlign="center">
                  {!participantView && <Heading level={2}>{selectedPoll.title}</Heading>}
                  <PollStatus poll={selectedPoll} />
                </HStack>
              </StackItem>
              {!participantView && (
                <>
                  <Button label="참여 링크 복사" onClick={() => void copyParticipantLink()} />
                  <Button label="대시보드" onClick={() => setBoardOpen(true)} />
                </>
              )}
              {isAdmin && selectedPoll.status === 'draft' && (
                <Button label="투표 시작" variant="primary" onClick={() => void startPoll()} />
              )}
              {isAdmin && selectedPoll.status === 'open' && (
                <Button label="조기 마감" variant="destructive" onClick={() => void closePoll()} />
              )}
            </HStack>

            <Text type="supporting">
              1인당 최대 {selectedPoll.maxChoices}표 · 진행 시간 {Math.round(selectedPoll.durationSeconds / 60)}분
              {selectedPoll.status === 'draft' &&
                (isAdmin ? ' · "투표 시작"을 누르면 타이머가 돌아갑니다.' : ' · 관리자가 시작하면 투표할 수 있습니다.')}
              {selectedPoll.status === 'open' && ' · 선택한 항목을 다시 누르면 취소됩니다.'}
              {selectedPoll.status === 'closed' &&
                ` · ${formatDateTime(selectedPoll.closedAt || selectedPoll.createdAt)} 마감`}
            </Text>

            {selectedPoll.status === 'open' && remainingMs !== null && (
              <HStack gap={2} vAlign="baseline">
                <Text type="label">마감까지</Text>
                <Text type="display-2" hasTabularNumbers color={remainingMs <= 30000 ? 'accent' : 'primary'}>
                  {formatRemaining(remainingMs)}
                </Text>
              </HStack>
            )}

            {selectedPoll.status !== 'closed' && (
              <TextInput
                label="투표자 이름 (필수, 결과에 표시됩니다)"
                value={voterName}
                onChange={(value: string) => {
                  setVoterName(value);
                  localStorage.setItem(VOTER_NAME_KEY, value.trim());
                }}
                placeholder="이름을 입력해야 투표할 수 있습니다"
                status={
                  selectedPoll.status === 'open' && !voterName.trim()
                    ? { message: '이름을 입력해야 투표할 수 있습니다.', type: 'warning' }
                    : undefined
                }
              />
            )}

            {selectedPoll.status === 'open' && (
              <Text type="supporting">
                내 투표 {myIds.size}/{selectedPoll.maxChoices}
              </Text>
            )}

            <Stack gap={2}>
              {detailItems.map((item, index) => {
                const percent = selectedPoll.totalVoters
                  ? Math.round((item.count / Math.max(1, selectedPoll.totalVoters)) * 100)
                  : 0;
                const restricted = isRestrictedVoter(item.restriction, voterName);
                return (
                  <SelectableCard
                    key={item.id}
                    label={item.title}
                    isSelected={myIds.has(item.id)}
                    isDisabled={selectedPoll.status !== 'open' || restricted}
                    onChange={() => void toggleVote(selectedPoll, item.id)}
                  >
                    <Stack gap={2}>
                      {item.imageUrl && (
                        <AspectRatio ratio={16 / 9}>
                          <img src={item.imageUrl} alt={item.title} className="vote-item-photo" />
                        </AspectRatio>
                      )}
                      <HStack gap={2} vAlign="center">
                        {selectedPoll.status === 'closed' && (
                          <Text type="label" color="accent">
                            {index === 0 ? '👑 1위' : `${index + 1}위`}
                          </Text>
                        )}
                        <StackItem size="fill">
                          <Stack gap={0.5}>
                            <Text type="body" weight="bold">
                              {item.title}
                            </Text>
                            {item.description && <Text type="supporting">{item.description}</Text>}
                            {restricted && selectedPoll.status === 'open' && (
                              <Text type="supporting" color="disabled">
                                🚫 {item.restriction}님은 이 항목에 투표할 수 없습니다
                              </Text>
                            )}
                          </Stack>
                        </StackItem>
                        <Text type="label" hasTabularNumbers>
                          {selectedPoll.status === 'draft' ? '대기' : `${item.count}표 · ${percent}%`}
                        </Text>
                      </HStack>
                      {selectedPoll.status !== 'draft' && (
                        <ProgressBar
                          label={`${item.title} 득표`}
                          isLabelHidden
                          value={Math.round((item.count / maxCount) * 100)}
                        />
                      )}
                      {item.voters.length > 0 && selectedPoll.status !== 'draft' && (
                        <Text type="supporting" size="xsm">
                          {item.voters.join(', ')}
                        </Text>
                      )}
                    </Stack>
                  </SelectableCard>
                );
              })}
            </Stack>

            <Text type="supporting">총 {selectedPoll.totalVoters}명 참여</Text>
          </Stack>
        </Section>
      )}

      {!participantView && (
        <>
          <Section>
            <Stack gap={2}>
              <HStack gap={2} vAlign="center">
                <StackItem size="fill">
                  <Heading level={2}>투표 목록</Heading>
                </StackItem>
                <Button label="새로고침" variant="ghost" onClick={() => void refreshPolls()} />
                <Button label="새 투표 만들기" variant="primary" onClick={() => setCreateOpen(true)} />
              </HStack>
              {sortedPolls.length === 0 ? (
                <Text type="supporting">아직 만들어진 투표가 없습니다. "새 투표 만들기"로 시작해보세요.</Text>
              ) : (
                <Stack gap={0.5}>
                  {sortedPolls.map((poll) => (
                    <Item
                      key={poll.id}
                      label={poll.title}
                      description={`${poll.totalVoters}명 참여 · 항목 ${poll.items.length}개 · ${formatDateTime(poll.createdAt)}`}
                      isSelected={poll.id === selectedPollId}
                      onClick={() => setSelectedPollId(poll.id)}
                      endContent={<PollStatus poll={poll} />}
                    />
                  ))}
                </Stack>
              )}
            </Stack>
          </Section>

          <Dialog isOpen={createOpen} onOpenChange={setCreateOpen} width={640} purpose="form">
            <Layout
              header={<DialogHeader title="새 투표 세팅" onOpenChange={setCreateOpen} />}
              content={
                <LayoutContent isScrollable>
                  <Stack gap={3} paddingBlock={2}>
                    <TextInput
                      label="투표 주제"
                      value={formTitle}
                      onChange={setFormTitle}
                      placeholder="예: 하반기 워크숍 장소 투표"
                    />

                    <Stack gap={2}>
                      <Text type="label">투표 항목 (2개 이상 · 이름 필수 / 설명 · 사진 · 투표 제한 선택)</Text>
                      {formItems.map((item, index) => (
                        <Section key={item.key} variant="muted" padding={3}>
                          <HStack gap={2} vAlign="start">
                            <ItemImagePicker
                              imageDataUrl={item.imageDataUrl}
                              itemLabel={`항목 ${index + 1} 사진`}
                              onPick={(file) => attachImage(item.key, file)}
                              onRemove={() => updateEditorItem(item.key, { imageDataUrl: null })}
                            />
                            <StackItem size="fill">
                              <Stack gap={1}>
                                <TextInput
                                  label={`항목 ${index + 1} 이름`}
                                  isLabelHidden
                                  value={item.title}
                                  onChange={(value: string) => updateEditorItem(item.key, { title: value })}
                                  placeholder="항목 이름 (필수)"
                                />
                                <TextInput
                                  label={`항목 ${index + 1} 설명`}
                                  isLabelHidden
                                  value={item.description}
                                  onChange={(value: string) => updateEditorItem(item.key, { description: value })}
                                  placeholder="설명 (선택)"
                                />
                                <TextInput
                                  label={`항목 ${index + 1} 투표 제한`}
                                  isLabelHidden
                                  value={item.restriction}
                                  onChange={(value: string) => updateEditorItem(item.key, { restriction: value })}
                                  placeholder="투표 제한 (선택) — 이 이름의 투표자는 투표 불가"
                                />
                              </Stack>
                            </StackItem>
                            <Button
                              label="항목 삭제"
                              icon={<span aria-hidden>✕</span>}
                              isIconOnly
                              variant="ghost"
                              onClick={() => {
                                if (formItems.length <= 2) {
                                  notify('항목은 최소 2개가 필요합니다.', 'error');
                                  return;
                                }
                                setFormItems((previous) => previous.filter((candidate) => candidate.key !== item.key));
                              }}
                            />
                          </HStack>
                        </Section>
                      ))}
                      <HStack>
                        <Button
                          label="+ 항목 추가"
                          variant="ghost"
                          onClick={() => setFormItems((previous) => [...previous, newEditorItem()])}
                        />
                      </HStack>
                    </Stack>

                    <HStack gap={2} wrap="wrap">
                      <NumberInput
                        label="1인당 투표 수"
                        value={formMaxChoices}
                        onChange={(value: number | null) => setFormMaxChoices(value ?? 1)}
                        min={1}
                        max={10}
                      />
                      <NumberInput
                        label="진행 시간 (분)"
                        value={formDurationMinutes}
                        onChange={(value: number | null) => setFormDurationMinutes(value ?? 5)}
                        min={1}
                        max={120}
                      />
                    </HStack>
                  </Stack>
                </LayoutContent>
              }
              footer={
                <LayoutFooter hasDivider>
                  <HStack gap={2} hAlign="end">
                    <Button label="취소" variant="ghost" onClick={() => setCreateOpen(false)} />
                    <Button
                      label={creating ? '만드는 중…' : '투표 만들기'}
                      variant="primary"
                      isDisabled={creating || !store}
                      onClick={() => void createPoll()}
                    />
                  </HStack>
                </LayoutFooter>
              }
            />
          </Dialog>
        </>
      )}

      {boardOpen && selectedPoll && (
        <VoteBoard poll={selectedPoll} remainingMs={remainingMs} onClose={() => setBoardOpen(false)} />
      )}
    </Stack>
  );
}

function ItemImagePicker(props: {
  imageDataUrl: string | null;
  itemLabel: string;
  onPick: (file: File | null) => void;
  onRemove: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Thumbnail
        src={props.imageDataUrl ?? undefined}
        alt={props.itemLabel}
        label={props.itemLabel}
        onClick={() => fileInputRef.current?.click()}
        onRemove={props.imageDataUrl ? props.onRemove : undefined}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(event) => {
          props.onPick(event.currentTarget.files?.[0] ?? null);
          event.currentTarget.value = '';
        }}
      />
    </>
  );
}

import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack, Stack, StackItem } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { formatRemaining } from './VoteApp';
import type { PublicPoll } from './voteStore';

interface VoteBoardProps {
  poll: PublicPoll;
  remainingMs: number | null;
  onClose: () => void;
}

export function VoteBoard({ poll, remainingMs, onClose }: VoteBoardProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const previousTopsRef = useRef(new Map<string, number>());
  const previousCountsRef = useRef(new Map<string, number>());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('board-open');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('board-open');
    };
  }, [onClose]);

  const sorted = [...poll.items].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const maxCount = Math.max(1, ...sorted.map((item) => item.count));
  const isFinal = poll.status === 'closed';

  // FLIP: 렌더 후 이전 위치와 비교해 순위 이동을 슬라이드 애니메이션으로 표현
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const rows = [...list.querySelectorAll<HTMLElement>('[data-item-id]')];
    rows.forEach((row) => {
      const itemId = row.dataset.itemId ?? '';
      const previousTop = previousTopsRef.current.get(itemId);
      const newTop = row.getBoundingClientRect().top;
      if (previousTop !== undefined) {
        const delta = previousTop - newTop;
        if (Math.abs(delta) >= 2) {
          row.style.transition = 'none';
          row.style.transform = `translateY(${delta}px)`;
          void row.offsetWidth;
          row.style.transition = 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)';
          row.style.transform = 'translateY(0)';
        }
      }
      previousTopsRef.current.set(itemId, newTop);
    });
  });

  return (
    <div className={`vote-board${isFinal ? ' is-final' : ''}`}>
      <HStack gap={4} vAlign="start" wrap="wrap">
        <StackItem size="fill">
          <Stack gap={0.5}>
            <Text type="label" color="accent">
              {isFinal ? 'FINAL RESULT' : 'LIVE DASHBOARD'}
            </Text>
            <Heading level={1}>{poll.title}</Heading>
          </Stack>
        </StackItem>
        <HStack gap={3} vAlign="center">
          <span className={`vote-board-countdown${remainingMs !== null && remainingMs <= 30000 ? ' is-urgent' : ''}`}>
            {poll.status === 'draft' ? '대기 중' : isFinal ? '마감' : formatRemaining(remainingMs ?? 0)}
          </span>
          <Button label="닫기" variant="ghost" onClick={onClose} />
        </HStack>
      </HStack>

      <Text type="supporting">
        {poll.status === 'draft' && '관리자가 투표를 시작하면 실시간 순위가 표시됩니다.'}
        {poll.status === 'open' && '실시간 집계 중 — 순위는 투표에 따라 계속 바뀝니다.'}
        {isFinal && '🏁 투표가 마감되어 최종 순위가 확정됐습니다.'}
      </Text>

      <div className="vote-board-list" ref={listRef}>
        {sorted.map((item, index) => {
          const previousCount = previousCountsRef.current.get(item.id);
          const bumped = previousCount !== undefined && previousCount !== item.count;
          previousCountsRef.current.set(item.id, item.count);
          return (
            <div
              key={item.id}
              data-item-id={item.id}
              className={`vote-board-row rank-${Math.min(index + 1, 4)}${isFinal ? ' is-final' : ''}`}
            >
              <span className="vote-board-rank">{isFinal && index === 0 ? '👑' : index + 1}</span>
              {item.imageUrl && (
                <span className="vote-board-thumb" style={{ backgroundImage: `url(${item.imageUrl})` }} />
              )}
              <span className="vote-board-main">
                <span className="vote-board-title">{item.title}</span>
                <span className="vote-board-track">
                  <span
                    className="vote-board-fill"
                    style={{ width: `${Math.round((item.count / maxCount) * 100)}%` }}
                  />
                </span>
              </span>
              <span key={`${item.id}-${item.count}`} className={`vote-board-count${bumped ? ' bump' : ''}`}>
                {item.count}표
              </span>
            </div>
          );
        })}
      </div>

      <Text type="supporting" justify="center">
        총 {poll.totalVoters}명 참여 · 1인당 최대 {poll.maxChoices}표
      </Text>
    </div>
  );
}

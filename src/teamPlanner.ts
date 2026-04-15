import type { EmployeeConfig, TeamBucket } from './lunchdayTypes';

const TEAM_ACCENT = '#0f766e';

export type TeamPlan = {
  sizes: number[];
  warnings: string[];
};

export function computeTeamSizes(participantCount: number, minSize: number, maxSize: number): TeamPlan {
  if (participantCount <= 0) {
    return { sizes: [], warnings: [] };
  }

  const warnings: string[] = [];
  const candidates: number[][] = [];
  const minTeams = Math.ceil(participantCount / maxSize);
  const maxTeams = Math.max(1, Math.floor(participantCount / minSize));

  for (let teamCount = minTeams; teamCount <= maxTeams; teamCount += 1) {
    const baseSize = Math.floor(participantCount / teamCount);
    const remainder = participantCount % teamCount;
    const sizes = Array.from({ length: teamCount }, (_, index) => baseSize + (index < remainder ? 1 : 0));

    if (sizes.every((size) => size >= minSize && size <= maxSize)) {
      candidates.push(sizes);
    }
  }

  if (!candidates.length) {
    warnings.push(`${participantCount}명은 4~5명으로 정확히 나누기 어려워 단일 팀으로 표시합니다.`);
    return { sizes: [participantCount], warnings };
  }

  candidates.sort((left, right) => {
    const leftSpread = Math.max(...left) - Math.min(...left);
    const rightSpread = Math.max(...right) - Math.min(...right);
    if (leftSpread !== rightSpread) {
      return leftSpread - rightSpread;
    }

    const leftFives = left.filter((size) => size === 5).length;
    const rightFives = right.filter((size) => size === 5).length;
    if (leftFives !== rightFives) {
      return rightFives - leftFives;
    }

    return left.length - right.length;
  });

  return { sizes: candidates[0], warnings };
}

export function computeTeamSizesFromSettings(participantCount: number, teamCount: number, teamSize: number): TeamPlan {
  if (participantCount <= 0) {
    return { sizes: [], warnings: [] };
  }

  const safeTeamCount = Math.max(1, Math.min(teamCount, participantCount));
  const baseSize = Math.floor(participantCount / safeTeamCount);
  const remainder = participantCount % safeTeamCount;
  const sizes = Array.from({ length: safeTeamCount }, (_, index) => baseSize + (index < remainder ? 1 : 0)).filter(
    (size) => size > 0
  );

  const maxAssignedSize = Math.max(...sizes);
  const minAssignedSize = Math.min(...sizes);
  const warnings: string[] = [];

  if (sizes.length > 1 && maxAssignedSize !== minAssignedSize) {
    const maxCount = sizes.filter((size) => size === maxAssignedSize).length;
    const minCount = sizes.filter((size) => size === minAssignedSize).length;
    warnings.push(
      `현재 설정은 ${maxAssignedSize}명 팀 ${maxCount}개, ${minAssignedSize}명 팀 ${minCount}개로 배정됩니다.`
    );
  } else if (teamSize > 0 && maxAssignedSize !== teamSize) {
    warnings.push(`현재 선택 인원 기준으로 팀당 인원은 ${maxAssignedSize}명으로 적용됩니다.`);
  }

  return { sizes, warnings };
}

export function buildTeamBuckets(sizes: number[]): TeamBucket[] {
  const buckets = sizes.map((targetSize, index) => ({
    accent: TEAM_ACCENT,
    endRank: 0,
    finishRanks: [] as number[],
    members: [],
    startRank: 0,
    targetSize,
    teamCode: `TEAM-${toTeamSuffix(index)}`,
    teamLabel: `런치팀 ${toTeamSuffix(index)}`,
  }));

  let currentRank = 1;
  let hasOpenSlot = true;

  while (hasOpenSlot) {
    hasOpenSlot = false;

    buckets.forEach((bucket) => {
      if (bucket.finishRanks.length >= bucket.targetSize) {
        return;
      }

      hasOpenSlot = true;
      bucket.finishRanks.push(currentRank);
      currentRank += 1;
    });
  }

  buckets.forEach((bucket) => {
    bucket.startRank = bucket.finishRanks[0] ?? 0;
    bucket.endRank = bucket.finishRanks[bucket.finishRanks.length - 1] ?? 0;
  });

  return buckets;
}

export function findTeamBucketByRank(teams: TeamBucket[], finishRank: number): TeamBucket | undefined {
  return teams.find((team) => team.finishRanks.includes(finishRank));
}

export function summarizeSelectedTeams(employees: EmployeeConfig[]): string {
  if (!employees.length) {
    return '아직 참여자가 선택되지 않았습니다.';
  }

  const counts = employees.reduce<Record<string, number>>((accumulator, employee) => {
    accumulator[employee.team] = (accumulator[employee.team] ?? 0) + 1;
    return accumulator;
  }, {});

  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ko'))
    .map(([team, count]) => `${team} ${count}명`)
    .join(' · ');
}

function toTeamSuffix(index: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let cursor = index;
  let suffix = '';

  do {
    suffix = alphabet[cursor % alphabet.length] + suffix;
    cursor = Math.floor(cursor / alphabet.length) - 1;
  } while (cursor >= 0);

  return suffix;
}

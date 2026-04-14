import type { AppConfig } from './lunchdayTypes';

export const sampleConfig: AppConfig = {
  configSource: 'bundled-sample',
  employees: [
    { enabled: true, id: 'EMP-001', marbleLabel: '가은', name: '가은', team: 'Product' },
    { enabled: true, id: 'EMP-002', marbleLabel: '도윤', name: '도윤', team: 'Product' },
    { enabled: true, id: 'EMP-003', marbleLabel: '민서', name: '민서', team: 'Design' },
    { enabled: true, id: 'EMP-004', marbleLabel: '서준', name: '서준', team: 'Driver Ops' },
    { enabled: true, id: 'EMP-005', marbleLabel: '하윤', name: '하윤', team: 'Marketing' },
    { enabled: true, id: 'EMP-006', marbleLabel: '이안', name: '이안', team: 'Operations' },
    { enabled: true, id: 'EMP-007', marbleLabel: '주원', name: '주원', team: 'Operations' },
    { enabled: true, id: 'EMP-008', marbleLabel: '유진', name: '유진', team: 'People' },
    { enabled: true, id: 'EMP-009', marbleLabel: '지우', name: '지우', team: 'People' },
    { enabled: true, id: 'EMP-010', marbleLabel: '하린', name: '하린', team: 'Finance' },
  ],
  maxTeamSize: 5,
  minTeamSize: 4,
  organization: '타다',
  slackChannelLabel: '',
  slackEnabled: false,
  subtitle: '직원 한 명당 구슬 하나. 오늘 참여 인원을 골라 4~5명 런치데이 팀을 만듭니다.',
  title: '타다 런치데이 룰렛',
};

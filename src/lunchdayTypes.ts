export type EmployeeConfig = {
  id: string;
  name: string;
  team: string;
  enabled: boolean;
  marbleLabel: string;
};

export type GameMode = 'lunchday' | 'last-place';

export type AppConfig = {
  title: string;
  subtitle: string;
  organization: string;
  minTeamSize: number;
  maxTeamSize: number;
  configSource: string;
  slackChannelLabel: string;
  slackEnabled: boolean;
  employees: EmployeeConfig[];
};

export type TeamBucket = {
  teamCode: string;
  teamLabel: string;
  accent: string;
  targetSize: number;
  members: TeamMember[];
  finishRanks: number[];
  startRank: number;
  endRank: number;
};

export type TeamMember = {
  employeeId: string;
  marbleLabel: string;
  finishRank: number;
  name: string;
  team: string;
};

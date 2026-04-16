import type { AppConfig, EmployeeConfig, GameMode, TeamBucket, TeamMember } from './lunchdayTypes';
import options from './options';
import type { Roulette } from './roulette';
import { sampleConfig } from './sampleConfig';
import {
  buildTeamBuckets,
  computeTeamSizes,
  computeTeamSizesFromSettings,
  findTeamBucketByRank,
  summarizeSelectedTeams,
} from './teamPlanner';

const STORAGE_KEY = 'tada-lunchday-selected-employees';
const CUSTOM_EMPLOYEES_KEY = 'tada-lunchday-custom-employees';
const MODE_STORAGE_KEY = 'tada-roulette-game-mode';
const TARGET_RANK_STORAGE_KEY = 'tada-roulette-target-rank';
const MAX_LOG_ITEMS = 8;
const APP_NAME = '타다 룰렛';
const APP_VERSION = 'v1.0.0';
const SOURCE_TEAM_PALETTE = [
  '#d8a7ab',
  '#e6bc9a',
  '#ddd2aa',
  '#bfd2b2',
  '#abcdbd',
  '#abcfd1',
  '#b6c5df',
  '#c9bedf',
  '#d9bfd2',
  '#d7ccc2',
];

type RunState = {
  finishedLabels: Set<string>;
  finishedMembers: TeamMember[];
  participantsByLabel: Map<string, EmployeeConfig>;
  teamBuckets: TeamBucket[];
  warnings: string[];
};

type ElementMap = {
  appSubtitle: HTMLParagraphElement;
  appTitle: HTMLHeadingElement;
  clearButton: HTMLButtonElement;
  configMeta: HTMLParagraphElement;
  countdown: HTMLDivElement;
  employeeList: HTMLDivElement;
  eventLog: HTMLOListElement;
  finishOverlay: HTMLDivElement;
  finishOverlayLineFour: HTMLSpanElement;
  finishOverlayLineOne: HTMLSpanElement;
  finishOverlayLineThree: HTMLSpanElement;
  finishOverlayLineTwo: HTMLSpanElement;
  finisherCount: HTMLElement;
  modeLastPlaceButton: HTMLButtonElement;
  modeLunchdayButton: HTMLButtonElement;
  pasteApplyButton: HTMLButtonElement;
  pasteEmployeesButton: HTMLButtonElement;
  pasteModal: HTMLDivElement;
  pasteModalBackdrop: HTMLDivElement;
  pasteModalCloseButton: HTMLButtonElement;
  pasteTextarea: HTMLTextAreaElement;
  plannedTeamCount: HTMLElement;
  publishSlackButton: HTMLButtonElement;
  rankFirstButton: HTMLButtonElement;
  rankLastButton: HTMLButtonElement;
  refreshPreviewButton: HTMLButtonElement;
  releaseModal: HTMLDivElement;
  releaseModalBackdrop: HTMLDivElement;
  releaseModalCloseButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  resultEyebrow: HTMLDivElement;
  resultTitle: HTMLHeadingElement;
  searchInput: HTMLInputElement;
  selectAllButton: HTMLButtonElement;
  selectedCount: HTMLElement;
  selectionSummary: HTMLDivElement;
  summaryGrid: HTMLDivElement;
  stageMeta: HTMLParagraphElement;
  stageTitle: HTMLHeadingElement;
  startButton: HTMLButtonElement;
  statusBadge: HTMLSpanElement;
  slackChannelMeta: HTMLSpanElement;
  teamBoard: HTMLDivElement;
  teamCountControl: HTMLDivElement;
  teamCountLabel: HTMLElement;
  teamCountMinus: HTMLButtonElement;
  teamCountPlus: HTMLButtonElement;
  teamCountTile: HTMLDivElement;
  teamSizeCount: HTMLElement;
  teamSizeControl: HTMLDivElement;
  teamSizeLabel: HTMLElement;
  teamSizeMinus: HTMLButtonElement;
  teamSizePlus: HTMLButtonElement;
  teamSizePreview: HTMLDivElement;
  teamSizeTile: HTMLDivElement;
  toastRoot: HTMLDivElement;
  totalEmployeeCount: HTMLElement;
  warningBox: HTMLDivElement;
  updateMarquee: HTMLDivElement;
  versionButton: HTMLButtonElement;
};

export class LunchdayApp {
  private config: AppConfig = sampleConfig;
  private elements!: ElementMap;
  private runState: RunState | null = null;
  private selectedIds = new Set<string>();
  private isRunning = false;
  private marqueeTimer: number | null = null;
  private lastLogEntries: string[] = [];
  private isPublishingSlack = false;
  private gameMode: GameMode = 'lunchday';
  private teamCountSetting = 0;
  private teamSizeSetting = 0;
  private teamSettingMode: 'count' | 'size' = 'count';
  private targetRankSetting = 1;

  constructor(private roulette: Roulette) {}

  async init() {
    this.elements = this.cacheElements();
    this.bindEvents();
    this.setStatus('로딩 중', 'loading');

    await this.waitForRouletteReady();

    options.autoRecording = false;
    options.useSkills = false;
    this.roulette.setTheme('dark');
    this.bindRouletteEvents();

    this.config = await this.loadConfig();
    this.restoreCustomEmployees();
    this.restoreSelection();
    this.restoreMode();
    this.restoreTargetRank();
    this.renderStaticConfig();
    this.syncPreview();
  }

  private cacheElements(): ElementMap {
    return {
      appSubtitle: this.query('#appSubtitle'),
      appTitle: this.query('#appTitle'),
      clearButton: this.query('#clearButton'),
      configMeta: this.query('#configMeta'),
      countdown: this.query('#countdown'),
      employeeList: this.query('#employeeList'),
      eventLog: this.query('#eventLog'),
      finishOverlay: this.query('#finishOverlay'),
      finishOverlayLineFour: this.query('#finishOverlayLineFour'),
      finishOverlayLineOne: this.query('#finishOverlayLineOne'),
      finishOverlayLineThree: this.query('#finishOverlayLineThree'),
      finishOverlayLineTwo: this.query('#finishOverlayLineTwo'),
      finisherCount: this.query('#finisherCount'),
      modeLastPlaceButton: this.query('#modeLastPlaceButton'),
      modeLunchdayButton: this.query('#modeLunchdayButton'),
      pasteApplyButton: this.query('#pasteApplyButton'),
      pasteEmployeesButton: this.query('#pasteEmployeesButton'),
      pasteModal: this.query('#pasteModal'),
      pasteModalBackdrop: this.query('#pasteModalBackdrop'),
      pasteModalCloseButton: this.query('#pasteModalCloseButton'),
      pasteTextarea: this.query('#pasteTextarea'),
      plannedTeamCount: this.query('#plannedTeamCount'),
      publishSlackButton: this.query('#publishSlackButton'),
      rankFirstButton: this.query('#rankFirstButton'),
      rankLastButton: this.query('#rankLastButton'),
      refreshPreviewButton: this.query('#refreshPreviewButton'),
      releaseModal: this.query('#releaseModal'),
      releaseModalBackdrop: this.query('#releaseModalBackdrop'),
      releaseModalCloseButton: this.query('#releaseModalCloseButton'),
      resetButton: this.query('#resetButton'),
      resultEyebrow: this.query('#resultEyebrow'),
      resultTitle: this.query('#resultTitle'),
      searchInput: this.query('#searchInput'),
      selectAllButton: this.query('#selectAllButton'),
      selectedCount: this.query('#selectedCount'),
      selectionSummary: this.query('#selectionSummary'),
      summaryGrid: this.query('#summaryGrid'),
      stageMeta: this.query('#stageMeta'),
      stageTitle: this.query('#stageTitle'),
      startButton: this.query('#startButton'),
      statusBadge: this.query('#statusBadge'),
      slackChannelMeta: this.query('#slackChannelMeta'),
      teamBoard: this.query('#teamBoard'),
      teamCountControl: this.query('#teamCountControl'),
      teamCountLabel: this.query('#teamCountLabel'),
      teamCountMinus: this.query('#teamCountMinus'),
      teamCountPlus: this.query('#teamCountPlus'),
      teamCountTile: this.query('#teamCountTile'),
      teamSizeCount: this.query('#teamSizeCount'),
      teamSizeControl: this.query('#teamSizeControl'),
      teamSizeLabel: this.query('#teamSizeLabel'),
      teamSizeMinus: this.query('#teamSizeMinus'),
      teamSizePlus: this.query('#teamSizePlus'),
      teamSizePreview: this.query('#teamSizePreview'),
      teamSizeTile: this.query('#teamSizeTile'),
      toastRoot: this.query('#toastRoot'),
      totalEmployeeCount: this.query('#totalEmployeeCount'),
      warningBox: this.query('#warningBox'),
      updateMarquee: this.query('#updateMarquee'),
      versionButton: this.query('#versionButton'),
    };
  }

  private bindEvents() {
    this.elements.modeLunchdayButton.addEventListener('click', () => {
      this.setGameMode('lunchday');
    });

    this.elements.modeLastPlaceButton.addEventListener('click', () => {
      this.setGameMode('rank-pick');
    });

    this.elements.searchInput.addEventListener('input', () => {
      this.renderEmployeeList();
    });

    this.elements.selectAllButton.addEventListener('click', () => {
      this.getVisibleEmployees()
        .filter((employee) => employee.enabled)
        .forEach((employee) => this.selectedIds.add(employee.id));
      this.persistSelection();
      this.syncPreview();
    });

    this.elements.clearButton.addEventListener('click', () => {
      this.selectedIds.clear();
      this.persistSelection();
      this.syncPreview();
    });

    this.elements.teamCountMinus.addEventListener('click', () => {
      this.adjustTeamCount(-1);
    });

    this.elements.teamCountPlus.addEventListener('click', () => {
      this.adjustTeamCount(1);
    });

    this.elements.teamSizeMinus.addEventListener('click', () => {
      if (this.gameMode === 'lunchday') {
        this.adjustTeamSize(-1);
        return;
      }

      this.adjustTargetRank(-1);
    });

    this.elements.teamSizePlus.addEventListener('click', () => {
      if (this.gameMode === 'lunchday') {
        this.adjustTeamSize(1);
        return;
      }

      this.adjustTargetRank(1);
    });

    this.elements.rankFirstButton.addEventListener('click', () => {
      this.setTargetRank(1);
    });

    this.elements.rankLastButton.addEventListener('click', () => {
      this.setTargetRank(this.getSelectedEmployees().length);
    });

    this.elements.pasteEmployeesButton.addEventListener('click', () => {
      if (!this.isRunning) {
        this.togglePasteModal(true);
      }
    });

    this.elements.pasteModalCloseButton.addEventListener('click', () => {
      this.togglePasteModal(false);
    });

    this.elements.pasteModalBackdrop.addEventListener('click', () => {
      this.togglePasteModal(false);
    });

    this.elements.versionButton.addEventListener('click', () => {
      this.toggleReleaseModal(true);
    });

    this.elements.releaseModalCloseButton.addEventListener('click', () => {
      this.toggleReleaseModal(false);
    });

    this.elements.releaseModalBackdrop.addEventListener('click', () => {
      this.toggleReleaseModal(false);
    });

    this.elements.pasteApplyButton.addEventListener('click', () => {
      this.applyPastedEmployees();
    });

    this.elements.refreshPreviewButton.addEventListener('click', () => {
      if (!this.isRunning) {
        this.syncPreview(true);
      }
    });

    this.elements.resetButton.addEventListener('click', () => {
      if (!this.isRunning) {
        this.resetRunState();
        this.syncPreview(true);
      }
    });

    this.elements.startButton.addEventListener('click', () => {
      void this.startRun();
    });

    this.elements.publishSlackButton.addEventListener('click', () => {
      void this.publishResultsToSlack();
    });

    this.elements.employeeList.addEventListener('change', (event) => {
      if (this.isRunning) {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
        return;
      }

      const employeeId = target.dataset.employeeId;
      if (!employeeId) {
        return;
      }

      if (target.checked) {
        this.selectedIds.add(employeeId);
      } else {
        this.selectedIds.delete(employeeId);
      }

      this.persistSelection();
      this.syncPreview();
    });
  }

  private bindRouletteEvents() {
    this.roulette.addEventListener('marble-finish', (event) => {
      const detail = (event as CustomEvent<{ name: string; rank: number }>).detail;
      this.handleFinish(detail.name, detail.rank);
    });

    this.roulette.addEventListener('goal', () => {
      if (!this.runState) {
        return;
      }

      this.isRunning = false;
      this.renderFinishOverlayCopy();
      this.elements.finishOverlay.classList.remove('hidden');
      this.elements.updateMarquee.classList.add('hidden');
      this.setStatus(this.gameMode === 'lunchday' ? '편성 완료' : '추첨 완료', 'complete');
      this.updateActionState();
      this.renderEmployeeList();
      this.renderSummaryTiles(this.getSelectedEmployees().length, this.runState.teamBuckets.length);
      this.renderResultBoard(this.runState.teamBuckets);

      const completedCount = this.runState.finishedLabels.size;
      this.appendLog(
        this.gameMode === 'lunchday'
          ? `팀 편성이 완료되었습니다. 총 ${completedCount}명이 완주했습니다.`
          : `뽑기가 완료되었습니다. 총 ${completedCount}명이 완주했습니다.`
      );
      this.showToast(this.gameMode === 'lunchday' ? '런치데이 팀 편성이 완료되었습니다.' : '뽑기가 완료되었습니다.');
      window.setTimeout(() => {
        if (!this.isRunning) {
          this.roulette.clearMarbles();
        }
      }, 0);
    });
  }

  private async loadConfig(): Promise<AppConfig> {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) {
        throw new Error(`환경설정 조회 실패 (${response.status})`);
      }

      return this.normalizeConfig((await response.json()) as Partial<AppConfig>);
    } catch (error) {
      console.warn('[LunchdayApp] Falling back to sample config:', error);
      this.showToast('런타임 설정을 불러오지 못해 샘플 설정으로 시작합니다.');
      return sampleConfig;
    }
  }

  private normalizeConfig(raw: Partial<AppConfig>): AppConfig {
    const employees = Array.isArray(raw.employees)
      ? raw.employees.map((employee, index) => ({
          enabled: employee.enabled !== false,
          id: employee.id || `EMP-${String(index + 1).padStart(3, '0')}`,
          marbleLabel: employee.marbleLabel || employee.name || `EMP ${index + 1}`,
          name: employee.name || `직원 ${index + 1}`,
          team: employee.team || '미지정 팀',
        }))
      : sampleConfig.employees;

    return {
      configSource: raw.configSource || sampleConfig.configSource,
      employees,
      maxTeamSize: raw.maxTeamSize || sampleConfig.maxTeamSize,
      minTeamSize: raw.minTeamSize || sampleConfig.minTeamSize,
      organization: raw.organization || sampleConfig.organization,
      slackChannelLabel: raw.slackChannelLabel || sampleConfig.slackChannelLabel,
      slackEnabled: raw.slackEnabled ?? sampleConfig.slackEnabled,
      subtitle: raw.subtitle || sampleConfig.subtitle,
      title: raw.title || sampleConfig.title,
    };
  }

  private restoreCustomEmployees() {
    const storedEmployees = window.localStorage.getItem(CUSTOM_EMPLOYEES_KEY);
    if (!storedEmployees) {
      return;
    }

    try {
      const parsedEmployees = (JSON.parse(storedEmployees) as EmployeeConfig[]).map((employee, index) =>
        normalizeStoredEmployee(employee, index)
      );
      if (!Array.isArray(parsedEmployees) || !parsedEmployees.length) {
        return;
      }

      this.config = {
        ...this.config,
        configSource: 'local-paste',
        employees: parsedEmployees,
      };
    } catch (error) {
      console.warn('[LunchdayApp] Failed to parse pasted employees:', error);
    }
  }

  private restoreSelection() {
    const enabledEmployees = this.config.employees.filter((employee) => employee.enabled);
    const storedIds = window.localStorage.getItem(STORAGE_KEY);

    if (!storedIds) {
      enabledEmployees.forEach((employee) => this.selectedIds.add(employee.id));
      return;
    }

    try {
      const candidateIds = new Set(JSON.parse(storedIds) as string[]);
      enabledEmployees.forEach((employee) => {
        if (candidateIds.has(employee.id)) {
          this.selectedIds.add(employee.id);
        }
      });
    } catch (error) {
      console.warn('[LunchdayApp] Failed to parse saved selection:', error);
      enabledEmployees.forEach((employee) => this.selectedIds.add(employee.id));
    }

    if (!this.selectedIds.size) {
      enabledEmployees.forEach((employee) => this.selectedIds.add(employee.id));
    }
  }

  private restoreMode() {
    const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (storedMode === 'last-place') {
      this.gameMode = 'rank-pick';
      return;
    }

    if (storedMode === 'lunchday' || storedMode === 'rank-pick') {
      this.gameMode = storedMode;
    }
  }

  private restoreTargetRank() {
    const storedRank = Number(window.localStorage.getItem(TARGET_RANK_STORAGE_KEY));
    if (Number.isFinite(storedRank) && storedRank >= 1) {
      this.targetRankSetting = Math.floor(storedRank);
    }
  }

  private persistSelection() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.selectedIds]));
  }

  private persistMode() {
    window.localStorage.setItem(MODE_STORAGE_KEY, this.gameMode);
  }

  private persistTargetRank() {
    window.localStorage.setItem(TARGET_RANK_STORAGE_KEY, String(this.targetRankSetting));
  }

  private setGameMode(mode: GameMode) {
    if (this.isRunning || this.gameMode === mode) {
      return;
    }

    this.gameMode = mode;
    this.persistMode();
    this.resetRunState();
    this.syncPreview();
  }

  private toggleReleaseModal(isOpen: boolean) {
    this.elements.releaseModal.classList.toggle('hidden', !isOpen);
  }

  private renderStaticConfig() {
    this.elements.appTitle.textContent = APP_NAME;
    this.elements.appSubtitle.textContent = this.config.subtitle;
    this.elements.totalEmployeeCount.textContent = `${this.config.employees.length}`;
    this.elements.configMeta.textContent = `${this.config.organization} · ${APP_VERSION} · ${this.config.configSource} · 직원 ${this.config.employees.length}명`;
    this.elements.versionButton.textContent = APP_VERSION;

    if (this.config.slackChannelLabel) {
      this.elements.slackChannelMeta.classList.remove('hidden');
      this.elements.slackChannelMeta.textContent = `${this.config.slackChannelLabel} 붙여넣기용`;
    } else {
      this.elements.slackChannelMeta.classList.add('hidden');
      this.elements.slackChannelMeta.textContent = '';
    }
  }

  private syncPreview(showToast = false) {
    const selectedEmployees = this.getSelectedEmployees();
    this.syncTargetRank(selectedEmployees.length);
    const teamPlan =
      this.gameMode === 'lunchday' ? this.createTeamPlan(selectedEmployees.length) : { sizes: [], warnings: [] };

    this.resetRunState();
    this.renderModePresentation();
    this.renderEmployeeList();
    this.renderSelectionSummary(selectedEmployees);
    this.renderTeamPreview(teamPlan.sizes);
    this.renderResultBoard(this.gameMode === 'lunchday' ? buildTeamBuckets(teamPlan.sizes) : []);
    this.renderWarnings(this.gameMode === 'lunchday' ? teamPlan.warnings : []);
    this.renderSummaryTiles(selectedEmployees.length, teamPlan.sizes.length);

    this.elements.finisherCount.textContent = '0';

    this.roulette.setMarbles(selectedEmployees.map((employee) => employee.marbleLabel));
    this.applyMarbleColors(selectedEmployees);

    if (selectedEmployees.length) {
      this.elements.stageMeta.textContent =
        this.gameMode === 'lunchday'
          ? `${selectedEmployees.length}명이 출발 대기 중입니다. 프리뷰 상태에서 바로 시작할 수 있습니다.`
          : `${selectedEmployees.length}명 중 ${this.targetRankSetting}위 결과를 뽑을 준비가 끝났습니다.`;
      this.setStatus('대기', 'ready');
    } else {
      this.elements.stageMeta.textContent =
        this.gameMode === 'lunchday'
          ? '참여자를 선택하면 출발 위치에 구슬 프리뷰가 반영됩니다.'
          : '참여자를 선택하면 뽑기 순위판 프리뷰가 준비됩니다.';
      this.setStatus('선택 대기', 'loading');
    }

    this.updateActionState();

    if (showToast) {
      this.showToast('프리뷰를 현재 선택 상태로 다시 맞췄습니다.');
    }
  }

  private renderSelectionSummary(selectedEmployees: EmployeeConfig[]) {
    this.elements.selectionSummary.textContent = summarizeSelectedTeams(selectedEmployees);
  }

  private renderModePresentation() {
    const isLunchdayMode = this.gameMode === 'lunchday';

    this.elements.modeLunchdayButton.classList.toggle('is-active', isLunchdayMode);
    this.elements.modeLastPlaceButton.classList.toggle('is-active', !isLunchdayMode);
    this.elements.summaryGrid.classList.toggle('is-rank-mode', !isLunchdayMode);
    this.elements.teamCountTile.classList.toggle('is-hidden-in-rank', !isLunchdayMode);
    this.elements.teamCountTile.hidden = !isLunchdayMode;
    this.elements.teamCountTile.setAttribute('aria-hidden', String(!isLunchdayMode));
    this.elements.teamSizeTile.classList.toggle('is-wide-in-rank', !isLunchdayMode);
    this.elements.stageTitle.textContent = isLunchdayMode ? '런치데이' : '뽑기';
    this.elements.resultTitle.textContent = isLunchdayMode ? '런치데이 팀' : '뽑기';
    this.elements.resultEyebrow.textContent = isLunchdayMode ? 'Result Board' : 'Rank Pick';
    this.elements.teamCountLabel.textContent = '팀 갯수';
    this.elements.teamSizeLabel.textContent = isLunchdayMode ? '팀당 인원' : '뽑을 순위';
    this.elements.teamCountControl.classList.toggle('is-static', !isLunchdayMode);
    this.elements.teamSizeControl.classList.toggle('is-rank-picker', !isLunchdayMode);
    this.elements.teamSizeMinus.textContent = isLunchdayMode ? '-' : '‹';
    this.elements.teamSizePlus.textContent = isLunchdayMode ? '+' : '›';
    this.elements.teamSizeMinus.setAttribute('aria-label', isLunchdayMode ? '팀당 인원 줄이기' : '이전 순위로 이동');
    this.elements.teamSizePlus.setAttribute('aria-label', isLunchdayMode ? '팀당 인원 늘리기' : '다음 순위로 이동');
    this.elements.publishSlackButton.textContent = isLunchdayMode ? '슬랙 복사' : '결과 복사';
  }

  private renderSummaryTiles(selectedCount: number, plannedTeamCount: number) {
    this.elements.selectedCount.textContent = `${selectedCount}`;

    if (this.gameMode === 'lunchday') {
      this.elements.plannedTeamCount.textContent = `${plannedTeamCount}`;
      this.elements.teamSizeCount.textContent = `${this.teamSizeSetting}`;
      return;
    }

    const finishedCount = this.runState?.finishedMembers.length ?? 0;

    this.elements.plannedTeamCount.textContent = `${finishedCount}`;
    this.elements.teamSizeCount.textContent = this.targetRankSetting ? `${this.targetRankSetting}위` : '-';
  }

  private renderEmployeeList() {
    const visibleEmployees = [...this.getVisibleEmployees()].sort(
      (left, right) => left.team.localeCompare(right.team, 'ko') || left.name.localeCompare(right.name, 'ko')
    );
    const teamColors = buildEmployeeTeamColorMap(this.config.employees);

    if (!visibleEmployees.length) {
      this.elements.employeeList.innerHTML = '<div class="empty-state">검색 조건에 맞는 직원이 없습니다.</div>';
      return;
    }

    this.elements.employeeList.innerHTML = `
      <div class="employee-table">
        <div class="employee-table-head">
          <span>선택</span>
          <span>팀</span>
          <span>이름</span>
        </div>
        ${visibleEmployees
          .map((employee) => {
            const checked = this.selectedIds.has(employee.id) ? 'checked' : '';
            const disabled = employee.enabled && !this.isRunning ? '' : 'disabled';
            const disabledClass = employee.enabled ? '' : 'is-disabled';
            const teamColor = teamColors.get(employee.team) ?? '#7ff0d8';

            return `
              <label class="employee-row ${disabledClass}">
                <input type="checkbox" data-employee-id="${escapeHtml(employee.id)}" ${checked} ${disabled} />
                <span class="team-tag" style="--team-tag-color: ${teamColor}">${escapeHtml(employee.team)}</span>
                <div class="employee-name">${escapeHtml(employee.name)}</div>
              </label>
            `;
          })
          .join('')}
      </div>
    `;
  }

  private renderTeamPreview(sizes: number[]) {
    if (!sizes.length) {
      this.elements.teamSizePreview.innerHTML = '<span class="team-size-pill">선택 인원을 기다리는 중</span>';
      return;
    }

    const groupedSizes = Array.from(
      sizes.reduce((accumulator, size) => {
        accumulator.set(size, (accumulator.get(size) ?? 0) + 1);
        return accumulator;
      }, new Map<number, number>())
    ).sort((left, right) => right[0] - left[0]);

    this.elements.teamSizePreview.innerHTML = groupedSizes
      .map(
        ([size, count]) =>
          `<span class="team-size-pill" style="--team-accent: #0f766e"><i></i>${size}명 팀${count > 1 ? ` × ${count}` : ''}</span>`
      )
      .join('');
  }

  private renderResultBoard(teamBuckets: TeamBucket[]) {
    if (this.gameMode === 'rank-pick') {
      this.renderRankingBoard();
      return;
    }

    this.elements.teamBoard.classList.remove('is-ranking-board');

    if (!teamBuckets.length) {
      this.elements.teamBoard.innerHTML =
        '<div class="empty-state">룰렛을 시작하면 완주 순서대로 팀 카드가 채워집니다.</div>';
      return;
    }

    this.elements.teamBoard.innerHTML = teamBuckets
      .map((team) => {
        const membersHtml = team.members.length
          ? `
              <div class="team-members">
                ${team.members
                  .map(
                    (member) => `
                      <div class="team-member">
                        <span class="team-member-rank">${member.finishRank}</span>
                        <div class="team-member-text">${escapeHtml(member.name)} <span>|</span> ${escapeHtml(member.team)}</div>
                      </div>
                    `
                  )
                  .join('')}
              </div>
            `
          : `<div class="team-placeholder">대기 중</div>`;

        const activeClass = !this.isRunning
          ? ''
          : team.members.length < team.targetSize &&
              this.runState &&
              findTeamBucketByRank(this.runState.teamBuckets, this.runState.finishedLabels.size + 1)?.teamCode ===
                team.teamCode
            ? 'is-active'
            : '';

        return `
          <article class="team-card ${activeClass}" style="--team-accent: ${team.accent}">
            <div class="team-card-head">
              <span class="team-card-label">${escapeHtml(team.teamCode.replace('TEAM-', '팀'))}</span>
              <span class="team-card-count">${team.members.length} / ${team.targetSize}</span>
            </div>
            ${membersHtml}
          </article>
        `;
      })
      .join('');
  }

  private renderRankingBoard() {
    this.elements.teamBoard.classList.add('is-ranking-board');

    const finishedMembers = this.runState?.finishedMembers ?? [];
    const selectedCount = this.getSelectedEmployees().length;
    const targetRank = this.targetRankSetting;

    if (!finishedMembers.length) {
      this.elements.teamBoard.innerHTML = `<div class="empty-state">룰렛을 시작하면 완주 순서대로 순위가 채워지고, ${targetRank || '-'}위가 강조됩니다.</div>`;
      return;
    }

    const nextRank = finishedMembers.length + 1;
    const cards = finishedMembers.map((member) => {
      const isPickedRank = member.finishRank === targetRank;

      return `
        <article class="rank-card ${isPickedRank ? 'is-picked-rank' : ''}">
          <div class="rank-card-head">
            <span class="rank-card-badge">${member.finishRank}위</span>
            ${isPickedRank ? '<span class="rank-card-label">뽑힘</span>' : ''}
          </div>
          <div class="rank-card-name">${escapeHtml(member.name)}</div>
          <div class="rank-card-team">${escapeHtml(member.team)}</div>
        </article>
      `;
    });

    if (finishedMembers.length < selectedCount) {
      cards.push(`
        <article class="rank-card is-pending">
          <div class="rank-card-head">
            <span class="rank-card-badge">${nextRank}위</span>
          </div>
          <div class="rank-card-name">${nextRank <= targetRank ? '뽑는 중' : '집계 중'}</div>
          <div class="rank-card-team">${targetRank}위까지 완주 순서를 기다리고 있습니다.</div>
        </article>
      `);
    }

    this.elements.teamBoard.innerHTML = cards.join('');
  }

  private renderWarnings(warnings: string[]) {
    if (!warnings.length) {
      this.elements.warningBox.classList.add('hidden');
      this.elements.warningBox.textContent = '';
      return;
    }

    this.elements.warningBox.classList.remove('hidden');
    this.elements.warningBox.innerHTML = warnings.map((warning) => escapeHtml(warning)).join('<br />');
  }

  private updateActionState() {
    const selectionCount = this.getSelectedEmployees().length;
    const disabled = selectionCount === 0 || this.isRunning;
    const isLunchdayMode = this.gameMode === 'lunchday';
    const disableTeamControls = disabled || !isLunchdayMode;
    const disableRankControls = disabled || isLunchdayMode;

    this.elements.startButton.disabled = disabled;
    this.elements.clearButton.disabled = this.isRunning;
    this.elements.pasteEmployeesButton.disabled = this.isRunning;
    this.elements.refreshPreviewButton.disabled = this.isRunning;
    this.elements.resetButton.disabled = this.isRunning;
    this.elements.selectAllButton.disabled = this.isRunning;
    this.elements.searchInput.disabled = this.isRunning;
    this.elements.teamCountMinus.disabled = disableTeamControls || this.teamCountSetting <= 1;
    this.elements.teamCountPlus.disabled = disableTeamControls || this.teamCountSetting >= Math.max(1, selectionCount);
    this.elements.teamSizeMinus.disabled = isLunchdayMode
      ? disableTeamControls || this.teamSizeSetting <= 1
      : disableRankControls || this.targetRankSetting <= 1;
    this.elements.teamSizePlus.disabled = isLunchdayMode
      ? disableTeamControls || this.teamSizeSetting >= Math.max(1, selectionCount)
      : disableRankControls || this.targetRankSetting >= Math.max(1, selectionCount);
    this.elements.rankFirstButton.disabled = disableRankControls || this.targetRankSetting <= 1;
    this.elements.rankLastButton.disabled =
      disableRankControls || this.targetRankSetting >= Math.max(1, selectionCount);
    this.elements.publishSlackButton.disabled = this.isPublishingSlack || !this.canPublishSlack();
  }

  private async startRun() {
    if (this.isRunning) {
      return;
    }

    const selectedEmployees = this.getSelectedEmployees();
    if (!selectedEmployees.length) {
      this.showToast('최소 한 명 이상 선택해야 룰렛을 시작할 수 있습니다.');
      return;
    }

    const teamPlan =
      this.gameMode === 'lunchday' ? this.createTeamPlan(selectedEmployees.length) : { sizes: [], warnings: [] };
    const teamBuckets = this.gameMode === 'lunchday' ? buildTeamBuckets(teamPlan.sizes) : [];

    this.runState = {
      finishedLabels: new Set<string>(),
      finishedMembers: [],
      participantsByLabel: new Map(selectedEmployees.map((employee) => [employee.marbleLabel, employee])),
      teamBuckets,
      warnings: teamPlan.warnings,
    };

    this.renderWarnings(this.gameMode === 'lunchday' ? teamPlan.warnings : []);
    this.renderResultBoard(teamBuckets);
    this.lastLogEntries = [];
    this.renderEventLog();
    this.isRunning = true;
    this.elements.finishOverlay.classList.add('hidden');
    this.updateActionState();
    this.renderEmployeeList();
    this.renderSummaryTiles(selectedEmployees.length, teamBuckets.length);

    this.roulette.setMarbles(selectedEmployees.map((employee) => employee.marbleLabel));
    this.applyMarbleColors(selectedEmployees);

    this.setStatus('카운트다운', 'running');
    this.appendLog(
      this.gameMode === 'lunchday'
        ? `${selectedEmployees.length}명으로 런치데이 팀 편성을 시작합니다.`
        : `${selectedEmployees.length}명 중 ${this.targetRankSetting}위 결과를 뽑습니다.`
    );

    await this.playCountdown();

    this.setStatus('진행 중', 'running');
    this.roulette.start();
  }

  private async playCountdown() {
    this.elements.countdown.classList.remove('hidden');

    for (const value of ['3', '2', '1', 'GO']) {
      this.elements.countdown.textContent = value;
      await sleep(560);
    }

    this.elements.countdown.classList.add('hidden');
  }

  private handleFinish(marbleLabel: string, finishRank: number) {
    if (!this.runState || this.runState.finishedLabels.has(marbleLabel)) {
      return;
    }

    const participant = this.runState.participantsByLabel.get(marbleLabel);
    if (!participant) {
      return;
    }

    this.runState.finishedLabels.add(marbleLabel);

    const member: TeamMember = {
      employeeId: participant.id,
      finishRank,
      marbleLabel: participant.marbleLabel,
      name: participant.name,
      team: participant.team,
    };
    this.runState.finishedMembers.push(member);

    this.elements.finisherCount.textContent = `${this.runState.finishedLabels.size}`;
    if (this.gameMode === 'lunchday') {
      const teamBucket = findTeamBucketByRank(this.runState.teamBuckets, finishRank);
      if (!teamBucket) {
        return;
      }

      teamBucket.members.push(member);

      this.appendLog(
        `${finishRank}등 ${participant.name} 도착 · 팀 배정 (${teamBucket.members.length}/${teamBucket.targetSize})`
      );
      this.flashMarquee(`${participant.name} 배정 완료`);
      this.renderResultBoard(this.runState.teamBuckets);
      this.renderSummaryTiles(this.getSelectedEmployees().length, this.runState.teamBuckets.length);
      return;
    }

    const isPickedRank = finishRank === this.targetRankSetting;
    this.appendLog(`${finishRank}위 ${participant.name} 기록${isPickedRank ? ' · 선택 순위' : ''}`);
    this.flashMarquee(
      isPickedRank ? `${this.targetRankSetting}위 ${participant.name} 뽑힘` : `${participant.name} ${finishRank}위`
    );
    this.renderResultBoard(this.runState.teamBuckets);
    this.renderSummaryTiles(this.getSelectedEmployees().length, this.runState.teamBuckets.length);
  }

  private applyMarbleColors(employees: EmployeeConfig[]) {
    const teamColors = buildEmployeeTeamColorMap(this.config.employees);
    employees.forEach((employee) => {
      this.roulette.setMarbleColor(employee.marbleLabel, teamColors.get(employee.team) ?? '#abcdbd');
    });
  }

  private createTeamPlan(participantCount: number) {
    this.syncTeamSettings(participantCount);
    return computeTeamSizesFromSettings(participantCount, this.teamCountSetting, this.teamSizeSetting);
  }

  private syncTeamSettings(participantCount: number) {
    if (participantCount <= 0) {
      this.teamCountSetting = 0;
      this.teamSizeSetting = 0;
      return;
    }

    if (!this.teamCountSetting || !this.teamSizeSetting) {
      const defaults = computeTeamSizes(participantCount, this.config.minTeamSize, this.config.maxTeamSize);
      this.teamCountSetting = defaults.sizes.length || 1;
      this.teamSizeSetting = Math.max(...defaults.sizes, 1);
      this.teamSettingMode = 'count';
      return;
    }

    if (this.teamSettingMode === 'count') {
      this.teamCountSetting = clamp(this.teamCountSetting, 1, participantCount);
      this.teamSizeSetting = Math.max(1, Math.ceil(participantCount / this.teamCountSetting));
      return;
    }

    this.teamSizeSetting = clamp(this.teamSizeSetting, 1, participantCount);
    this.teamCountSetting = Math.max(1, Math.ceil(participantCount / this.teamSizeSetting));
  }

  private syncTargetRank(participantCount: number) {
    if (participantCount <= 0) {
      this.targetRankSetting = 0;
      return;
    }

    this.targetRankSetting = clamp(this.targetRankSetting || 1, 1, participantCount);
    this.persistTargetRank();
  }

  private adjustTeamCount(delta: number) {
    if (this.isRunning) {
      return;
    }

    const participantCount = this.getSelectedEmployees().length;
    if (!participantCount) {
      return;
    }

    this.teamSettingMode = 'count';
    this.teamCountSetting = clamp((this.teamCountSetting || 1) + delta, 1, participantCount);
    this.teamSizeSetting = Math.max(1, Math.ceil(participantCount / this.teamCountSetting));
    this.syncPreview();
  }

  private adjustTeamSize(delta: number) {
    if (this.isRunning) {
      return;
    }

    const participantCount = this.getSelectedEmployees().length;
    if (!participantCount) {
      return;
    }

    this.teamSettingMode = 'size';
    this.teamSizeSetting = clamp((this.teamSizeSetting || 1) + delta, 1, participantCount);
    this.teamCountSetting = Math.max(1, Math.ceil(participantCount / this.teamSizeSetting));
    this.syncPreview();
  }

  private setTargetRank(rank: number) {
    if (this.isRunning || this.gameMode !== 'rank-pick') {
      return;
    }

    const participantCount = this.getSelectedEmployees().length;
    if (!participantCount) {
      return;
    }

    this.targetRankSetting = clamp(rank, 1, participantCount);
    this.persistTargetRank();
    this.syncPreview();
  }

  private adjustTargetRank(delta: number) {
    this.setTargetRank((this.targetRankSetting || 1) + delta);
  }

  private togglePasteModal(isOpen: boolean) {
    this.elements.pasteModal.classList.toggle('hidden', !isOpen);

    if (isOpen) {
      this.elements.pasteTextarea.value = this.config.employees
        .map((employee) => `${employee.name}\t${employee.team}`)
        .join('\n');
      this.elements.pasteTextarea.focus();
    }
  }

  private applyPastedEmployees() {
    const parsedEmployees = parseEmployeesFromText(this.elements.pasteTextarea.value);
    if (!parsedEmployees.length) {
      this.showToast('붙여넣은 명단에서 직원을 찾지 못했습니다.');
      return;
    }

    this.config = {
      ...this.config,
      configSource: 'local-paste',
      employees: parsedEmployees,
    };
    this.selectedIds = new Set(parsedEmployees.filter((employee) => employee.enabled).map((employee) => employee.id));
    window.localStorage.setItem(CUSTOM_EMPLOYEES_KEY, JSON.stringify(parsedEmployees));
    this.persistSelection();
    this.renderStaticConfig();
    this.togglePasteModal(false);
    this.syncPreview();
    this.showToast(`직원 ${parsedEmployees.length}명을 붙여넣기 명단으로 교체했습니다.`);
  }

  private canPublishSlack() {
    if (!this.runState) {
      return false;
    }

    const selectedCount = this.getSelectedEmployees().length;
    return selectedCount > 0 && this.runState.finishedLabels.size === selectedCount;
  }

  private async publishResultsToSlack() {
    if (!this.runState || !this.canPublishSlack()) {
      this.showToast(
        this.gameMode === 'lunchday'
          ? '팀 편성이 끝난 뒤에 Slack용 결과를 복사할 수 있습니다.'
          : '뽑기가 끝난 뒤에 Slack용 결과를 복사할 수 있습니다.'
      );
      return;
    }

    this.isPublishingSlack = true;
    this.updateActionState();

    try {
      const markdown = this.buildSlackCopy();
      await copyTextToClipboard(markdown);
      this.showToast(
        this.config.slackChannelLabel
          ? `${this.config.slackChannelLabel}용 결과를 클립보드에 복사했습니다.`
          : 'Slack 붙여넣기용 결과를 클립보드에 복사했습니다.'
      );
    } catch (error) {
      console.warn('[LunchdayApp] Failed to copy Slack message:', error);
      this.showToast(error instanceof Error ? error.message : '클립보드 복사에 실패했습니다.');
    } finally {
      this.isPublishingSlack = false;
      this.updateActionState();
    }
  }

  private buildSlackCopy(): string {
    if (!this.runState) {
      return '';
    }

    const selectedCount = this.getSelectedEmployees().length;
    if (this.gameMode === 'rank-pick') {
      const rankingLines = this.runState.finishedMembers.map((member) => {
        const suffix = member.finishRank === this.targetRankSetting ? ' (뽑힘)' : '';
        return `${member.finishRank}. ${member.name} | ${member.team}${suffix}`;
      });

      return [
        `*${this.config.title} ${this.targetRankSetting}위 뽑기 결과*`,
        `총 ${selectedCount}명 · 선택 순위 ${this.targetRankSetting}위`,
        '',
        ...rankingLines,
      ].join('\n');
    }

    const header = [
      `*${this.config.title} 런치데이 결과*`,
      `총 ${selectedCount}명 · ${this.runState.teamBuckets.length}개 팀`,
    ];
    const teamSections = this.runState.teamBuckets.map((team) => {
      const lines = [`*${team.teamCode.replace('TEAM-', '팀')}* (${team.members.length}/${team.targetSize})`];

      if (!team.members.length) {
        lines.push('• 대기 중');
        return lines.join('\n');
      }

      team.members.forEach((member) => {
        lines.push(`• ${member.name} | ${member.team}`);
      });

      return lines.join('\n');
    });

    return [...header, '', ...teamSections].join('\n\n');
  }

  private appendLog(message: string) {
    const timestamp = new Date().toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    this.lastLogEntries.unshift(`${timestamp} · ${message}`);
    this.lastLogEntries = this.lastLogEntries.slice(0, MAX_LOG_ITEMS);
    this.renderEventLog();
  }

  private renderEventLog() {
    if (!this.lastLogEntries.length) {
      this.elements.eventLog.innerHTML = '<li>선택 상태를 맞춘 뒤 룰렛 시작 버튼을 눌러주세요.</li>';
      return;
    }

    this.elements.eventLog.innerHTML = this.lastLogEntries.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  }

  private flashMarquee(message: string) {
    this.elements.updateMarquee.textContent = message;
    this.elements.updateMarquee.classList.remove('hidden');

    if (this.marqueeTimer !== null) {
      window.clearTimeout(this.marqueeTimer);
    }

    this.marqueeTimer = window.setTimeout(() => {
      this.elements.updateMarquee.classList.add('hidden');
    }, 1800);
  }

  private renderFinishOverlayCopy() {
    const pickedMember =
      this.gameMode === 'rank-pick'
        ? this.runState?.finishedMembers.find((member) => member.finishRank === this.targetRankSetting)
        : null;

    this.elements.finishOverlay.classList.toggle('is-rank-result', Boolean(pickedMember));
    this.elements.finishOverlayLineOne.textContent = 'HAPPY';
    this.elements.finishOverlayLineTwo.textContent = 'HAPPY';
    this.elements.finishOverlayLineThree.textContent = pickedMember?.name ?? 'LUNCH';
    this.elements.finishOverlayLineFour.textContent = pickedMember ? 'DAY!' : 'DAY';
  }

  private resetRunState() {
    this.runState = null;
    this.isRunning = false;
    this.lastLogEntries = [];
    this.elements.finishOverlay.classList.add('hidden');
    this.elements.finishOverlay.classList.remove('is-rank-result');
    this.renderFinishOverlayCopy();
    this.elements.updateMarquee.classList.add('hidden');
    this.renderEventLog();
  }

  private setStatus(text: string, tone: 'ready' | 'running' | 'complete' | 'loading') {
    this.elements.statusBadge.textContent = text;
    this.elements.statusBadge.classList.remove('is-running', 'is-complete');

    if (tone === 'running') {
      this.elements.statusBadge.classList.add('is-running');
    }

    if (tone === 'complete') {
      this.elements.statusBadge.classList.add('is-complete');
    }
  }

  private getSelectedEmployees(): EmployeeConfig[] {
    return this.config.employees.filter((employee) => employee.enabled && this.selectedIds.has(employee.id));
  }

  private getVisibleEmployees(): EmployeeConfig[] {
    const keyword = this.elements.searchInput.value.trim().toLowerCase();
    if (!keyword) {
      return this.config.employees;
    }

    return this.config.employees.filter((employee) => {
      const haystack = `${employee.name} ${employee.team} ${employee.marbleLabel}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }

  private waitForRouletteReady(): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setInterval(() => {
        if (this.roulette.isReady) {
          window.clearInterval(timer);
          resolve();
        }
      }, 60);
    });
  }

  private showToast(message: string) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    this.elements.toastRoot.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 2200);
  }

  private query<T extends Element>(selector: string): T {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Missing required element: ${selector}`);
    }

    return element as T;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function buildEmployeeTeamColorMap(employees: EmployeeConfig[]): Map<string, string> {
  const teamColors = new Map<string, string>();

  employees.forEach((employee) => {
    if (!teamColors.has(employee.team)) {
      teamColors.set(employee.team, SOURCE_TEAM_PALETTE[teamColors.size % SOURCE_TEAM_PALETTE.length]);
    }
  });

  return teamColors;
}

function normalizeStoredEmployee(employee: EmployeeConfig, index: number): EmployeeConfig {
  let name = (employee.name || '').trim();
  let team = (employee.team || '미지정 팀').trim() || '미지정 팀';

  if (name && team === '미지정 팀' && /\s/.test(name)) {
    const repaired = splitEmployeeLine(name);
    if (repaired.length >= 2) {
      name = repaired[0];
      team = repaired.slice(1).join(' ').trim() || team;
    }
  }

  return {
    enabled: employee.enabled !== false,
    id: employee.id || `EMP-${String(index + 1).padStart(3, '0')}`,
    marbleLabel: name || employee.marbleLabel || `EMP ${index + 1}`,
    name: name || employee.name || `직원 ${index + 1}`,
    team,
  };
}

function parseEmployeesFromText(text: string): EmployeeConfig[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => splitEmployeeLine(line))
    .filter((columns) => columns.length > 0);

  if (!rows.length) {
    return [];
  }

  let startIndex = 0;
  let nameIndex = 0;
  let teamIndex = 1;

  const header = rows[0].map((column) => column.toLowerCase());
  const detectedNameIndex = header.findIndex((column) => ['name', '이름'].includes(column));
  const detectedTeamIndex = header.findIndex((column) => ['team', '팀', '조직'].includes(column));

  if (detectedNameIndex >= 0 || detectedTeamIndex >= 0) {
    startIndex = 1;
    nameIndex = detectedNameIndex >= 0 ? detectedNameIndex : 0;
    teamIndex = detectedTeamIndex >= 0 ? detectedTeamIndex : 1;
  }

  return rows
    .slice(startIndex)
    .map((columns, index) => {
      const name = (columns[nameIndex] || columns[0] || '').trim();
      const team = (columns[teamIndex] || columns[1] || '미지정 팀').trim() || '미지정 팀';

      if (!name) {
        return null;
      }

      return {
        enabled: true,
        id: `EMP-${String(index + 1).padStart(3, '0')}`,
        marbleLabel: name,
        name,
        team,
      } satisfies EmployeeConfig;
    })
    .filter((employee): employee is EmployeeConfig => Boolean(employee));
}

function splitEmployeeLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.includes('\t')) {
    return trimmed
      .split('\t')
      .map((column) => column.trim())
      .filter(Boolean);
  }

  if (trimmed.includes('|')) {
    return trimmed
      .split('|')
      .map((column) => column.trim())
      .filter(Boolean);
  }

  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean);
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return [tokens[0], tokens.slice(1).join(' ')];
  }

  return [trimmed];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand('copy');
  textarea.remove();

  if (!copied) {
    throw new Error('클립보드 복사에 실패했습니다.');
  }
}

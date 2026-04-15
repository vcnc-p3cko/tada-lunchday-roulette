import type { AppConfig, EmployeeConfig, TeamBucket, TeamMember } from './lunchdayTypes';
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
const MAX_LOG_ITEMS = 8;
const SOURCE_TEAM_PALETTE = [
  '#ef5a5a',
  '#f0ad42',
  '#d2f24b',
  '#6be96b',
  '#7ff0d8',
  '#70dcf7',
  '#6d9fff',
  '#9968ff',
  '#e46cff',
  '#ff78c9',
];

type RunState = {
  finishedLabels: Set<string>;
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
  currentTeamLabel: HTMLElement;
  employeeList: HTMLDivElement;
  eventLog: HTMLOListElement;
  finisherCount: HTMLElement;
  lastFinisher: HTMLElement;
  pasteApplyButton: HTMLButtonElement;
  pasteEmployeesButton: HTMLButtonElement;
  pasteModal: HTMLDivElement;
  pasteModalBackdrop: HTMLDivElement;
  pasteModalCloseButton: HTMLButtonElement;
  pasteTextarea: HTMLTextAreaElement;
  plannedTeamCount: HTMLElement;
  publishSlackButton: HTMLButtonElement;
  refreshPreviewButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  searchInput: HTMLInputElement;
  selectAllButton: HTMLButtonElement;
  selectedCount: HTMLElement;
  selectionSummary: HTMLDivElement;
  stageMeta: HTMLParagraphElement;
  stageStateLabel: HTMLElement;
  startButton: HTMLButtonElement;
  statusBadge: HTMLSpanElement;
  slackChannelMeta: HTMLSpanElement;
  teamBoard: HTMLDivElement;
  teamCountMinus: HTMLButtonElement;
  teamCountPlus: HTMLButtonElement;
  teamSizeCount: HTMLElement;
  teamSizeMinus: HTMLButtonElement;
  teamSizePlus: HTMLButtonElement;
  teamSizePreview: HTMLDivElement;
  toastRoot: HTMLDivElement;
  totalEmployeeCount: HTMLElement;
  warningBox: HTMLDivElement;
  updateMarquee: HTMLDivElement;
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
  private teamCountSetting = 0;
  private teamSizeSetting = 0;
  private teamSettingMode: 'count' | 'size' = 'count';

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
      currentTeamLabel: this.query('#currentTeamLabel'),
      employeeList: this.query('#employeeList'),
      eventLog: this.query('#eventLog'),
      finisherCount: this.query('#finisherCount'),
      lastFinisher: this.query('#lastFinisher'),
      pasteApplyButton: this.query('#pasteApplyButton'),
      pasteEmployeesButton: this.query('#pasteEmployeesButton'),
      pasteModal: this.query('#pasteModal'),
      pasteModalBackdrop: this.query('#pasteModalBackdrop'),
      pasteModalCloseButton: this.query('#pasteModalCloseButton'),
      pasteTextarea: this.query('#pasteTextarea'),
      plannedTeamCount: this.query('#plannedTeamCount'),
      publishSlackButton: this.query('#publishSlackButton'),
      refreshPreviewButton: this.query('#refreshPreviewButton'),
      resetButton: this.query('#resetButton'),
      searchInput: this.query('#searchInput'),
      selectAllButton: this.query('#selectAllButton'),
      selectedCount: this.query('#selectedCount'),
      selectionSummary: this.query('#selectionSummary'),
      stageMeta: this.query('#stageMeta'),
      stageStateLabel: this.query('#stageStateLabel'),
      startButton: this.query('#startButton'),
      statusBadge: this.query('#statusBadge'),
      slackChannelMeta: this.query('#slackChannelMeta'),
      teamBoard: this.query('#teamBoard'),
      teamCountMinus: this.query('#teamCountMinus'),
      teamCountPlus: this.query('#teamCountPlus'),
      teamSizeCount: this.query('#teamSizeCount'),
      teamSizeMinus: this.query('#teamSizeMinus'),
      teamSizePlus: this.query('#teamSizePlus'),
      teamSizePreview: this.query('#teamSizePreview'),
      toastRoot: this.query('#toastRoot'),
      totalEmployeeCount: this.query('#totalEmployeeCount'),
      warningBox: this.query('#warningBox'),
      updateMarquee: this.query('#updateMarquee'),
    };
  }

  private bindEvents() {
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
      this.adjustTeamSize(-1);
    });

    this.elements.teamSizePlus.addEventListener('click', () => {
      this.adjustTeamSize(1);
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
      this.setStatus('편성 완료', 'complete');
      this.elements.stageStateLabel.textContent = '편성 완료';
      this.updateActionState();
      this.renderEmployeeList();

      const completedCount = this.runState.finishedLabels.size;
      this.appendLog(`팀 편성이 완료되었습니다. 총 ${completedCount}명이 완주했습니다.`);
      this.showToast('런치데이 팀 편성이 완료되었습니다.');
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

  private persistSelection() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.selectedIds]));
  }

  private renderStaticConfig() {
    this.elements.appTitle.textContent = this.config.title;
    this.elements.appSubtitle.textContent = this.config.subtitle;
    this.elements.totalEmployeeCount.textContent = `${this.config.employees.length}`;
    this.elements.configMeta.textContent = `${this.config.organization} · ${this.config.configSource} · 직원 ${this.config.employees.length}명`;

    if (this.config.slackEnabled) {
      this.elements.slackChannelMeta.classList.remove('hidden');
      this.elements.slackChannelMeta.textContent = this.config.slackChannelLabel
        ? `Slack ${this.config.slackChannelLabel}`
        : 'Slack 게시 가능';
    } else {
      this.elements.slackChannelMeta.classList.add('hidden');
      this.elements.slackChannelMeta.textContent = '';
    }
  }

  private syncPreview(showToast = false) {
    const selectedEmployees = this.getSelectedEmployees();
    const teamPlan = this.createTeamPlan(selectedEmployees.length);

    this.resetRunState();
    this.renderSelectionSummary(selectedEmployees);
    this.renderEmployeeList();
    this.renderTeamPreview(teamPlan.sizes);
    this.renderTeamBoard(buildTeamBuckets(teamPlan.sizes));
    this.renderWarnings(teamPlan.warnings);

    this.elements.plannedTeamCount.textContent = `${teamPlan.sizes.length}`;
    this.elements.selectedCount.textContent = `${selectedEmployees.length}`;
    this.elements.teamSizeCount.textContent = `${this.teamSizeSetting}`;
    this.elements.finisherCount.textContent = '0';
    this.elements.lastFinisher.textContent = '-';
    this.elements.currentTeamLabel.textContent = teamPlan.sizes.length ? '순차 배정' : '-';
    this.elements.stageStateLabel.textContent = '준비 완료';

    this.roulette.setMarbles(selectedEmployees.map((employee) => employee.marbleLabel));
    this.applyMarbleColors(selectedEmployees);

    if (selectedEmployees.length) {
      this.elements.stageMeta.textContent = `${selectedEmployees.length}명이 출발 대기 중입니다. 프리뷰 상태에서 바로 시작할 수 있습니다.`;
      this.setStatus('준비 완료', 'ready');
    } else {
      this.elements.stageMeta.textContent = '참여자를 선택하면 출발 위치에 구슬 프리뷰가 반영됩니다.';
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

  private renderEmployeeList() {
    const visibleEmployees = this.getVisibleEmployees();
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

  private renderTeamBoard(teamBuckets: TeamBucket[]) {
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
              <span class="team-card-count">${team.members.length} / ${team.targetSize}</span>
            </div>
            ${membersHtml}
          </article>
        `;
      })
      .join('');
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

    this.elements.startButton.disabled = disabled;
    this.elements.clearButton.disabled = this.isRunning;
    this.elements.pasteEmployeesButton.disabled = this.isRunning;
    this.elements.refreshPreviewButton.disabled = this.isRunning;
    this.elements.resetButton.disabled = this.isRunning;
    this.elements.selectAllButton.disabled = this.isRunning;
    this.elements.searchInput.disabled = this.isRunning;
    this.elements.teamCountMinus.disabled = disabled || this.teamCountSetting <= 1;
    this.elements.teamCountPlus.disabled = disabled || this.teamCountSetting >= Math.max(1, selectionCount);
    this.elements.teamSizeMinus.disabled = disabled || this.teamSizeSetting <= 1;
    this.elements.teamSizePlus.disabled = disabled || this.teamSizeSetting >= Math.max(1, selectionCount);
    this.elements.publishSlackButton.disabled =
      this.isPublishingSlack || !this.config.slackEnabled || !this.canPublishSlack();
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

    const teamPlan = this.createTeamPlan(selectedEmployees.length);
    const teamBuckets = buildTeamBuckets(teamPlan.sizes);

    this.runState = {
      finishedLabels: new Set<string>(),
      participantsByLabel: new Map(selectedEmployees.map((employee) => [employee.marbleLabel, employee])),
      teamBuckets,
      warnings: teamPlan.warnings,
    };

    this.renderWarnings(teamPlan.warnings);
    this.renderTeamBoard(teamBuckets);
    this.lastLogEntries = [];
    this.renderEventLog();
    this.isRunning = true;
    this.updateActionState();
    this.renderEmployeeList();

    this.roulette.setMarbles(selectedEmployees.map((employee) => employee.marbleLabel));
    this.applyMarbleColors(selectedEmployees);

    this.setStatus('카운트다운', 'running');
    this.elements.stageStateLabel.textContent = '카운트다운';
    this.appendLog(`${selectedEmployees.length}명으로 런치데이 팀 편성을 시작합니다.`);

    await this.playCountdown();

    this.elements.stageStateLabel.textContent = '진행 중';
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

    const teamBucket = findTeamBucketByRank(this.runState.teamBuckets, finishRank);
    if (!teamBucket) {
      return;
    }

    const member: TeamMember = {
      employeeId: participant.id,
      finishRank,
      marbleLabel: participant.marbleLabel,
      name: participant.name,
      team: participant.team,
    };

    teamBucket.members.push(member);

    this.elements.finisherCount.textContent = `${this.runState.finishedLabels.size}`;
    this.elements.lastFinisher.textContent = participant.name;
    this.elements.currentTeamLabel.textContent = findTeamBucketByRank(this.runState.teamBuckets, finishRank + 1)
      ? '순차 배정 중'
      : '모든 팀 배정 완료';

    this.appendLog(
      `${finishRank}등 ${participant.name} 도착 · 팀 배정 (${teamBucket.members.length}/${teamBucket.targetSize})`
    );
    this.flashMarquee(`${participant.name} 배정 완료`);
    this.renderTeamBoard(this.runState.teamBuckets);
  }

  private applyMarbleColors(employees: EmployeeConfig[]) {
    const teamColors = buildEmployeeTeamColorMap(this.config.employees);
    employees.forEach((employee) => {
      this.roulette.setMarbleColor(employee.marbleLabel, teamColors.get(employee.team) ?? '#7ff0d8');
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
    if (!this.config.slackEnabled) {
      this.showToast('Slack 게시 설정이 없습니다.');
      return;
    }

    if (!this.runState || !this.canPublishSlack()) {
      this.showToast('팀 편성이 끝난 뒤에 Slack으로 게시할 수 있습니다.');
      return;
    }

    this.isPublishingSlack = true;
    this.updateActionState();

    try {
      const response = await fetch('/api/publish-results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organization: this.config.organization,
          teams: this.runState.teamBuckets.map((team) => ({
            members: team.members.map((member) => ({
              name: member.name,
              team: member.team,
            })),
            teamLabel: team.teamLabel,
          })),
          title: `${this.config.title} 결과`,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ error: 'Slack 게시에 실패했습니다.' }))) as {
          error?: string;
        };
        throw new Error(payload.error || 'Slack 게시에 실패했습니다.');
      }

      this.showToast(
        this.config.slackChannelLabel
          ? `${this.config.slackChannelLabel} 채널에 결과를 게시했습니다.`
          : 'Slack에 결과를 게시했습니다.'
      );
    } catch (error) {
      console.warn('[LunchdayApp] Failed to publish Slack message:', error);
      this.showToast(error instanceof Error ? error.message : 'Slack 게시에 실패했습니다.');
    } finally {
      this.isPublishingSlack = false;
      this.updateActionState();
    }
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

  private resetRunState() {
    this.runState = null;
    this.isRunning = false;
    this.lastLogEntries = [];
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

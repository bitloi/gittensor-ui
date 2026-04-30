import { describe, expect, it } from 'vitest';
import {
  buildDailyDiscoveryPulse,
  getPreviousRollingWindowBounds,
  getRollingWindowBounds,
} from '../pages/dashboard/dashboardData';
import { type CommitLog, type MinerEvaluation } from '../api';

const NOW = new Date('2026-04-30T12:00:00.000Z');

const buildMiner = (overrides: Partial<MinerEvaluation>): MinerEvaluation => ({
  id: 1,
  uid: 1,
  hotkey: 'hotkey-1',
  githubId: '101',
  githubUsername: 'alice',
  failedReason: '',
  baseTotalScore: 0,
  totalScore: 0,
  totalNodesScored: 0,
  totalOpenPrs: 0,
  totalPrs: 0,
  uniqueReposCount: 0,
  isIssueEligible: true,
  issueDiscoveryScore: 0,
  issueCredibility: 0,
  totalSolvedIssues: 0,
  totalValidSolvedIssues: 0,
  totalClosedIssues: 0,
  totalOpenIssues: 0,
  evaluatedAt: '2026-04-30T00:00:00.000Z',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
  ...overrides,
});

const buildPr = (overrides: Partial<CommitLog>): CommitLog => ({
  pullRequestNumber: 1,
  hotkey: 'hotkey-1',
  pullRequestTitle: 'Improve issue discovery',
  additions: 12,
  deletions: 3,
  commitCount: 1,
  repository: 'gittensor/example',
  mergedAt: '2026-04-30T10:00:00.000Z',
  closedAt: '2026-04-30T10:00:00.000Z',
  prCreatedAt: '2026-04-30T09:00:00.000Z',
  prState: 'MERGED',
  author: 'alice',
  githubId: '101',
  score: '10',
  issueMultiplier: '1',
  labelMultiplier: 0,
  tokenScore: 10,
  ...overrides,
});

describe('daily discovery pulse', () => {
  const miners: MinerEvaluation[] = [
    buildMiner({
      id: 1,
      uid: 1,
      githubId: '101',
      githubUsername: 'alice',
      hotkey: 'hotkey-alice',
      issueDiscoveryScore: 320,
      issueCredibility: 0.9,
      totalValidSolvedIssues: 12,
    }),
    buildMiner({
      id: 2,
      uid: 2,
      githubId: '202',
      githubUsername: 'bob',
      hotkey: 'hotkey-bob',
      issueDiscoveryScore: 180,
      issueCredibility: 0.72,
      totalValidSolvedIssues: 4,
    }),
  ];

  it('builds fixed rolling and previous 24h windows', () => {
    expect(getRollingWindowBounds(NOW)).toEqual({
      startMs: Date.parse('2026-04-29T12:00:00.000Z'),
      endMs: Date.parse('2026-04-30T12:00:00.000Z'),
    });
    expect(getPreviousRollingWindowBounds(NOW)).toEqual({
      startMs: Date.parse('2026-04-28T12:00:00.000Z'),
      endMs: Date.parse('2026-04-29T12:00:00.000Z'),
    });
  });

  it('uses merged discovery PRs and linked issue timestamps for the daily pulse', () => {
    const pulse = buildDailyDiscoveryPulse(
      [
        buildPr({
          pullRequestNumber: 10,
          mergedAt: '2026-04-30T10:00:00.000Z',
          tokenScore: 12,
          score: '8',
          linkedIssues: [
            {
              number: 42,
              title: 'Fresh issue',
              state: 'CLOSED',
              authorGithubId: '202',
              createdAt: '2026-04-30T09:00:00.000Z',
            },
          ],
        }),
        buildPr({
          pullRequestNumber: 9,
          mergedAt: '2026-04-29T10:00:00.000Z',
          tokenScore: 5,
          score: '5',
          linkedIssues: [
            {
              number: 41,
              title: 'Previous issue',
              state: 'CLOSED',
              authorGithubId: '202',
              createdAt: '2026-04-29T09:00:00.000Z',
            },
          ],
        }),
      ],
      miners,
      NOW,
    );

    expect(pulse.isFallback).toBe(false);
    expect(pulse.kpis).toEqual([
      {
        label: 'Discovery solves',
        value: '1',
        delta: 'flat vs prev 24h',
        tone: 'neutral',
      },
      {
        label: 'Discovery score',
        value: '12',
        delta: '+140% vs prev 24h',
        tone: 'positive',
      },
      {
        label: 'New linked issues',
        value: '1',
        delta: 'flat vs prev 24h',
        tone: 'neutral',
      },
      {
        label: 'Active discoverers',
        value: '2',
        delta: 'flat vs prev 24h',
        tone: 'neutral',
      },
      {
        label: 'Repos touched',
        value: '1',
        delta: 'flat vs prev 24h',
        tone: 'neutral',
      },
    ]);
    expect(pulse.discoverers).toHaveLength(2);
    expect(pulse.discoverers[0]).toMatchObject({
      githubId: '202',
      githubUsername: 'bob',
      roleLabel: 'Top 24h Issue Scout',
      primaryMetric: '1 linked issue',
      primaryMetricLabel: 'opened in 24h',
      issueCredibility: 0.72,
    });
    expect(pulse.discoverers[1]).toMatchObject({
      githubId: '101',
      githubUsername: 'alice',
      roleLabel: 'Most 24h Discovery Solves',
      primaryMetric: '1 solve',
      primaryMetricLabel: 'merged discovery PRs',
      secondaryMetric: '12',
      secondaryMetricLabel: '24h discovery score',
      issueCredibility: 0.9,
    });
  });

  it('ignores non-discovery PRs and falls back to baseline issue-eligible miners', () => {
    const pulse = buildDailyDiscoveryPulse(
      [
        buildPr({
          issueMultiplier: '0',
          labelMultiplier: 0,
          tokenScore: 25,
        }),
      ],
      miners,
      NOW,
    );

    expect(pulse.isFallback).toBe(true);
    expect(pulse.kpis.map((kpi) => kpi.value)).toEqual([
      '0',
      '0',
      '0',
      '0',
      '0',
    ]);
    expect(pulse.discoverers[0]).toMatchObject({
      githubId: '101',
      roleLabel: 'Baseline issue-eligible leader',
      primaryMetric: '320',
      primaryMetricLabel: 'baseline discovery score',
      secondaryMetricLabel: 'all-time context',
    });
  });
});

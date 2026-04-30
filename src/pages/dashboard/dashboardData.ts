/**
 * Pure dashboard data builders.
 *
 * This module converts raw PR, issue, and miner datasets into UI-facing models
 * for trends, overview sections, KPIs, and featured contributors.
 *
 * Most dashboard sections are driven by the caller-provided time range.
 * Featured contributors intentionally use a fixed 35-day lookback window.
 */
import {
  type CommitLog,
  type MinerEvaluation,
  type Repository,
} from '../../api';
import { type IssueBounty } from '../../api/models/Issues';
import {
  getPrStatusLabel,
  isIssueDiscoveryMultiplierPr,
  parseNumber,
} from '../../utils';

export type PresetTimeRange = '1d' | '7d' | '35d';
export type TrendTimeRange = PresetTimeRange | 'all';
export type TrendSeriesKey =
  | 'mergedPrs'
  | 'issuesResolved'
  | 'prsOpened'
  | 'issuesOpened';

export interface DashboardTrendSeries {
  key: TrendSeriesKey;
  values: number[];
}

export interface DashboardOverviewMetric {
  label: string;
  value: number;
  delta: string;
}

export interface DashboardOverviewPool {
  metrics: DashboardOverviewMetric[];
  chartSegments: Array<{ label: string; value: number }>;
  chartCenterLabel: string;
}

export interface DashboardOverviewSection {
  title: string;
  eligible: DashboardOverviewPool;
  ineligible: DashboardOverviewPool;
}

export interface DashboardKpi {
  title: string;
  value: number;
  subtitle: string;
}

export interface DashboardFeaturedContributor {
  featuredLabel: string;
  githubId: string;
  githubUsername?: string;
  name: string;
  metrics: Array<{
    value: string;
    unit: string;
  }>;
  repos: string[];
  /** Earnings in USD per day (displayed prominently like miner cards). */
  usdPerDay?: number;
  /** Credibility as 0-1 fraction (rendered as donut ring). */
  credibility?: number;
  /** Segments for the credibility donut (e.g. Merged/Open/Closed). */
  segments?: Array<{ label: string; value: number }>;
}

export interface DashboardDiscoveryKpi {
  label: string;
  value: string;
  delta?: string;
  tone?: 'positive' | 'neutral' | 'warning';
}

export interface DashboardFeaturedDiscoverer {
  id: string;
  githubId?: string;
  githubUsername?: string;
  name: string;
  avatarUsername?: string;
  roleLabel: string;
  primaryMetric: string;
  primaryMetricLabel: string;
  secondaryMetric?: string;
  secondaryMetricLabel?: string;
  repos: string[];
  href?: string;
  tone?: 'success' | 'neutral' | 'warning';
  issueCredibility?: number;
}

export interface DashboardDiscoveryPulse {
  windowLabel: string;
  kpis: DashboardDiscoveryKpi[];
  discoverers: DashboardFeaturedDiscoverer[];
  isFallback: boolean;
}

type FeaturedWorkStatusTone = 'merged' | 'open' | 'closed';

export interface FeaturedWorkPr {
  prNumber: number;
  title: string;
  score: number;
  author: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  statusLabel: string;
  statusTone: FeaturedWorkStatusTone;
}

export interface FeaturedWorkRepo {
  repository: string;
  prCount: number;
  totalScore: number;
  windowLabel: string;
  prs: FeaturedWorkPr[];
}

interface FeaturedWorkConfig {
  readonly repoCount: number;
  readonly prsPerRepo: number;
  readonly windowHours: number;
  readonly windowLabel: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const GITTENSOR_START_MS = Date.UTC(2025, 11, 1, 0, 0, 0);

const RANGE_CONFIG: Record<
  PresetTimeRange,
  { windowMs: number; bucketMs: number; points: number }
> = {
  '1d': { windowMs: DAY_MS, bucketMs: 3 * HOUR_MS, points: 8 },
  '7d': { windowMs: 7 * DAY_MS, bucketMs: DAY_MS, points: 7 },
  '35d': { windowMs: 35 * DAY_MS, bucketMs: DAY_MS, points: 35 },
};

const TREND_SERIES_KEYS: TrendSeriesKey[] = [
  'mergedPrs',
  'issuesResolved',
  'prsOpened',
  'issuesOpened',
];
const CURRENT_LOOKBACK_WINDOW: PresetTimeRange = '35d';

export type WindowBounds = {
  startMs: number;
  endMs: number;
};

const toTimestamp = (value?: string | null): number | null => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isWithinWindow = (timestamp: number | null, window: WindowBounds) =>
  timestamp !== null && timestamp >= window.startMs && timestamp < window.endMs;

export const getRangeConfig = (range: PresetTimeRange) => RANGE_CONFIG[range];

export const getWindowBounds = (
  range: TrendTimeRange,
  now = new Date(),
): WindowBounds => {
  if (range === 'all') {
    return { startMs: GITTENSOR_START_MS, endMs: now.getTime() };
  }

  const { windowMs } = getRangeConfig(range);
  const endMs = now.getTime();
  return { startMs: endMs - windowMs, endMs };
};

export const getPreviousWindowBounds = (
  range: TrendTimeRange,
  now = new Date(),
): WindowBounds | null => {
  if (range === 'all') {
    return null;
  }

  const current = getWindowBounds(range, now);
  const { windowMs } = getRangeConfig(range);
  return {
    startMs: current.startMs - windowMs,
    endMs: current.startMs,
  };
};

const getUtcWeekStart = (timestamp: number) => {
  const date = new Date(timestamp);
  const dayOfWeek = date.getUTCDay();
  const diffToMonday = (dayOfWeek + 6) % 7;
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - diffToMonday,
  );
};

const formatTrendBucketLabel = (timestamp: number, range: TrendTimeRange) => {
  if (range === '1d') {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
};

const buildTrendBuckets = (
  timestamps: Array<number | null>,
  range: TrendTimeRange,
  now = new Date(),
): Array<{ startMs: number; endMs: number; label: string }> => {
  if (range !== 'all') {
    const { points, bucketMs, windowMs } = getRangeConfig(range);
    const startMs = now.getTime() - windowMs;

    return Array.from({ length: points }, (_, index) => {
      const bucketStart = startMs + index * bucketMs;
      return {
        startMs: bucketStart,
        endMs: bucketStart + bucketMs,
        label: formatTrendBucketLabel(bucketStart, range),
      };
    });
  }

  const firstWeekStart = getUtcWeekStart(GITTENSOR_START_MS);
  const currentWeekStart = getUtcWeekStart(now.getTime());
  const endExclusive = currentWeekStart + WEEK_MS;
  const buckets: Array<{ startMs: number; endMs: number; label: string }> = [];

  for (
    let bucketStart = firstWeekStart;
    bucketStart < endExclusive;
    bucketStart += WEEK_MS
  ) {
    buckets.push({
      startMs: bucketStart,
      endMs: bucketStart + WEEK_MS,
      label: formatTrendBucketLabel(bucketStart, range),
    });
  }

  return buckets;
};

const bucketTimestamps = (
  timestamps: Array<number | null>,
  buckets: Array<{ startMs: number; endMs: number; label: string }>,
) => {
  const values = Array.from({ length: buckets.length }, () => 0);

  timestamps.forEach((timestamp) => {
    if (timestamp === null) return;

    for (let index = 0; index < buckets.length; index += 1) {
      const bucket = buckets[index];
      if (timestamp >= bucket.startMs && timestamp < bucket.endMs) {
        values[index] += 1;
        break;
      }
    }
  });

  return values;
};

const optionalCredibilityMetrics = (
  credibility: unknown,
): Array<{ value: string; unit: string }> => {
  const n = parseNumber(credibility as number);
  return n > 0 ? [{ value: `${Math.round(n * 100)}%`, unit: 'Cred.' }] : [];
};

const formatDelta = (
  currentValue: number,
  previousValue: number,
  decimals = 2,
) => {
  if (currentValue === 0 && previousValue === 0) return '0%';
  if (previousValue === 0) return '0%';

  const percentChange = ((currentValue - previousValue) / previousValue) * 100;
  const rounded = percentChange.toFixed(decimals).replace(/\.?0+$/, '');

  return `${percentChange > 0 ? '+' : ''}${rounded}%`;
};

export const buildDashboardTrendData = (
  prs: CommitLog[],
  issues: IssueBounty[],
  range: TrendTimeRange,
  now = new Date(),
): { labels: string[]; series: DashboardTrendSeries[] } => {
  const mergedPrTimestamps = prs.map((pr) => toTimestamp(pr.mergedAt));
  const openedPrTimestamps = prs.map((pr) => toTimestamp(pr.prCreatedAt));
  const openedIssueTimestamps = issues.map((issue) =>
    toTimestamp(issue.createdAt),
  );
  const resolvedIssueTimestamps = issues
    .filter((issue) => issue.status === 'completed')
    .map((issue) => toTimestamp(issue.completedAt));
  const buckets = buildTrendBuckets(
    [
      ...mergedPrTimestamps,
      ...openedPrTimestamps,
      ...openedIssueTimestamps,
      ...resolvedIssueTimestamps,
    ],
    range,
    now,
  );
  const mergedPrValues = bucketTimestamps(mergedPrTimestamps, buckets);
  const openedPrValues = bucketTimestamps(openedPrTimestamps, buckets);
  const openedIssueValues = bucketTimestamps(openedIssueTimestamps, buckets);
  const resolvedIssueValues = bucketTimestamps(
    resolvedIssueTimestamps,
    buckets,
  );

  const seriesByKey: Record<TrendSeriesKey, number[]> = {
    mergedPrs: mergedPrValues,
    issuesResolved: resolvedIssueValues,
    prsOpened: openedPrValues,
    issuesOpened: openedIssueValues,
  };

  return {
    labels: buckets.map((bucket) => bucket.label),
    series: TREND_SERIES_KEYS.map((key) => ({
      key,
      values: seriesByKey[key],
    })),
  };
};

const getPrOverviewMetrics = (prs: CommitLog[], window: WindowBounds) => {
  const statusCounts = {
    total: 0,
    merged: 0,
    open: 0,
    closed: 0,
  };

  prs.forEach((pr) => {
    const normalizedState = getPrStatusLabel(pr);
    const createdInWindow = isWithinWindow(toTimestamp(pr.prCreatedAt), window);
    const mergedInWindow = isWithinWindow(toTimestamp(pr.mergedAt), window);
    // API does not currently return closedAt for PRs — fall back to
    // prCreatedAt so closed PRs are still tracked within the window.
    const closedInWindow = isWithinWindow(
      toTimestamp(pr.closedAt ?? pr.prCreatedAt),
      window,
    );

    if (createdInWindow) {
      statusCounts.open += 1;
      statusCounts.total += 1;
    }

    if (mergedInWindow) {
      statusCounts.merged += 1;
      statusCounts.total += 1;
    }

    if (normalizedState === 'Closed' && closedInWindow) {
      statusCounts.closed += 1;
      statusCounts.total += 1;
    }
  });

  return {
    total: statusCounts.total,
    merged: statusCounts.merged,
    open: statusCounts.open,
    closed: statusCounts.closed,
  };
};

// Issue discovery metrics are sourced from per-miner aggregates (which
// reflect every discovered issue) rather than the /issues endpoint (which
// only returns bounty-backed issues — far fewer). Aggregates are all-time
// totals, so the Issue Discoveries card is not windowed by the range filter.
const getIssueOverviewMetricsFromMiners = (miners: MinerEvaluation[]) => {
  let solved = 0;
  let closed = 0;
  let open = 0;
  miners.forEach((miner) => {
    solved += miner.totalSolvedIssues ?? 0;
    closed += miner.totalClosedIssues ?? 0;
    open += miner.totalOpenIssues ?? 0;
  });
  return {
    total: solved + open + closed,
    solved,
    open,
    closed,
  };
};

const formatCenterPercent = (resolved: number, total: number) => {
  if (total <= 0) return '0%';
  return `${((resolved / total) * 100).toFixed(1)}%`;
};

export const buildDashboardOverview = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
  range: TrendTimeRange,
  now = new Date(),
): DashboardOverviewSection[] => {
  const currentWindow = getWindowBounds(range, now);
  const previousWindow = getPreviousWindowBounds(range, now);

  const eligibleIds = new Set(
    miners.filter((m) => m.isEligible).map((m) => m.githubId),
  );
  const eligiblePrs = prs.filter(
    (pr) => pr.githubId && eligibleIds.has(pr.githubId),
  );
  const ineligiblePrs = prs.filter(
    (pr) => !pr.githubId || !eligibleIds.has(pr.githubId),
  );

  const eligibleMiners = miners.filter((m) => m.isIssueEligible);
  const ineligibleMiners = miners.filter((m) => !m.isIssueEligible);

  const currentEligiblePrMetrics = getPrOverviewMetrics(
    eligiblePrs,
    currentWindow,
  );
  const previousEligiblePrMetrics = previousWindow
    ? getPrOverviewMetrics(eligiblePrs, previousWindow)
    : null;

  const currentIneligiblePrMetrics = getPrOverviewMetrics(
    ineligiblePrs,
    currentWindow,
  );
  const previousIneligiblePrMetrics = previousWindow
    ? getPrOverviewMetrics(ineligiblePrs, previousWindow)
    : null;

  const eligibleIssueMetrics =
    getIssueOverviewMetricsFromMiners(eligibleMiners);
  const ineligibleIssueMetrics =
    getIssueOverviewMetricsFromMiners(ineligibleMiners);

  const getMetricDelta = (currentValue: number, previousValue?: number) =>
    range === 'all' || previousValue === undefined
      ? '0%'
      : formatDelta(currentValue, previousValue);

  const buildPrPool = (
    current: ReturnType<typeof getPrOverviewMetrics>,
    previous: ReturnType<typeof getPrOverviewMetrics> | null,
  ): DashboardOverviewPool => ({
    chartSegments: [
      { label: 'Merged', value: current.merged },
      { label: 'Open', value: current.open },
      { label: 'Closed', value: current.closed },
    ],
    chartCenterLabel: formatCenterPercent(
      current.merged,
      current.merged + current.closed,
    ),
    metrics: [
      {
        label: 'Total',
        value: current.total,
        delta: getMetricDelta(current.total, previous?.total),
      },
      {
        label: 'Merged',
        value: current.merged,
        delta: getMetricDelta(current.merged, previous?.merged),
      },
      {
        label: 'Open',
        value: current.open,
        delta: getMetricDelta(current.open, previous?.open),
      },
      {
        label: 'Closed',
        value: current.closed,
        delta: getMetricDelta(current.closed, previous?.closed),
      },
    ],
  });

  const buildIssuePool = (
    issueMetrics: ReturnType<typeof getIssueOverviewMetricsFromMiners>,
  ): DashboardOverviewPool => ({
    chartSegments: [
      { label: 'Solved', value: issueMetrics.solved },
      { label: 'Open', value: issueMetrics.open },
      { label: 'Closed', value: issueMetrics.closed },
    ],
    chartCenterLabel: formatCenterPercent(
      issueMetrics.solved,
      issueMetrics.solved + issueMetrics.closed,
    ),
    // Issue metrics come from per-miner aggregates (all-time totals), so
    // there is no previous-window comparison available — deltas are '0%'.
    metrics: [
      { label: 'Total', value: issueMetrics.total, delta: '0%' },
      { label: 'Solved', value: issueMetrics.solved, delta: '0%' },
      { label: 'Open', value: issueMetrics.open, delta: '0%' },
      { label: 'Closed', value: issueMetrics.closed, delta: '0%' },
    ],
  });

  return [
    {
      title: 'OSS Contributions',
      eligible: buildPrPool(
        currentEligiblePrMetrics,
        previousEligiblePrMetrics,
      ),
      ineligible: buildPrPool(
        currentIneligiblePrMetrics,
        previousIneligiblePrMetrics,
      ),
    },
    {
      title: 'Issue Discoveries',
      eligible: buildIssuePool(eligibleIssueMetrics),
      ineligible: buildIssuePool(ineligibleIssueMetrics),
    },
  ];
};

export const buildDashboardKpis = (
  prs: CommitLog[],
  issues: IssueBounty[],
  range: TrendTimeRange,
  now = new Date(),
): DashboardKpi[] => {
  const window = getWindowBounds(range, now);
  const mergedWindowPrs = prs.filter((pr) =>
    isWithinWindow(toTimestamp(pr.mergedAt), window),
  );
  const solvedIssues = issues.filter(
    (issue) =>
      issue.status === 'completed' &&
      isWithinWindow(toTimestamp(issue.completedAt), window),
  );

  const totalCommits = mergedWindowPrs.reduce(
    (sum, pr) => sum + parseNumber(pr.commitCount),
    0,
  );
  const totalIssuesSolved = solvedIssues.length;
  const totalLinesCommitted = mergedWindowPrs.reduce(
    (sum, pr) => sum + parseNumber(pr.additions) + parseNumber(pr.deletions),
    0,
  );
  const totalRepositories = new Set(
    mergedWindowPrs.map((pr) => pr.repository).filter(Boolean),
  ).size;

  return [
    {
      title: 'Total Commits',
      value: totalCommits,
      subtitle: 'Total PR snapshots',
    },
    {
      title: 'Issues Solved',
      value: totalIssuesSolved,
      subtitle: 'Problem resolved and closed',
    },
    {
      title: 'Total Lines Committed',
      value: totalLinesCommitted,
      subtitle: 'Cumulative code contributions',
    },
    {
      title: 'Total Repositories',
      value: totalRepositories,
      subtitle: 'Projects contributed to',
    },
  ];
};

const getTopContributorRepos = (prs: CommitLog[], githubId: string) => {
  const currentWindow = getWindowBounds(CURRENT_LOOKBACK_WINDOW);
  const repoStats = new Map<
    string,
    { mergedPrs: number; totalScore: number; lastMergedAt: number }
  >();

  prs.forEach((pr) => {
    const mergedAt = toTimestamp(pr.mergedAt);
    if (
      pr.githubId !== githubId ||
      !pr.repository ||
      !isWithinWindow(mergedAt, currentWindow)
    ) {
      return;
    }

    const existing = repoStats.get(pr.repository) ?? {
      mergedPrs: 0,
      totalScore: 0,
      lastMergedAt: 0,
    };

    existing.mergedPrs += 1;
    existing.totalScore += parseNumber(pr.score);
    existing.lastMergedAt = Math.max(existing.lastMergedAt, mergedAt ?? 0);

    repoStats.set(pr.repository, existing);
  });

  return [...repoStats.entries()]
    .sort((a, b) => {
      const mergedPrDiff = b[1].mergedPrs - a[1].mergedPrs;
      if (mergedPrDiff !== 0) return mergedPrDiff;

      const scoreDiff = b[1].totalScore - a[1].totalScore;
      if (scoreDiff !== 0) return scoreDiff;

      const mergedAtDiff = b[1].lastMergedAt - a[1].lastMergedAt;
      if (mergedAtDiff !== 0) return mergedAtDiff;

      return a[0].localeCompare(b[0]);
    })
    .slice(0, 3)
    .map(([repo]) => repo);
};

const getHighestScoringMergedAuthor = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
  exclude: Set<string> = new Set(),
): DashboardFeaturedContributor | undefined => {
  const currentWindow = getWindowBounds(CURRENT_LOOKBACK_WINDOW);

  const topPr = [...prs]
    .filter(
      (pr) =>
        !!pr.githubId &&
        !exclude.has(pr.githubId) &&
        isWithinWindow(toTimestamp(pr.mergedAt), currentWindow),
    )
    .sort((a, b) => {
      const scoreDiff = parseNumber(b.score) - parseNumber(a.score);
      if (scoreDiff !== 0) return scoreDiff;

      const mergedAtDiff =
        (toTimestamp(b.mergedAt) ?? 0) - (toTimestamp(a.mergedAt) ?? 0);
      if (mergedAtDiff !== 0) return mergedAtDiff;

      return b.pullRequestNumber - a.pullRequestNumber;
    })[0];

  if (!topPr?.githubId) return undefined;

  const miner = miners.find((m) => m.githubId === topPr.githubId);
  return {
    githubId: topPr.githubId,
    githubUsername: topPr.author || undefined,
    featuredLabel: 'Highest-Scoring PR Author',
    name: topPr.author ?? topPr.githubId,
    metrics: [
      {
        value: Math.round(parseNumber(topPr.score)).toLocaleString(),
        unit: 'Score',
      },
      ...optionalCredibilityMetrics(miner?.credibility),
    ],
    repos: topPr.repository ? [topPr.repository] : [],
    usdPerDay: parseNumber(miner?.usdPerDay),
    credibility: parseNumber(miner?.credibility),
    segments: [
      { label: 'Merged', value: parseNumber(miner?.totalMergedPrs) },
      { label: 'Open', value: parseNumber(miner?.totalOpenPrs) },
      { label: 'Closed', value: parseNumber(miner?.totalClosedPrs) },
    ],
  };
};

const pickTopOssContributor = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
  exclude: Set<string> = new Set(),
): DashboardFeaturedContributor | undefined => {
  const topOssMiner = [...miners]
    .sort((a, b) => {
      const scoreDiff = parseNumber(b.totalScore) - parseNumber(a.totalScore);
      if (scoreDiff !== 0) return scoreDiff;

      const mergedPrDiff = (b.totalMergedPrs ?? 0) - (a.totalMergedPrs ?? 0);
      if (mergedPrDiff !== 0) return mergedPrDiff;

      return a.id - b.id;
    })
    .find(
      (miner) =>
        parseNumber(miner.totalScore) > 0 && !exclude.has(miner.githubId),
    );

  if (!topOssMiner) return undefined;

  return {
    featuredLabel: 'Top OSS Miner',
    githubId: topOssMiner.githubId,
    githubUsername: topOssMiner.githubUsername,
    name: topOssMiner.githubUsername ?? topOssMiner.githubId,
    metrics: [
      {
        value: Math.round(parseNumber(topOssMiner.totalScore)).toLocaleString(),
        unit: 'Score',
      },
      ...optionalCredibilityMetrics(topOssMiner.credibility),
    ],
    repos: getTopContributorRepos(prs, topOssMiner.githubId),
    usdPerDay: parseNumber(topOssMiner.usdPerDay),
    credibility: parseNumber(topOssMiner.credibility),
    segments: [
      { label: 'Merged', value: parseNumber(topOssMiner.totalMergedPrs) },
      { label: 'Open', value: parseNumber(topOssMiner.totalOpenPrs) },
      { label: 'Closed', value: parseNumber(topOssMiner.totalClosedPrs) },
    ],
  };
};

const pickMostMergedPrMiner = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
  exclude: Set<string> = new Set(),
): DashboardFeaturedContributor | undefined => {
  const mostMergedPrMiner = [...miners]
    .filter((m) => !exclude.has(m.githubId))
    .sort((a, b) => {
      const diff = (b.totalMergedPrs ?? 0) - (a.totalMergedPrs ?? 0);
      if (diff !== 0) return diff;
      return b.totalScore - a.totalScore;
    })[0];

  if (!mostMergedPrMiner) return undefined;

  return {
    featuredLabel: 'Most Merged PRs',
    githubId: mostMergedPrMiner.githubId,
    githubUsername: mostMergedPrMiner.githubUsername,
    name: mostMergedPrMiner.githubUsername ?? mostMergedPrMiner.githubId,
    metrics: [
      {
        value: `${mostMergedPrMiner.totalMergedPrs ?? 0}`,
        unit: 'Merged',
      },
      ...optionalCredibilityMetrics(mostMergedPrMiner.credibility),
    ],
    repos: getTopContributorRepos(prs, mostMergedPrMiner.githubId),
    usdPerDay: parseNumber(mostMergedPrMiner.usdPerDay),
    credibility: parseNumber(mostMergedPrMiner.credibility),
    segments: [
      { label: 'Merged', value: parseNumber(mostMergedPrMiner.totalMergedPrs) },
      { label: 'Open', value: parseNumber(mostMergedPrMiner.totalOpenPrs) },
      { label: 'Closed', value: parseNumber(mostMergedPrMiner.totalClosedPrs) },
    ],
  };
};

export const buildFeaturedContributors = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
): DashboardFeaturedContributor[] => {
  const seen = new Set<string>();
  const contributors: DashboardFeaturedContributor[] = [];
  const pickers: Array<() => DashboardFeaturedContributor | undefined> = [
    () => pickTopOssContributor(prs, miners, seen),
    () => pickMostMergedPrMiner(prs, miners, seen),
    () => getHighestScoringMergedAuthor(prs, miners, seen),
  ];
  for (const pick of pickers) {
    const c = pick();
    if (c) {
      seen.add(c.githubId);
      contributors.push(c);
    }
  }
  return contributors;
};

const mapPrStatusTone = (
  statusLabel: ReturnType<typeof getPrStatusLabel>,
): FeaturedWorkStatusTone => {
  if (statusLabel === 'Merged') return 'merged';
  if (statusLabel === 'Closed') return 'closed';
  return 'open';
};

const FEATURED_WORK_CONFIG: FeaturedWorkConfig = {
  repoCount: 3,
  prsPerRepo: 4,
  windowHours: 24,
  windowLabel: '24h',
} as const;

interface RepoAccumulator {
  prs: CommitLog[];
  totalScore: number;
}

type InactiveRepoSet = Set<string>;

const buildInactiveRepoSet = (repos: Repository[]): InactiveRepoSet =>
  new Set(
    repos
      .filter((r: Repository): boolean => !!r.inactiveAt)
      .map((r: Repository): string => r.fullName.toLowerCase()),
  );

const isMergedInWindow = (
  pr: CommitLog,
  cutoff: number,
  inactiveRepos: InactiveRepoSet,
): boolean => {
  const merged: number | null = toTimestamp(pr.mergedAt);
  return (
    merged !== null &&
    merged >= cutoff &&
    getPrStatusLabel(pr) === 'Merged' &&
    Boolean(pr.repository) &&
    !inactiveRepos.has(pr.repository.toLowerCase())
  );
};

const groupPrsByRepo = (
  windowPrs: CommitLog[],
): Map<string, RepoAccumulator> => {
  const repoMap = new Map<string, RepoAccumulator>();
  for (const pr of windowPrs) {
    const key: string = pr.repository.toLowerCase();
    const entry: RepoAccumulator = repoMap.get(key) ?? {
      prs: [],
      totalScore: 0,
    };
    entry.prs.push(pr);
    entry.totalScore += parseNumber(pr.score);
    repoMap.set(key, entry);
  }
  return repoMap;
};

const sortReposByActivity = (
  entries: Array<[string, RepoAccumulator]>,
): Array<[string, RepoAccumulator]> =>
  entries.sort(
    ([, a]: [string, RepoAccumulator], [, b]: [string, RepoAccumulator]) =>
      b.totalScore - a.totalScore || b.prs.length - a.prs.length,
  );

const mapCommitLogToFeaturedPr = (pr: CommitLog): FeaturedWorkPr => {
  const statusLabel: ReturnType<typeof getPrStatusLabel> = getPrStatusLabel(pr);
  const statusTone: FeaturedWorkStatusTone = mapPrStatusTone(statusLabel);
  return {
    prNumber: pr.pullRequestNumber,
    title: pr.pullRequestTitle || `PR #${pr.pullRequestNumber}`,
    score: parseNumber(pr.score),
    author: pr.author || 'unknown',
    mergedAt: pr.mergedAt ?? null,
    additions: parseNumber(pr.additions),
    deletions: parseNumber(pr.deletions),
    statusLabel,
    statusTone,
  };
};

const buildRepoEntry = (
  repoPrs: CommitLog[],
  totalScore: number,
  config: FeaturedWorkConfig,
): FeaturedWorkRepo => {
  const sorted: CommitLog[] = [...repoPrs].sort(
    (a: CommitLog, b: CommitLog) => parseNumber(b.score) - parseNumber(a.score),
  );
  const canonical: string = sorted[0].repository;
  const topPrs: FeaturedWorkPr[] = sorted
    .slice(0, config.prsPerRepo)
    .map(mapCommitLogToFeaturedPr);
  return {
    repository: canonical,
    prCount: repoPrs.length,
    totalScore,
    windowLabel: config.windowLabel,
    prs: topPrs,
  };
};

export const buildFeaturedWork = (
  prs: CommitLog[],
  repos: Repository[],
): FeaturedWorkRepo[] => {
  const config: FeaturedWorkConfig = FEATURED_WORK_CONFIG;
  const now: number = Date.now();
  const cutoff: number = now - config.windowHours * HOUR_MS;

  const inactiveRepos: InactiveRepoSet = buildInactiveRepoSet(repos);

  const windowPrs: CommitLog[] = prs.filter((pr: CommitLog): boolean =>
    isMergedInWindow(pr, cutoff, inactiveRepos),
  );

  const repoMap: Map<string, RepoAccumulator> = groupPrsByRepo(windowPrs);

  const rankedEntries: Array<[string, RepoAccumulator]> = sortReposByActivity(
    Array.from(repoMap.entries()),
  );

  return rankedEntries
    .slice(0, config.repoCount)
    .map(
      ([, { prs: repoPrs, totalScore }]: [
        string,
        RepoAccumulator,
      ]): FeaturedWorkRepo => buildRepoEntry(repoPrs, totalScore, config),
    );
};

interface DailyDiscovererStats {
  key: string;
  githubId?: string;
  githubUsername?: string;
  name: string;
  avatarUsername?: string;
  repos: Set<string>;
  linkedIssuesOpened: number;
  discoveryPrsMerged: number;
  discoveryScore: number;
  highestDiscoveryPrScore: number;
  fastestCloseMs?: number;
  lastActivityMs: number;
  baselineIssueScore: number;
  baselineSolvedIssues: number;
  baselineIssueCredibility: number;
}

interface DailyActorIdentity {
  miner?: MinerEvaluation;
  githubId?: string;
  githubUsername?: string;
  hotkey?: string;
}

interface DailyActivitySnapshot {
  linkedIssuesOpened: number;
  discoveryPrsMerged: number;
  discoveryScore: number;
  repos: Set<string>;
  discoverers: Map<string, DailyDiscovererStats>;
}

interface MinerIndexes {
  byGithubId: Map<string, MinerEvaluation>;
  byUsername: Map<string, MinerEvaluation>;
  byHotkey: Map<string, MinerEvaluation>;
}

const DAILY_DISCOVERY_WINDOW_HOURS = 24;

export const getRollingWindowBounds = (
  now = new Date(),
  windowHours = DAILY_DISCOVERY_WINDOW_HOURS,
): WindowBounds => {
  const endMs = now.getTime();
  return {
    startMs: endMs - windowHours * HOUR_MS,
    endMs,
  };
};

export const getPreviousRollingWindowBounds = (
  now = new Date(),
  windowHours = DAILY_DISCOVERY_WINDOW_HOURS,
): WindowBounds => {
  const current = getRollingWindowBounds(now, windowHours);
  const windowMs = windowHours * HOUR_MS;
  return {
    startMs: current.startMs - windowMs,
    endMs: current.startMs,
  };
};

const normalizeLookupValue = (value?: string | null) =>
  value?.trim().toLowerCase() ?? '';

const buildMinerIndexes = (miners: MinerEvaluation[]): MinerIndexes => {
  const indexes: MinerIndexes = {
    byGithubId: new Map(),
    byUsername: new Map(),
    byHotkey: new Map(),
  };

  miners.forEach((miner) => {
    if (miner.githubId) {
      indexes.byGithubId.set(miner.githubId, miner);
    }

    const usernameKey = normalizeLookupValue(miner.githubUsername);
    if (usernameKey) {
      indexes.byUsername.set(usernameKey, miner);
    }

    if (miner.hotkey) {
      indexes.byHotkey.set(miner.hotkey, miner);
    }
  });

  return indexes;
};

const shortHotkey = (hotkey: string) => {
  if (hotkey.length <= 14) return hotkey;
  return `${hotkey.slice(0, 6)}...${hotkey.slice(-4)}`;
};

const getMinerDetailsHref = (githubId?: string) =>
  githubId
    ? `/miners/details?githubId=${encodeURIComponent(
        githubId,
      )}&mode=issues&tab=open-issues`
    : undefined;

const resolveUsernameActor = (
  username: string | null | undefined,
  indexes: MinerIndexes,
): DailyActorIdentity | null => {
  const normalizedUsername = normalizeLookupValue(username);
  if (!normalizedUsername) return null;

  const miner = indexes.byUsername.get(normalizedUsername);
  return {
    miner,
    githubId: miner?.githubId,
    githubUsername: miner?.githubUsername ?? username?.trim(),
  };
};

const resolveGithubIdActor = (
  githubId: string | null | undefined,
  indexes: MinerIndexes,
): DailyActorIdentity | null => {
  if (!githubId) return null;

  const miner = indexes.byGithubId.get(githubId);
  return {
    miner,
    githubId,
    githubUsername: miner?.githubUsername,
  };
};

const resolvePrActor = (
  pr: CommitLog,
  indexes: MinerIndexes,
): DailyActorIdentity | null => {
  if (pr.githubId) {
    const miner = indexes.byGithubId.get(pr.githubId);
    return {
      miner,
      githubId: pr.githubId,
      githubUsername: miner?.githubUsername ?? pr.author,
    };
  }

  return resolveUsernameActor(pr.author, indexes);
};

const getDailyActorKey = (identity: DailyActorIdentity): string | null => {
  if (identity.miner?.githubId) return `github:${identity.miner.githubId}`;
  if (identity.githubId) return `github:${identity.githubId}`;

  const usernameKey = normalizeLookupValue(identity.githubUsername);
  if (usernameKey) return `user:${usernameKey}`;

  if (identity.hotkey) return `hotkey:${identity.hotkey}`;
  return null;
};

const ensureDailyDiscoverer = (
  discoverers: Map<string, DailyDiscovererStats>,
  identity: DailyActorIdentity,
): DailyDiscovererStats | null => {
  const key = getDailyActorKey(identity);
  if (!key) return null;

  const existing = discoverers.get(key);
  if (existing) return existing;

  const miner = identity.miner;
  const githubId = miner?.githubId ?? identity.githubId;
  const githubUsername = miner?.githubUsername ?? identity.githubUsername;
  const name =
    githubUsername ?? githubId ?? shortHotkey(identity.hotkey ?? key);
  const baselineSolvedIssues = parseNumber(
    miner?.totalValidSolvedIssues ?? miner?.totalSolvedIssues,
  );

  const stats: DailyDiscovererStats = {
    key,
    githubId,
    githubUsername,
    name,
    avatarUsername: githubUsername,
    repos: new Set(),
    linkedIssuesOpened: 0,
    discoveryPrsMerged: 0,
    discoveryScore: 0,
    highestDiscoveryPrScore: 0,
    lastActivityMs: 0,
    baselineIssueScore: parseNumber(miner?.issueDiscoveryScore),
    baselineSolvedIssues,
    baselineIssueCredibility: parseNumber(miner?.issueCredibility),
  };

  discoverers.set(key, stats);
  return stats;
};

const addRepoContext = (
  stats: DailyDiscovererStats,
  repositoryFullName?: string | null,
) => {
  if (repositoryFullName) {
    stats.repos.add(repositoryFullName);
  }
};

const updateLastActivity = (
  stats: DailyDiscovererStats,
  timestamp: number | null,
) => {
  if (timestamp !== null) {
    stats.lastActivityMs = Math.max(stats.lastActivityMs, timestamp);
  }
};

const getLinkedIssueKey = (repositoryFullName: string, issueNumber: number) =>
  `${repositoryFullName.toLowerCase()}#${issueNumber}`;

const getDiscoveryPrScore = (pr: CommitLog) => {
  const tokenScore = parseNumber(pr.tokenScore);
  return tokenScore > 0 ? tokenScore : parseNumber(pr.score);
};

const buildDailyActivitySnapshot = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
  window: WindowBounds,
): DailyActivitySnapshot => {
  const indexes = buildMinerIndexes(miners);
  const discoverers = new Map<string, DailyDiscovererStats>();
  const seenLinkedIssues = new Set<string>();
  const snapshot: DailyActivitySnapshot = {
    linkedIssuesOpened: 0,
    discoveryPrsMerged: 0,
    discoveryScore: 0,
    repos: new Set(),
    discoverers,
  };

  prs.forEach((pr) => {
    const mergedAt = toTimestamp(pr.mergedAt);
    if (
      !isWithinWindow(mergedAt, window) ||
      !isIssueDiscoveryMultiplierPr(pr)
    ) {
      return;
    }

    const identity = resolvePrActor(pr, indexes);
    const score = getDiscoveryPrScore(pr);

    snapshot.discoveryPrsMerged += 1;
    snapshot.discoveryScore += score;
    if (pr.repository) snapshot.repos.add(pr.repository);

    const prStats = identity
      ? ensureDailyDiscoverer(discoverers, identity)
      : null;
    if (prStats) {
      prStats.discoveryPrsMerged += 1;
      prStats.discoveryScore += score;
      prStats.highestDiscoveryPrScore = Math.max(
        prStats.highestDiscoveryPrScore,
        score,
      );
      addRepoContext(prStats, pr.repository);
      updateLastActivity(prStats, mergedAt);
    }

    pr.linkedIssues?.forEach((issue) => {
      const createdAt = toTimestamp(issue.createdAt);
      if (!isWithinWindow(createdAt, window)) return;

      const repoFullName = pr.repository;
      if (!repoFullName) return;

      const key = getLinkedIssueKey(repoFullName, issue.number);
      if (seenLinkedIssues.has(key)) return;
      seenLinkedIssues.add(key);
      snapshot.linkedIssuesOpened += 1;

      const issueIdentity = resolveGithubIdActor(issue.authorGithubId, indexes);
      if (!issueIdentity) return;

      const issueStats = ensureDailyDiscoverer(discoverers, issueIdentity);
      if (!issueStats) return;

      issueStats.linkedIssuesOpened += 1;
      addRepoContext(issueStats, repoFullName);
      updateLastActivity(issueStats, createdAt);

      if (createdAt !== null && mergedAt !== null) {
        const closeDurationMs = mergedAt - createdAt;
        if (closeDurationMs >= 0) {
          issueStats.fastestCloseMs =
            issueStats.fastestCloseMs === undefined
              ? closeDurationMs
              : Math.min(issueStats.fastestCloseMs, closeDurationMs);
        }
      }
    });
  });

  return snapshot;
};

const formatWholeNumber = (value: number) =>
  Math.round(value).toLocaleString('en-US');

const formatDailyDelta = (currentValue: number, previousValue: number) => {
  if (currentValue === previousValue) return 'flat vs prev 24h';
  if (previousValue <= 0) {
    return currentValue > 0 ? 'new vs prev 24h' : 'flat vs prev 24h';
  }

  const percentChange = ((currentValue - previousValue) / previousValue) * 100;
  const rounded = percentChange
    .toFixed(Math.abs(percentChange) >= 10 ? 0 : 1)
    .replace(/\.0$/, '');

  return `${percentChange > 0 ? '+' : ''}${rounded}% vs prev 24h`;
};

const getDailyKpiTone = (
  currentValue: number,
  previousValue: number,
): DashboardDiscoveryKpi['tone'] => {
  if (currentValue > previousValue) return 'positive';
  if (currentValue < previousValue) return 'warning';
  return 'neutral';
};

const totalDailyActivity = (stats: DailyDiscovererStats) =>
  stats.linkedIssuesOpened + stats.discoveryPrsMerged;

const sortRepos = (repos: Set<string>) =>
  [...repos].sort((a, b) => a.localeCompare(b));

const formatIssueCount = (value: number, singular: string) =>
  `${formatWholeNumber(value)} ${singular}${value === 1 ? '' : 's'}`;

const formatDuration = (durationMs: number) => {
  if (durationMs < HOUR_MS) {
    return `${Math.max(1, Math.round(durationMs / (60 * 1000)))}m`;
  }

  if (durationMs < DAY_MS) {
    return `${(durationMs / HOUR_MS).toFixed(1).replace(/\.0$/, '')}h`;
  }

  return `${(durationMs / DAY_MS).toFixed(1).replace(/\.0$/, '')}d`;
};

const toDailyDiscoverer = (
  stats: DailyDiscovererStats,
  roleLabel: string,
  primaryMetric: string,
  primaryMetricLabel: string,
  options?: {
    secondaryMetric?: string;
    secondaryMetricLabel?: string;
    tone?: DashboardFeaturedDiscoverer['tone'];
  },
): DashboardFeaturedDiscoverer => ({
  id: stats.key,
  githubId: stats.githubId,
  githubUsername: stats.githubUsername,
  name: stats.name,
  avatarUsername: stats.avatarUsername,
  roleLabel,
  primaryMetric,
  primaryMetricLabel,
  secondaryMetric: options?.secondaryMetric,
  secondaryMetricLabel: options?.secondaryMetricLabel,
  repos: sortRepos(stats.repos),
  href: getMinerDetailsHref(stats.githubId),
  tone: options?.tone ?? 'success',
  issueCredibility: stats.baselineIssueCredibility,
});

export const pickTopDailyIssueScout = (
  stats: DailyDiscovererStats[],
  exclude: Set<string> = new Set(),
): DashboardFeaturedDiscoverer | undefined => {
  const top = [...stats]
    .filter((entry) => entry.linkedIssuesOpened > 0 && !exclude.has(entry.key))
    .sort((a, b) => {
      const issueDiff = b.linkedIssuesOpened - a.linkedIssuesOpened;
      if (issueDiff !== 0) return issueDiff;

      const baselineDiff = b.baselineIssueScore - a.baselineIssueScore;
      if (baselineDiff !== 0) return baselineDiff;

      return b.lastActivityMs - a.lastActivityMs;
    })[0];

  if (!top) return undefined;

  return toDailyDiscoverer(
    top,
    'Top 24h Issue Scout',
    formatIssueCount(top.linkedIssuesOpened, 'linked issue'),
    'opened in 24h',
    {
      secondaryMetric: formatWholeNumber(top.baselineIssueScore),
      secondaryMetricLabel: 'baseline score',
    },
  );
};

export const pickTopDailySolver = (
  stats: DailyDiscovererStats[],
  exclude: Set<string> = new Set(),
): DashboardFeaturedDiscoverer | undefined => {
  const top = [...stats]
    .filter((entry) => entry.discoveryPrsMerged > 0 && !exclude.has(entry.key))
    .sort((a, b) => {
      const solvedDiff = b.discoveryPrsMerged - a.discoveryPrsMerged;
      if (solvedDiff !== 0) return solvedDiff;

      const scoreDiff = b.discoveryScore - a.discoveryScore;
      if (scoreDiff !== 0) return scoreDiff;

      const baselineDiff = b.baselineSolvedIssues - a.baselineSolvedIssues;
      if (baselineDiff !== 0) return baselineDiff;

      return b.lastActivityMs - a.lastActivityMs;
    })[0];

  if (!top) return undefined;

  return toDailyDiscoverer(
    top,
    'Most 24h Discovery Solves',
    formatIssueCount(top.discoveryPrsMerged, 'solve'),
    'merged discovery PRs',
    {
      secondaryMetric: formatWholeNumber(top.discoveryScore),
      secondaryMetricLabel: '24h discovery score',
    },
  );
};

export const pickTopIssueLinkedPrContributor = (
  stats: DailyDiscovererStats[],
  exclude: Set<string> = new Set(),
): DashboardFeaturedDiscoverer | undefined => {
  const top = [...stats]
    .filter((entry) => entry.discoveryPrsMerged > 0 && !exclude.has(entry.key))
    .sort((a, b) => {
      const scoreDiff = b.highestDiscoveryPrScore - a.highestDiscoveryPrScore;
      if (scoreDiff !== 0) return scoreDiff;

      const mergedDiff = b.discoveryPrsMerged - a.discoveryPrsMerged;
      if (mergedDiff !== 0) return mergedDiff;

      return b.lastActivityMs - a.lastActivityMs;
    })[0];

  if (!top) return undefined;

  const hasScore = top.highestDiscoveryPrScore > 0;
  return toDailyDiscoverer(
    top,
    'Highest 24h Discovery PR',
    hasScore
      ? formatWholeNumber(top.highestDiscoveryPrScore)
      : formatIssueCount(top.discoveryPrsMerged, 'PR'),
    hasScore ? 'top discovery PR score' : 'merged discovery PRs',
    {
      secondaryMetric: formatIssueCount(top.discoveryPrsMerged, 'PR'),
      secondaryMetricLabel: 'merged discovery PRs',
    },
  );
};

const pickFastestCloser = (
  stats: DailyDiscovererStats[],
  exclude: Set<string> = new Set(),
): DashboardFeaturedDiscoverer | undefined => {
  const top = [...stats]
    .filter(
      (entry) =>
        entry.fastestCloseMs !== undefined &&
        (entry.linkedIssuesOpened > 0 || entry.discoveryPrsMerged > 0) &&
        !exclude.has(entry.key),
    )
    .sort((a, b) => {
      const closeDiff = (a.fastestCloseMs ?? 0) - (b.fastestCloseMs ?? 0);
      if (closeDiff !== 0) return closeDiff;

      const solvedDiff = b.discoveryPrsMerged - a.discoveryPrsMerged;
      if (solvedDiff !== 0) return solvedDiff;

      return b.lastActivityMs - a.lastActivityMs;
    })[0];

  if (!top || top.fastestCloseMs === undefined) return undefined;

  return toDailyDiscoverer(
    top,
    'Fastest Closer',
    formatDuration(top.fastestCloseMs),
    'linked issue to merge',
    {
      secondaryMetric: formatIssueCount(top.discoveryPrsMerged, 'solve'),
      secondaryMetricLabel: 'merged discovery PRs',
    },
  );
};

const pickDiscoveryMomentum = (
  stats: DailyDiscovererStats[],
  exclude: Set<string> = new Set(),
): DashboardFeaturedDiscoverer | undefined => {
  const top = [...stats]
    .filter((entry) => totalDailyActivity(entry) > 0 && !exclude.has(entry.key))
    .sort((a, b) => {
      const activityDiff = totalDailyActivity(b) - totalDailyActivity(a);
      if (activityDiff !== 0) return activityDiff;

      const baselineDiff = b.baselineIssueScore - a.baselineIssueScore;
      if (baselineDiff !== 0) return baselineDiff;

      return b.lastActivityMs - a.lastActivityMs;
    })[0];

  if (!top) return undefined;

  return toDailyDiscoverer(
    top,
    'Discovery Momentum',
    formatWholeNumber(totalDailyActivity(top)),
    '24h discovery events',
    {
      secondaryMetric: formatWholeNumber(top.baselineIssueScore),
      secondaryMetricLabel: 'baseline score',
      tone: 'neutral',
    },
  );
};

const buildDailyDiscovererRows = (
  snapshot: DailyActivitySnapshot,
): DashboardFeaturedDiscoverer[] => {
  const stats = [...snapshot.discoverers.values()];
  const seen = new Set<string>();
  const rows: DashboardFeaturedDiscoverer[] = [];
  const pickers: Array<
    (
      entries: DailyDiscovererStats[],
      exclude: Set<string>,
    ) => DashboardFeaturedDiscoverer | undefined
  > = [
    pickTopDailyIssueScout,
    pickTopDailySolver,
    pickTopIssueLinkedPrContributor,
    pickFastestCloser,
    pickDiscoveryMomentum,
  ];

  pickers.forEach((pick) => {
    const row = pick(stats, seen);
    if (!row) return;

    seen.add(row.id);
    rows.push(row);
  });

  return rows;
};

const buildBaselineDiscoverers = (
  miners: MinerEvaluation[],
): DashboardFeaturedDiscoverer[] =>
  [...miners]
    .filter(
      (miner) =>
        miner.isIssueEligible &&
        (parseNumber(miner.issueDiscoveryScore) > 0 ||
          parseNumber(miner.totalSolvedIssues) > 0 ||
          parseNumber(miner.totalOpenIssues) > 0 ||
          parseNumber(miner.totalClosedIssues) > 0),
    )
    .sort((a, b) => {
      const scoreDiff =
        parseNumber(b.issueDiscoveryScore) - parseNumber(a.issueDiscoveryScore);
      if (scoreDiff !== 0) return scoreDiff;

      const solvedDiff =
        parseNumber(b.totalValidSolvedIssues ?? b.totalSolvedIssues) -
        parseNumber(a.totalValidSolvedIssues ?? a.totalSolvedIssues);
      if (solvedDiff !== 0) return solvedDiff;

      const credibilityDiff =
        parseNumber(b.issueCredibility) - parseNumber(a.issueCredibility);
      if (credibilityDiff !== 0) return credibilityDiff;

      return a.id - b.id;
    })
    .slice(0, 5)
    .map((miner) => {
      const solvedIssues = parseNumber(
        miner.totalValidSolvedIssues ?? miner.totalSolvedIssues,
      );
      const issueCredibility = parseNumber(miner.issueCredibility);
      const secondaryMetric =
        solvedIssues > 0
          ? formatIssueCount(solvedIssues, 'valid solve')
          : `${Math.round(issueCredibility * 100)}%`;
      const secondaryMetricLabel =
        solvedIssues > 0 ? 'all-time context' : 'issue credibility';

      return {
        id: `baseline-${miner.githubId}`,
        githubId: miner.githubId,
        githubUsername: miner.githubUsername,
        name: miner.githubUsername ?? miner.githubId,
        avatarUsername: miner.githubUsername,
        roleLabel: 'Baseline issue-eligible leader',
        primaryMetric: formatWholeNumber(
          parseNumber(miner.issueDiscoveryScore),
        ),
        primaryMetricLabel: 'baseline discovery score',
        secondaryMetric,
        secondaryMetricLabel,
        repos: [],
        href: getMinerDetailsHref(miner.githubId),
        tone: 'neutral' as const,
        issueCredibility,
      };
    });

const mapDailyDiscoveryKpis = (
  current: DailyActivitySnapshot,
  previous: DailyActivitySnapshot,
): DashboardDiscoveryKpi[] => [
  {
    label: 'Discovery solves',
    value: formatWholeNumber(current.discoveryPrsMerged),
    delta: formatDailyDelta(
      current.discoveryPrsMerged,
      previous.discoveryPrsMerged,
    ),
    tone: getDailyKpiTone(
      current.discoveryPrsMerged,
      previous.discoveryPrsMerged,
    ),
  },
  {
    label: 'Discovery score',
    value: formatWholeNumber(current.discoveryScore),
    delta: formatDailyDelta(current.discoveryScore, previous.discoveryScore),
    tone: getDailyKpiTone(current.discoveryScore, previous.discoveryScore),
  },
  {
    label: 'New linked issues',
    value: formatWholeNumber(current.linkedIssuesOpened),
    delta: formatDailyDelta(
      current.linkedIssuesOpened,
      previous.linkedIssuesOpened,
    ),
    tone: getDailyKpiTone(
      current.linkedIssuesOpened,
      previous.linkedIssuesOpened,
    ),
  },
  {
    label: 'Active discoverers',
    value: formatWholeNumber(current.discoverers.size),
    delta: formatDailyDelta(
      current.discoverers.size,
      previous.discoverers.size,
    ),
    tone: getDailyKpiTone(current.discoverers.size, previous.discoverers.size),
  },
  {
    label: 'Repos touched',
    value: formatWholeNumber(current.repos.size),
    delta: formatDailyDelta(current.repos.size, previous.repos.size),
    tone: getDailyKpiTone(current.repos.size, previous.repos.size),
  },
];

export const buildDailyDiscoveryKpis = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
  now = new Date(),
): DashboardDiscoveryKpi[] => {
  const current = buildDailyActivitySnapshot(
    prs,
    miners,
    getRollingWindowBounds(now),
  );
  const previous = buildDailyActivitySnapshot(
    prs,
    miners,
    getPreviousRollingWindowBounds(now),
  );

  return mapDailyDiscoveryKpis(current, previous);
};

export const buildDailyDiscoveryPulse = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
  now = new Date(),
): DashboardDiscoveryPulse => {
  const currentSnapshot = buildDailyActivitySnapshot(
    prs,
    miners,
    getRollingWindowBounds(now),
  );
  const previousSnapshot = buildDailyActivitySnapshot(
    prs,
    miners,
    getPreviousRollingWindowBounds(now),
  );
  const dailyDiscoverers = buildDailyDiscovererRows(currentSnapshot);
  const isFallback = dailyDiscoverers.length === 0;

  return {
    windowLabel: 'Last 24h',
    kpis: mapDailyDiscoveryKpis(currentSnapshot, previousSnapshot),
    discoverers: isFallback
      ? buildBaselineDiscoverers(miners)
      : dailyDiscoverers,
    isFallback,
  };
};

export const buildFeaturedDiscoverers = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
  now = new Date(),
): DashboardFeaturedDiscoverer[] =>
  buildDailyDiscoveryPulse(prs, miners, now).discoverers;

const pickTopDiscoveryMiner = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
  exclude: Set<string> = new Set(),
): DashboardFeaturedContributor | undefined => {
  const top = [...miners]
    .filter(
      (m) =>
        m.isIssueEligible &&
        parseNumber(m.issueDiscoveryScore) > 0 &&
        !exclude.has(m.githubId),
    )
    .sort((a, b) => {
      const diff =
        parseNumber(b.issueDiscoveryScore) - parseNumber(a.issueDiscoveryScore);
      return diff !== 0 ? diff : a.id - b.id;
    })[0];

  if (!top) return undefined;

  return {
    featuredLabel: 'Top Discovery Miner',
    githubId: top.githubId,
    githubUsername: top.githubUsername,
    name: top.githubUsername ?? top.githubId,
    metrics: [
      {
        value: Math.round(
          parseNumber(top.issueDiscoveryScore),
        ).toLocaleString(),
        unit: 'Score',
      },
      ...optionalCredibilityMetrics(top.issueCredibility),
    ],
    repos: getTopContributorRepos(prs, top.githubId),
    usdPerDay: parseNumber(top.usdPerDay),
    credibility: parseNumber(top.issueCredibility),
    segments: [
      { label: 'Solved', value: parseNumber(top.totalValidSolvedIssues) },
      { label: 'Open', value: parseNumber(top.totalOpenIssues) },
      { label: 'Closed', value: parseNumber(top.totalClosedIssues) },
    ],
  };
};

const pickMostSolvedIssuesMiner = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
  exclude: Set<string> = new Set(),
): DashboardFeaturedContributor | undefined => {
  const top = [...miners]
    .filter(
      (m) =>
        m.isIssueEligible &&
        (m.totalValidSolvedIssues ?? 0) > 0 &&
        !exclude.has(m.githubId),
    )
    .sort((a, b) => {
      const diff =
        (b.totalValidSolvedIssues ?? 0) - (a.totalValidSolvedIssues ?? 0);
      if (diff !== 0) return diff;
      return (
        parseNumber(b.issueDiscoveryScore) - parseNumber(a.issueDiscoveryScore)
      );
    })[0];

  if (!top) return undefined;

  return {
    featuredLabel: 'Most Solved Issues',
    githubId: top.githubId,
    githubUsername: top.githubUsername,
    name: top.githubUsername ?? top.githubId,
    metrics: [
      {
        value: `${top.totalValidSolvedIssues ?? 0}`,
        unit: 'Solved',
      },
      ...optionalCredibilityMetrics(top.issueCredibility),
    ],
    repos: getTopContributorRepos(prs, top.githubId),
    usdPerDay: parseNumber(top.usdPerDay),
    credibility: parseNumber(top.issueCredibility),
    segments: [
      { label: 'Solved', value: parseNumber(top.totalValidSolvedIssues) },
      { label: 'Open', value: parseNumber(top.totalOpenIssues) },
      { label: 'Closed', value: parseNumber(top.totalClosedIssues) },
    ],
  };
};

const pickHighestIssueTokenScoreMiner = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
  exclude: Set<string> = new Set(),
): DashboardFeaturedContributor | undefined => {
  const top = [...miners]
    .filter(
      (m) =>
        m.isIssueEligible &&
        parseNumber(m.issueTokenScore) > 0 &&
        !exclude.has(m.githubId),
    )
    .sort((a, b) => {
      const diff =
        parseNumber(b.issueTokenScore) - parseNumber(a.issueTokenScore);
      return diff !== 0 ? diff : a.id - b.id;
    })[0];

  if (!top) return undefined;

  return {
    featuredLabel: 'Highest-Scoring Issue Author',
    githubId: top.githubId,
    githubUsername: top.githubUsername,
    name: top.githubUsername ?? top.githubId,
    metrics: [
      {
        value: Math.round(parseNumber(top.issueTokenScore)).toLocaleString(),
        unit: 'Score',
      },
      ...optionalCredibilityMetrics(top.issueCredibility),
    ],
    repos: getTopContributorRepos(prs, top.githubId),
    usdPerDay: parseNumber(top.usdPerDay),
    credibility: parseNumber(top.issueCredibility),
    segments: [
      { label: 'Solved', value: parseNumber(top.totalValidSolvedIssues) },
      { label: 'Open', value: parseNumber(top.totalOpenIssues) },
      { label: 'Closed', value: parseNumber(top.totalClosedIssues) },
    ],
  };
};

export const buildFeaturedDiscoveryContributors = (
  prs: CommitLog[],
  miners: MinerEvaluation[],
): DashboardFeaturedContributor[] => {
  const seen = new Set<string>();
  const contributors: DashboardFeaturedContributor[] = [];
  const pickers: Array<() => DashboardFeaturedContributor | undefined> = [
    () => pickTopDiscoveryMiner(prs, miners, seen),
    () => pickMostSolvedIssuesMiner(prs, miners, seen),
    () => pickHighestIssueTokenScoreMiner(prs, miners, seen),
  ];
  for (const pick of pickers) {
    const c = pick();
    if (c) {
      seen.add(c.githubId);
      contributors.push(c);
    }
  }
  return contributors;
};

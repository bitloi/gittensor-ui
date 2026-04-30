import React from 'react';
import {
  Avatar,
  Box,
  ButtonBase,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { alpha, type Theme, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { getGithubAvatarSrc } from '../../../utils';
import {
  type DashboardDiscoveryKpi,
  type DashboardDiscoveryPulse,
  type DashboardFeaturedDiscoverer,
} from '../dashboardData';

interface DashboardFeaturedDiscoverersProps {
  pulse: DashboardDiscoveryPulse;
  isLoading?: boolean;
  isError?: boolean;
  viewAllHref?: string;
}

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const repoLabel = (repo: string) => repo.split('/').pop() || repo;

const getKpiToneColor = (tone: DashboardDiscoveryKpi['tone'], theme: Theme) => {
  if (tone === 'positive') return theme.palette.status.merged;
  if (tone === 'warning') return theme.palette.status.warning;
  return alpha(theme.palette.text.primary, 0.48);
};

const getRowToneColor = (
  tone: DashboardFeaturedDiscoverer['tone'],
  theme: Theme,
) => {
  if (tone === 'warning') return theme.palette.status.warning;
  if (tone === 'neutral') return alpha(theme.palette.text.primary, 0.5);
  return theme.palette.status.merged;
};

const KpiCard: React.FC<{ kpi: DashboardDiscoveryKpi }> = ({ kpi }) => {
  const theme = useTheme();
  const toneColor = getKpiToneColor(kpi.tone, theme);

  return (
    <Box
      sx={{
        minWidth: 0,
        p: { xs: 0.9, sm: 1 },
        minHeight: 58,
        borderRadius: 2,
        border: `1px solid ${theme.palette.border.light}`,
        backgroundColor: theme.palette.background.default,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 0.4,
      }}
    >
      <Typography
        sx={{
          color: alpha(theme.palette.text.primary, 0.48),
          fontSize: '0.66rem',
          fontWeight: 600,
          lineHeight: 1.2,
        }}
      >
        {kpi.label}
      </Typography>
      <Stack direction="row" spacing={0.75} alignItems="baseline" minWidth={0}>
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: { xs: '0.92rem', sm: '1rem' },
            fontWeight: 700,
            lineHeight: 1.1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {kpi.value}
        </Typography>
        {kpi.delta && (
          <Typography
            sx={{
              color: toneColor,
              fontSize: '0.62rem',
              fontWeight: 600,
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {kpi.delta}
          </Typography>
        )}
      </Stack>
    </Box>
  );
};

const LoadingState: React.FC = () => (
  <Stack spacing={1}>
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          md: 'repeat(5, minmax(0, 1fr))',
        },
        gap: 0.75,
      }}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton
          key={`discovery-kpi-skeleton-${index}`}
          variant="rounded"
          height={58}
          sx={{ borderRadius: 2 }}
        />
      ))}
    </Box>
    <Stack spacing={0.65}>
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton
          key={`discovery-row-skeleton-${index}`}
          variant="rounded"
          height={72}
          sx={{ borderRadius: 2 }}
        />
      ))}
    </Stack>
  </Stack>
);

const RepoPills: React.FC<{ repos: string[]; name: string }> = ({
  repos,
  name,
}) => {
  const theme = useTheme();
  const visibleRepos = repos.slice(0, 2);
  const hiddenCount = Math.max(0, repos.length - visibleRepos.length);

  if (repos.length === 0) {
    return (
      <Typography
        sx={{
          color: alpha(theme.palette.text.primary, 0.34),
          fontSize: '0.66rem',
          fontWeight: 600,
        }}
      >
        no repo context
      </Typography>
    );
  }

  return (
    <Stack
      direction="row"
      spacing={0.45}
      useFlexGap
      flexWrap="wrap"
      justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}
    >
      {visibleRepos.map((repo) => (
        <Box
          key={`${name}-${repo}`}
          sx={{
            maxWidth: { xs: 132, sm: 118 },
            px: 0.7,
            py: 0.32,
            borderRadius: 1.5,
            border: `1px solid ${theme.palette.border.light}`,
            color: alpha(theme.palette.text.primary, 0.72),
            fontSize: '0.64rem',
            fontWeight: 600,
            lineHeight: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={repo}
        >
          {repoLabel(repo)}
        </Box>
      ))}
      {hiddenCount > 0 && (
        <Box
          sx={{
            px: 0.7,
            py: 0.32,
            borderRadius: 1.5,
            backgroundColor: theme.palette.background.default,
            color: alpha(theme.palette.text.primary, 0.62),
            fontSize: '0.64rem',
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          +{hiddenCount}
        </Box>
      )}
    </Stack>
  );
};

const CredibilityLine: React.FC<{ value?: number }> = ({ value }) => {
  const theme = useTheme();
  const hasValue = Number.isFinite(value) && (value ?? 0) > 0;
  if (!hasValue) return null;

  const clamped = Math.min(1, Math.max(0, value ?? 0));
  const percent = Math.round(clamped * 100);
  const color =
    clamped >= 0.75
      ? theme.palette.status.merged
      : clamped >= 0.5
        ? theme.palette.status.warning
        : theme.palette.status.closed;

  return (
    <Box sx={{ gridArea: 'credibility', minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={0.65}
        alignItems="center"
        sx={{ minWidth: 0 }}
      >
        <Box
          sx={{
            position: 'relative',
            flex: 1,
            minWidth: 42,
            height: 3,
            borderRadius: 999,
            backgroundColor: alpha(theme.palette.text.primary, 0.12),
            overflow: 'hidden',
          }}
          aria-label={`Issue credibility ${percent}%`}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              width: `${percent}%`,
              borderRadius: 'inherit',
              backgroundColor: color,
            }}
          />
        </Box>
        <Typography
          sx={{
            color: alpha(theme.palette.text.primary, 0.42),
            fontSize: '0.6rem',
            fontWeight: 700,
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          {percent}% cred
        </Typography>
      </Stack>
    </Box>
  );
};

const DiscovererRow: React.FC<{
  discoverer: DashboardFeaturedDiscoverer;
  rank: number;
}> = ({ discoverer, rank }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const toneColor = getRowToneColor(discoverer.tone, theme);
  const avatarUsername =
    discoverer.avatarUsername ??
    discoverer.githubUsername ??
    discoverer.githubId;
  const rowSx = {
    width: '100%',
    minWidth: 0,
    p: { xs: 0.85, sm: 0.9 },
    minHeight: { xs: 86, sm: 70 },
    borderRadius: 2,
    border: `1px solid ${theme.palette.border.light}`,
    backgroundColor: theme.palette.background.default,
    display: 'grid',
    gridTemplateColumns: {
      xs: '30px minmax(0, 1fr)',
      sm: '34px minmax(150px, 1.25fr) minmax(112px, 0.62fr) minmax(118px, 0.7fr) minmax(120px, 0.72fr) 18px',
    },
    gridTemplateAreas: {
      xs: `
        "rank identity"
        "rank primary"
        "rank secondary"
        "rank credibility"
        "rank repos"
      `,
      sm: `
        "rank identity primary secondary repos arrow"
        "rank identity credibility credibility repos arrow"
      `,
    },
    alignItems: 'center',
    columnGap: { xs: 0.75, sm: 1 },
    rowGap: { xs: 0.55, sm: 0 },
    textAlign: 'left',
    transition: 'border-color 0.16s ease, background-color 0.16s ease',
    ...(discoverer.href
      ? {
          cursor: 'pointer',
          '&:hover': {
            borderColor: alpha(toneColor, 0.42),
            backgroundColor: alpha(theme.palette.text.primary, 0.025),
          },
          '&:focus-visible': {
            outline: `2px solid ${alpha(toneColor, 0.58)}`,
            outlineOffset: '2px',
          },
        }
      : {}),
  } as const;

  const content = (
    <>
      <Typography
        sx={{
          gridArea: 'rank',
          color: alpha(theme.palette.text.primary, 0.42),
          fontSize: '0.76rem',
          fontWeight: 700,
          textAlign: 'center',
        }}
      >
        #{rank}
      </Typography>

      <Stack
        direction="row"
        spacing={0.8}
        alignItems="center"
        sx={{ gridArea: 'identity', minWidth: 0 }}
      >
        <Avatar
          src={getGithubAvatarSrc(avatarUsername)}
          alt={discoverer.name}
          sx={{
            width: 34,
            height: 34,
            flexShrink: 0,
            fontSize: '0.76rem',
            fontWeight: 700,
            bgcolor: theme.palette.surface.light,
            color: theme.palette.text.primary,
            border: `1px solid ${theme.palette.border.light}`,
          }}
        >
          {getInitials(discoverer.name)}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.82rem',
              fontWeight: 700,
              lineHeight: 1.25,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {discoverer.name}
          </Typography>
          <Stack direction="row" spacing={0.55} alignItems="center">
            <Box
              component="span"
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: toneColor,
                flexShrink: 0,
              }}
            />
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.58),
                fontSize: '0.65rem',
                fontWeight: 600,
                lineHeight: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {discoverer.roleLabel}
            </Typography>
          </Stack>
        </Box>
      </Stack>

      <Box sx={{ gridArea: 'primary', minWidth: 0 }}>
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '0.86rem',
            fontWeight: 700,
            lineHeight: 1.1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {discoverer.primaryMetric}
        </Typography>
        <Typography
          sx={{
            mt: 0.2,
            color: alpha(theme.palette.text.primary, 0.44),
            fontSize: '0.62rem',
            fontWeight: 600,
            lineHeight: 1.2,
          }}
        >
          {discoverer.primaryMetricLabel}
        </Typography>
      </Box>

      <Box
        sx={{
          gridArea: 'secondary',
          minWidth: 0,
        }}
      >
        {discoverer.secondaryMetric && (
          <>
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.78),
                fontSize: '0.78rem',
                fontWeight: 700,
                lineHeight: 1.1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {discoverer.secondaryMetric}
            </Typography>
            <Typography
              sx={{
                mt: 0.2,
                color: alpha(theme.palette.text.primary, 0.4),
                fontSize: '0.62rem',
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              {discoverer.secondaryMetricLabel}
            </Typography>
          </>
        )}
      </Box>

      <Box sx={{ gridArea: 'repos', minWidth: 0 }}>
        <RepoPills repos={discoverer.repos} name={discoverer.name} />
      </Box>

      <CredibilityLine value={discoverer.issueCredibility} />

      <ArrowForwardIcon
        sx={{
          gridArea: 'arrow',
          display: { xs: 'none', sm: discoverer.href ? 'block' : 'none' },
          color: alpha(theme.palette.text.primary, 0.34),
          fontSize: 16,
        }}
      />
    </>
  );

  if (!discoverer.href) {
    return <Box sx={rowSx}>{content}</Box>;
  }

  return (
    <ButtonBase
      onClick={() =>
        navigate(discoverer.href ?? '', {
          state: { backLabel: 'Back to Dashboard' },
        })
      }
      aria-label={`Open issue discovery profile for ${discoverer.name}`}
      sx={rowSx}
    >
      {content}
    </ButtonBase>
  );
};

const DashboardFeaturedDiscoverers: React.FC<
  DashboardFeaturedDiscoverersProps
> = ({ pulse, isLoading = false, isError = false, viewAllHref }) => {
  const theme = useTheme();
  const navigate = useNavigate();

  return (
    <Box
      component="section"
      aria-labelledby="featured-discoverers-heading"
      sx={{
        width: '100%',
        p: { xs: 1.2, sm: 1.35 },
        borderRadius: 2,
        border: `1px solid ${theme.palette.border.light}`,
        backgroundColor: theme.palette.surface.transparent,
      }}
    >
      <Stack spacing={1.1}>
        <Box
          sx={{
            display: 'flex',
            alignItems: { xs: 'flex-start', sm: 'center' },
            justifyContent: 'space-between',
            gap: 1,
            flexDirection: { xs: 'column', sm: 'row' },
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={0.7} alignItems="center">
              <Typography
                id="featured-discoverers-heading"
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: { xs: '0.98rem', sm: '1.05rem' },
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                Featured Discoverers
              </Typography>
              <Chip
                label={pulse.windowLabel}
                size="small"
                sx={{
                  height: 21,
                  borderRadius: 1.5,
                  color: theme.palette.status.merged,
                  borderColor: alpha(theme.palette.status.merged, 0.28),
                  backgroundColor: alpha(theme.palette.status.merged, 0.08),
                  border: '1px solid',
                  fontSize: '0.62rem',
                  fontWeight: 700,
                }}
              />
            </Stack>
            <Typography
              sx={{
                mt: 0.35,
                color: alpha(theme.palette.text.primary, 0.48),
                fontSize: '0.72rem',
                fontWeight: 500,
                lineHeight: 1.35,
              }}
            >
              Rolling 24h issue-discovery solves and linked issue context.
            </Typography>
          </Box>

          <Stack
            direction="row"
            spacing={0.8}
            alignItems="center"
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.36),
                fontSize: '0.66rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Updated with dashboard data
            </Typography>
            {viewAllHref && (
              <ButtonBase
                onClick={() => navigate(viewAllHref)}
                aria-label="View all issue discoverers"
                sx={{
                  ml: 'auto',
                  px: 0.8,
                  py: 0.45,
                  borderRadius: 1.5,
                  color: alpha(theme.palette.text.primary, 0.56),
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  lineHeight: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.35,
                  transition: 'color 0.15s ease, background-color 0.15s ease',
                  '&:hover': {
                    color: theme.palette.text.primary,
                    backgroundColor: alpha(theme.palette.text.primary, 0.04),
                  },
                  '&:focus-visible': {
                    outline: `2px solid ${alpha(
                      theme.palette.status.merged,
                      0.55,
                    )}`,
                    outlineOffset: '2px',
                  },
                }}
              >
                View all
                <ArrowForwardIcon sx={{ fontSize: 13 }} />
              </ButtonBase>
            )}
          </Stack>
        </Box>

        {isLoading ? (
          <LoadingState />
        ) : (
          <>
            {isError && (
              <Box
                role="status"
                sx={{
                  px: 0.9,
                  py: 0.7,
                  borderRadius: 2,
                  border: `1px solid ${alpha(
                    theme.palette.status.warning,
                    0.22,
                  )}`,
                  backgroundColor: theme.palette.background.default,
                }}
              >
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.primary, 0.66),
                    fontSize: '0.72rem',
                    fontWeight: 600,
                  }}
                >
                  Discovery activity unavailable right now.
                </Typography>
              </Box>
            )}

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(5, minmax(0, 1fr))',
                },
                gap: 0.75,
              }}
            >
              {pulse.kpis.map((kpi) => (
                <KpiCard key={kpi.label} kpi={kpi} />
              ))}
            </Box>

            {pulse.isFallback && (
              <Box
                sx={{
                  px: 0.9,
                  py: 0.7,
                  borderRadius: 2,
                  border: `1px solid ${theme.palette.border.light}`,
                  backgroundColor: theme.palette.background.default,
                  display: 'flex',
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  justifyContent: 'space-between',
                  gap: 0.8,
                  flexDirection: { xs: 'column', sm: 'row' },
                }}
              >
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.primary, 0.58),
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    lineHeight: 1.35,
                  }}
                >
                  No discoverer activity in the last 24h. Showing baseline
                  issue-eligible miners instead.
                </Typography>
                <Chip
                  label="Baseline issue-eligible leaders"
                  size="small"
                  sx={{
                    height: 21,
                    borderRadius: 1.5,
                    backgroundColor: theme.palette.background.default,
                    color: alpha(theme.palette.text.primary, 0.58),
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                />
              </Box>
            )}

            {pulse.discoverers.length > 0 ? (
              <Stack spacing={0.65}>
                {pulse.discoverers.map((discoverer, index) => (
                  <DiscovererRow
                    key={discoverer.id}
                    discoverer={discoverer}
                    rank={index + 1}
                  />
                ))}
              </Stack>
            ) : (
              <Box
                sx={{
                  px: 0.9,
                  py: 0.8,
                  borderRadius: 2,
                  border: `1px solid ${theme.palette.border.light}`,
                  backgroundColor: theme.palette.background.default,
                }}
              >
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.primary, 0.58),
                    fontSize: '0.72rem',
                    fontWeight: 600,
                  }}
                >
                  No discoverer activity in the last 24h.
                </Typography>
              </Box>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
};

export default DashboardFeaturedDiscoverers;

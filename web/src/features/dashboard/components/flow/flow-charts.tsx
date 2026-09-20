/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { VChart } from '@visactor/react-vchart'
import {
  Activity,
  BarChart3,
  CircleAlert,
  Cpu,
  Hash,
  Info,
  Key,
  Loader2,
  Route,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MultiSelect } from '@/components/multi-select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getFlowQuotaDates } from '@/features/dashboard/api'
import {
  buildQueryParams,
  getDefaultDays,
} from '@/features/dashboard/lib'
import {
  compactFlowSelectionLabel,
  flowDisplayState,
  requireSuccessfulFlowRows,
} from '@/features/dashboard/lib/flow-selection'
import type {
  DashboardFilters,
  FlowQuotaDataItem,
} from '@/features/dashboard/types'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import { computeTimeRange } from '@/lib/time'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'
import { useAuthStore } from '@/stores/auth-store'

interface FlowChartsProps {
  filters?: DashboardFilters
  // When false, sensitive node labels are masked.
  sensitiveVisible?: boolean
}

type FlowDimension = 'token' | 'model' | 'channel'
type MetricDisplayMode = 'all' | 'tokens' | 'requests'

const FLOW_TOP_LIMIT_OPTIONS = [10, 20, 50, 100] as const
const DEFAULT_FLOW_TOP_LIMIT = 20

const FLOW_OVERFLOW_MODE_OPTIONS = [
  { value: 'aggregate', labelKey: 'Merge into Other' },
  { value: 'hide', labelKey: 'Hide' },
] as const

function formatFlowMetricNumber(value: number): string {
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

export function FlowCharts(props: FlowChartsProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useChartTheme()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = Boolean(user?.role && user.role >= ROLE.ADMIN)
  const isRoot = Boolean(user?.role && user.role >= ROLE.SUPER_ADMIN)
  const flowRole = isRoot ? 'root' : isAdmin ? 'admin' : 'user'

  const [dimension, setDimension] = useState<FlowDimension>('model')
  const [metricMode, setMetricMode] = useState<MetricDisplayMode>('all')
  const [topLimit, setTopLimit] = useState<number>(DEFAULT_FLOW_TOP_LIMIT)
  const [overflowMode, setOverflowMode] = useState<'aggregate' | 'hide'>('aggregate')
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])

  const timeRange = useMemo(
    () =>
      computeTimeRange(
        getDefaultDays(props.filters?.time_granularity),
        props.filters?.start_timestamp,
        props.filters?.end_timestamp
      ),
    [
      props.filters?.end_timestamp,
      props.filters?.start_timestamp,
      props.filters?.time_granularity,
    ]
  )
  const flowQueryParams = useMemo(
    () => buildQueryParams(timeRange, props.filters),
    [props.filters, timeRange]
  )

  const {
    data: flowRows,
    error: flowError,
    isError,
    isLoading,
  } = useQuery({
    queryKey: ['dashboard', 'flow', flowQueryParams, flowRole],
    queryFn: async () =>
      requireServerSuccess(await getFlowQuotaDates(flowQueryParams, isAdmin)),
    select: (res) =>
      requireSuccessfulFlowRows(res, t('Please try again later.')),
    staleTime: 60_000,
  })

  const maskSensitive = props.sensitiveVisible === false

  // Process data by dimension
  const processedData = useMemo(() => {
    const rawRows = flowRows ?? []
    const selectedUserSet = new Set(selectedUsers)
    const filteredRows =
      selectedUserSet.size > 0
        ? rawRows.filter((row: FlowQuotaDataItem) => {
            const uid = row.user_id ? String(row.user_id) : (row.username || '')
            return selectedUserSet.has(`user:${uid}`) || selectedUserSet.has(uid)
          })
        : rawRows

    let totalTokens = 0
    let totalRequests = 0

    const itemMap = new Map<
      string,
      {
        key: string
        name: string
        tokens: number
        requests: number
      }
    >()

    for (const row of filteredRows) {
      const tokens = Number(row.token_used) || 0
      const requests = Number(row.count) || 0
      totalTokens += tokens
      totalRequests += requests

      let key = ''
      let name = ''

      if (dimension === 'token') {
        const tokenId = row.token_id ?? 0
        key = tokenId > 0 ? `token:${tokenId}` : `token:${row.token_name || 'unknown'}`
        name =
          maskSensitive && row.token_name
            ? '***'
            : row.token_name ||
              (tokenId > 0 ? `token-${tokenId}` : t('Unknown Token'))
      } else if (dimension === 'channel') {
        const channelId = row.channel_id ?? 0
        key =
          channelId > 0
            ? `channel:${channelId}`
            : `channel:${row.channel_name || 'unknown'}`
        name =
          row.channel_name ||
          (channelId > 0 ? `channel-${channelId}` : t('Unknown Channel'))
      } else {
        // model
        key = `model:${row.model_name || 'unknown'}`
        name = row.model_name || t('Unknown Model')
      }

      const existing = itemMap.get(key)
      if (existing) {
        existing.tokens += tokens
        existing.requests += requests
      } else {
        itemMap.set(key, { key, name, tokens, requests })
      }
    }

    const items = Array.from(itemMap.values())

    // Sort by tokens (or requests if metricMode === 'requests') descending
    items.sort((a, b) => {
      if (metricMode === 'requests') {
        return b.requests - a.requests || b.tokens - a.tokens
      }
      return b.tokens - a.tokens || b.requests - a.requests
    })

    const formatShare = (val: number, total: number) => {
      if (total <= 0) return '0.0%'
      return `${((val / total) * 100).toFixed(1)}%`
    }

    const allWithShare = items.map((item) => ({
      ...item,
      tokenShare: totalTokens > 0 ? (item.tokens / totalTokens) * 100 : 0,
      tokenShareStr: formatShare(item.tokens, totalTokens),
      requestShare: totalRequests > 0 ? (item.requests / totalRequests) * 100 : 0,
      requestShareStr: formatShare(item.requests, totalRequests),
    }))

    let displayItems: typeof allWithShare = []
    if (allWithShare.length <= topLimit) {
      displayItems = allWithShare
    } else {
      const topSlice = allWithShare.slice(0, topLimit)
      if (overflowMode === 'aggregate') {
        const otherSlice = allWithShare.slice(topLimit)
        let otherTokens = 0
        let otherRequests = 0
        for (const item of otherSlice) {
          otherTokens += item.tokens
          otherRequests += item.requests
        }
        const otherItem = {
          key: 'other',
          name: t('Other'),
          tokens: otherTokens,
          requests: otherRequests,
          tokenShare: totalTokens > 0 ? (otherTokens / totalTokens) * 100 : 0,
          tokenShareStr: formatShare(otherTokens, totalTokens),
          requestShare: totalRequests > 0 ? (otherRequests / totalRequests) * 100 : 0,
          requestShareStr: formatShare(otherRequests, totalRequests),
        }
        displayItems = [...topSlice, otherItem]
      } else {
        displayItems = topSlice
      }
    }

    return {
      displayItems,
      totalTokens,
      totalRequests,
      totalItemsCount: items.length,
    }
  }, [
    flowRows,
    selectedUsers,
    dimension,
    maskSensitive,
    t,
    metricMode,
    topLimit,
    overflowMode,
  ])

  // User filter options for admins
  const userFilterOptions = useMemo(() => {
    const rows = flowRows ?? []
    const users = new Map<string, { id: string; name: string }>()
    for (const r of rows) {
      const uid = r.user_id ? String(r.user_id) : (r.username || '')
      if (uid && !users.has(uid)) {
        users.set(uid, {
          id: uid,
          name: r.username || `User ${uid}`,
        })
      }
    }
    return Array.from(users.values()).map((u) => ({
      value: `user:${u.id}`,
      label: u.name,
    }))
  }, [flowRows])

  // Build VChart Spec for Bar Chart
  const barChartSpec = useMemo(() => {
    const isDark = resolvedTheme === 'dark'
    const textColor = isDark ? '#9ca3af' : '#6b7280'
    const gridColor = isDark ? '#374151' : '#f3f4f6'
    const tokensLabel = t('Tokens')
    const requestsLabel = t('Requests')
    const shareLabel = t('Share')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seriesList: any[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axesList: any[] = [
      {
        orient: 'bottom',
        type: 'band',
        paddingInner: 0.25,
        paddingOuter: 0.2,
        label: {
          autoRotate: true,
          autoHide: false,
          style: {
            fontSize: 11,
            fill: textColor,
          },
        },
      },
    ]

    if (metricMode === 'all') {
      // Dual-axis grouped bar chart combining Tokens and Requests
      seriesList.push(
        {
          type: 'bar',
          id: 'tokensBar',
          name: tokensLabel,
          dataIndex: 0,
          xField: 'name',
          yField: 'tokens',
          bar: {
            style: {
              fill: isDark ? '#60a5fa' : '#3b82f6',
              cornerRadius: [3, 3, 0, 0],
            },
            state: {
              hover: { stroke: '#1d4ed8', lineWidth: 1 },
            },
          },
        },
        {
          type: 'bar',
          id: 'requestsBar',
          name: requestsLabel,
          dataIndex: 0,
          xField: 'name',
          yField: 'requests',
          bar: {
            style: {
              fill: isDark ? '#34d399' : '#10b981',
              cornerRadius: [3, 3, 0, 0],
            },
            state: {
              hover: { stroke: '#047857', lineWidth: 1 },
            },
          },
        }
      )

      axesList.push(
        {
          orient: 'left',
          type: 'linear',
          seriesIndex: [0],
          title: {
            visible: true,
            text: tokensLabel,
            style: { fill: textColor, fontSize: 11 },
          },
          label: {
            formatMethod: (val: number) => formatFlowMetricNumber(val),
            style: { fill: textColor },
          },
          grid: {
            visible: true,
            style: { stroke: gridColor, lineDash: [3, 3] },
          },
        },
        {
          orient: 'right',
          type: 'linear',
          seriesIndex: [1],
          title: {
            visible: true,
            text: requestsLabel,
            style: { fill: textColor, fontSize: 11 },
          },
          label: {
            formatMethod: (val: number) => formatFlowMetricNumber(val),
            style: { fill: textColor },
          },
          grid: { visible: false },
        }
      )
    } else if (metricMode === 'tokens') {
      seriesList.push({
        type: 'bar',
        id: 'tokensBar',
        name: tokensLabel,
        dataIndex: 0,
        xField: 'name',
        yField: 'tokens',
        bar: {
          style: {
            fill: isDark ? '#60a5fa' : '#3b82f6',
            cornerRadius: [3, 3, 0, 0],
          },
          state: {
            hover: { stroke: '#1d4ed8', lineWidth: 1 },
          },
        },
      })
      axesList.push({
        orient: 'left',
        type: 'linear',
        seriesIndex: [0],
        title: {
          visible: true,
          text: tokensLabel,
          style: { fill: textColor, fontSize: 11 },
        },
        label: {
          formatMethod: (val: number) => formatFlowMetricNumber(val),
          style: { fill: textColor },
        },
        grid: {
          visible: true,
          style: { stroke: gridColor, lineDash: [3, 3] },
        },
      })
    } else {
      seriesList.push({
        type: 'bar',
        id: 'requestsBar',
        name: requestsLabel,
        dataIndex: 0,
        xField: 'name',
        yField: 'requests',
        bar: {
          style: {
            fill: isDark ? '#34d399' : '#10b981',
            cornerRadius: [3, 3, 0, 0],
          },
          state: {
            hover: { stroke: '#047857', lineWidth: 1 },
          },
        },
      })
      axesList.push({
        orient: 'left',
        type: 'linear',
        seriesIndex: [0],
        title: {
          visible: true,
          text: requestsLabel,
          style: { fill: textColor, fontSize: 11 },
        },
        label: {
          formatMethod: (val: number) => formatFlowMetricNumber(val),
          style: { fill: textColor },
        },
        grid: {
          visible: true,
          style: { stroke: gridColor, lineDash: [3, 3] },
        },
      })
    }

    return {
      type: 'common',
      data: [
        {
          id: 'flowBarData',
          values: processedData.displayItems,
        },
      ],
      series: seriesList,
      axes: axesList,
      legends: {
        visible: metricMode === 'all',
        position: 'top',
        orient: 'top',
        padding: { bottom: 8 },
      },
      tooltip: {
        visible: true,
        mark: {
          content: [
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              key: tokensLabel,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              value: (datum: any) =>
                `${formatFlowMetricNumber(Number(datum?.tokens) || 0)} (${shareLabel}: ${datum?.tokenShareStr ?? '0.0%'})`,
            },
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              key: requestsLabel,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              value: (datum: any) =>
                `${formatFlowMetricNumber(Number(datum?.requests) || 0)} (${shareLabel}: ${datum?.requestShareStr ?? '0.0%'})`,
            },
          ],
        },
        dimension: {
          title: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value: (datum: any) => datum?.name,
          },
          content: [
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              key: tokensLabel,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              value: (datum: any) =>
                `${formatFlowMetricNumber(Number(datum?.tokens) || 0)} (${shareLabel}: ${datum?.tokenShareStr ?? '0.0%'})`,
            },
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              key: requestsLabel,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              value: (datum: any) =>
                `${formatFlowMetricNumber(Number(datum?.requests) || 0)} (${shareLabel}: ${datum?.requestShareStr ?? '0.0%'})`,
            },
          ],
        },
      },
      background: 'transparent',
      animation: true,
    }
  }, [metricMode, processedData.displayItems, resolvedTheme, t])

  const displayState = flowDisplayState({
    isLoading,
    isError,
    rows: flowRows,
  })

  const flowErrorMessage =
    flowError instanceof Error
      ? flowError.message
      : t('Failed to load flow data')

  let chartContent = null
  if (displayState === 'loading') {
    chartContent = <Skeleton className='h-full w-full' />
  } else if (displayState === 'error') {
    chartContent = (
      <div className='flex h-full items-center justify-center p-4'>
        <Alert variant='destructive' className='max-w-md'>
          <CircleAlert />
          <AlertTitle>{t('Failed to load')}</AlertTitle>
          <AlertDescription>{flowErrorMessage}</AlertDescription>
        </Alert>
      </div>
    )
  } else if (displayState === 'empty' || processedData.displayItems.length === 0) {
    chartContent = (
      <Empty className='h-full border-0 py-12'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Route />
          </EmptyMedia>
          <EmptyTitle>{t('No flow data available')}</EmptyTitle>
          <EmptyDescription>{t('No data available')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    const chartKey = `${dimension}-${metricMode}-${topLimit}-${overflowMode}-${selectedUsers.join(',')}-${props.sensitiveVisible ? 'vis' : 'hid'}-${resolvedTheme}-${props.filters?.start_timestamp}-${props.filters?.end_timestamp}`
    chartContent = (
      <VChart
        key={chartKey}
        spec={barChartSpec}
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        options={VCHART_OPTION}
      />
    )
  }

  const dimensionIconMap = {
    token: Key,
    model: Cpu,
    channel: Route,
  }
  const DimensionIcon = dimensionIconMap[dimension]

  return (
    <div className='flex flex-col gap-3'>
      {/* Top Filter Controls */}
      <div className='flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between'>
        <div className='flex min-w-0 flex-wrap items-end gap-2'>
          {/* Dimension Selector (Token / Model / Channel) */}
          <div className='flex min-w-0 flex-col gap-1.5'>
            <div className='flex items-center gap-1.5'>
              <span className='text-muted-foreground text-xs font-medium'>
                {t('Dimension')}
              </span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type='button'
                        className='text-muted-foreground/60 hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded-md'
                        aria-label={t('Switch dimension')}
                      />
                    }
                  >
                    <Info className='size-3.5' />
                  </TooltipTrigger>
                  <TooltipContent className='max-w-[14rem]'>
                    {t('Switch between Token, Model, and Channel analytics.')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Tabs
              value={dimension}
              onValueChange={(value) => setDimension(value as FlowDimension)}
              className='shrink-0'
            >
              <TabsList aria-label={t('Dimension')}>
                <TabsTrigger value='token' className='gap-1.5 px-2.5 text-xs'>
                  <Key data-icon='inline-start' aria-hidden='true' />
                  {t('Token')}
                </TabsTrigger>
                <TabsTrigger value='model' className='gap-1.5 px-2.5 text-xs'>
                  <Cpu data-icon='inline-start' aria-hidden='true' />
                  {t('Model')}
                </TabsTrigger>
                {isAdmin && (
                  <TabsTrigger value='channel' className='gap-1.5 px-2.5 text-xs'>
                    <Route data-icon='inline-start' aria-hidden='true' />
                    {t('Channel')}
                  </TabsTrigger>
                )}
              </TabsList>
            </Tabs>
          </div>

          {/* Metric Display Mode (All / Tokens / Requests) */}
          <div className='flex min-w-0 flex-col gap-1.5'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Metric')}
            </span>
            <Tabs
              value={metricMode}
              onValueChange={(value) => setMetricMode(value as MetricDisplayMode)}
              className='shrink-0'
            >
              <TabsList aria-label={t('Metric')}>
                <TabsTrigger value='all' className='gap-1 px-2.5 text-xs'>
                  <BarChart3 data-icon='inline-start' aria-hidden='true' />
                  {t('Tokens & Requests')}
                </TabsTrigger>
                <TabsTrigger value='tokens' className='gap-1 px-2.5 text-xs'>
                  <Hash data-icon='inline-start' aria-hidden='true' />
                  {t('Tokens')}
                </TabsTrigger>
                <TabsTrigger value='requests' className='gap-1 px-2.5 text-xs'>
                  <Activity data-icon='inline-start' aria-hidden='true' />
                  {t('Requests')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Top Limit */}
          <div className='flex min-w-0 flex-col gap-1.5'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Display limit')}
            </span>
            <Tabs
              value={String(topLimit)}
              onValueChange={(value) => setTopLimit(Number(value))}
              className='shrink-0'
            >
              <TabsList aria-label={t('Display limit')}>
                {FLOW_TOP_LIMIT_OPTIONS.map((limit) => (
                  <TabsTrigger
                    key={limit}
                    value={String(limit)}
                    className='px-2.5 text-xs'
                  >
                    {t('Top {{count}}', { count: limit })}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {/* Overflow Mode */}
          <div className='flex min-w-0 flex-col gap-1.5'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Overflow items')}
            </span>
            <Tabs
              value={overflowMode}
              onValueChange={(value) =>
                setOverflowMode(value as 'aggregate' | 'hide')
              }
              className='shrink-0'
            >
              <TabsList aria-label={t('Overflow items')}>
                {FLOW_OVERFLOW_MODE_OPTIONS.map((option) => (
                  <TabsTrigger
                    key={option.value}
                    value={option.value}
                    className='px-2.5 text-xs'
                  >
                    {t(option.labelKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* User filter for admin */}
        <div className='flex min-w-0 items-center gap-2 xl:justify-end'>
          {isAdmin && userFilterOptions.length > 0 && (
            <div className='flex min-w-0 flex-col gap-2 sm:flex-row xl:w-[min(20rem,30vw)]'>
              <MultiSelect
                options={userFilterOptions}
                selected={selectedUsers}
                onChange={setSelectedUsers}
                placeholder={t('All users')}
                emptyText={t('No users')}
                maxVisibleChips={2}
                renderSelectedSummary={(values) =>
                  compactFlowSelectionLabel(values.length)
                }
              />
            </div>
          )}
          {isLoading && (
            <Loader2 className='text-muted-foreground size-4 animate-spin' />
          )}
        </div>
      </div>

      {/* Main Bar Chart Card */}
      <div className='overflow-hidden rounded-lg border'>
        <div className='flex w-full flex-col gap-2 border-b px-3 py-2 sm:px-5 sm:py-3 lg:flex-row lg:items-center lg:justify-between'>
          <div className='flex min-w-0 items-center gap-2'>
            <IconBadge tone='info' size='sm'>
              <DimensionIcon />
            </IconBadge>
            <div className='text-sm font-semibold'>
              {dimension === 'token'
                ? t('Token Analytics')
                : dimension === 'channel'
                  ? t('Channel Analytics')
                  : t('Model Analytics')}
            </div>
          </div>

          {/* Summary stats */}
          <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'>
            <div>
              {t('Tokens')}:{' '}
              <span className='font-semibold text-foreground'>
                {formatFlowMetricNumber(processedData.totalTokens)}
              </span>
            </div>
            <div>
              {t('Requests')}:{' '}
              <span className='font-semibold text-foreground'>
                {formatFlowMetricNumber(processedData.totalRequests)}
              </span>
            </div>
            <div>
              {t('Total:')}{' '}
              <span className='font-semibold text-foreground'>
                {processedData.totalItemsCount}
              </span>
            </div>
          </div>
        </div>

        {/* Chart View */}
        <div className='h-[480px] p-1.5 sm:h-[560px] sm:p-2 2xl:h-[640px]'>
          {chartContent}
        </div>
      </div>
    </div>
  )
}

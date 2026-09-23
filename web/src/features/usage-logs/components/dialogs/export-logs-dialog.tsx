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
import { getRouteApi } from '@tanstack/react-router'
import type { Table } from '@tanstack/react-table'
import dayjs from 'dayjs'
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'

import type { UsageLog } from '../../data/schema'
import {
  buildCommonLogsExportData,
  generateCsvBlob,
  generateXlsxBlob,
  triggerFileDownload,
} from '../../lib/export-excel'
import { fetchLogsByCategory } from '../../lib/utils'
import { useLogsViewScope, useUsageLogsContext } from '../usage-logs-provider'

const route = getRouteApi('/_authenticated/usage-logs/$section')

interface ExportLogsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  table: Table<Record<string, unknown>>
}

export function ExportLogsDialog({
  open,
  onOpenChange,
  table,
}: ExportLogsDialogProps) {
  const { t } = useTranslation()
  const { isAdminView: isAdmin } = useLogsViewScope()
  const { sensitiveVisible } = useUsageLogsContext()
  const searchParams = route.useSearch()

  const [exportScope, setExportScope] = useState<'current' | 'all'>('current')
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx')
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(
    null
  )

  const currentPageRows = table.getRowModel().rows
  const currentPageCount = currentPageRows.length
  const totalFilteredCount = table.getRowCount()

  const handleExport = async () => {
    try {
      setIsExporting(true)
      let exportItems: UsageLog[] = []

      if (exportScope === 'current') {
        exportItems = currentPageRows.map((r) => r.original as UsageLog)
        if (exportItems.length === 0) {
          toast.warning(t('No logs available to export'))
          setIsExporting(false)
          return
        }
      } else {
        // Fetch all filtered logs in batches of 100
        let page = 1
        let hasMore = true
        let total = totalFilteredCount || 0

        while (hasMore) {
          const res = await fetchLogsByCategory({
            logCategory: 'common',
            isAdmin,
            page,
            pageSize: 100,
            searchParams,
            columnFilters: table.getState().columnFilters,
          })

          if (!res.success) {
            throw new Error(res.message || t('Failed to load logs'))
          }

          const items = (res.data?.items || []) as UsageLog[]
          if (items.length === 0) break

          exportItems = exportItems.concat(items)
          total = res.data?.total ?? total
          setProgress({ current: exportItems.length, total })

          if (exportItems.length >= total || items.length < 100) {
            hasMore = false
          } else {
            page += 1
          }
        }

        if (exportItems.length === 0) {
          toast.warning(t('No logs available to export'))
          setIsExporting(false)
          return
        }
      }

      // Generate export file
      const { headers, rows, colWidths } = buildCommonLogsExportData(
        exportItems,
        {
          isAdmin,
          sensitiveVisible,
          t,
        }
      )

      const timestamp = dayjs().format('YYYYMMDD-HHmmss')
      const baseFilename = `usage-logs-${timestamp}`

      if (exportFormat === 'xlsx') {
        const blob = generateXlsxBlob(
          t('Common Logs'),
          headers,
          rows,
          colWidths
        )
        triggerFileDownload(blob, `${baseFilename}.xlsx`)
      } else {
        const blob = generateCsvBlob(headers, rows)
        triggerFileDownload(blob, `${baseFilename}.csv`)
      }

      toast.success(
        t('Successfully exported {{count}} logs', { count: exportItems.length })
      )
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('Failed to export logs')
      toast.error(msg)
    } finally {
      setIsExporting(false)
      setProgress(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !isExporting && onOpenChange(val)}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('Export Common Logs')}</DialogTitle>
          <DialogDescription>
            {t('Export filtered usage logs to Excel or CSV file.')}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-2 text-sm'>
          {/* Export Scope */}
          <div className='space-y-2'>
            <Label className='text-xs font-semibold text-muted-foreground'>
              {t('Export Scope')}
            </Label>
            <RadioGroup
              value={exportScope}
              onValueChange={(val) => setExportScope(val as 'current' | 'all')}
              disabled={isExporting}
              className='grid grid-cols-2 gap-2'
            >
              <div
                onClick={() => !isExporting && setExportScope('current')}
                className={cn(
                  'flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors',
                  exportScope === 'current'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'hover:bg-muted/50'
                )}
              >
                <div className='flex items-center gap-2'>
                  <RadioGroupItem value='current' id='scope-current' />
                  <Label htmlFor='scope-current' className='cursor-pointer text-xs font-medium'>
                    {t('Current Page')}
                  </Label>
                </div>
                <span className='font-mono text-xs text-muted-foreground'>
                  {currentPageCount}
                </span>
              </div>

              <div
                onClick={() => !isExporting && setExportScope('all')}
                className={cn(
                  'flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors',
                  exportScope === 'all'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'hover:bg-muted/50'
                )}
              >
                <div className='flex items-center gap-2'>
                  <RadioGroupItem value='all' id='scope-all' />
                  <Label htmlFor='scope-all' className='cursor-pointer text-xs font-medium'>
                    {t('All Filtered Results')}
                  </Label>
                </div>
                <span className='font-mono text-xs text-muted-foreground'>
                  {totalFilteredCount}
                </span>
              </div>
            </RadioGroup>
          </div>

          {/* Export Format */}
          <div className='space-y-2'>
            <Label className='text-xs font-semibold text-muted-foreground'>
              {t('Export Format')}
            </Label>
            <RadioGroup
              value={exportFormat}
              onValueChange={(val) => setExportFormat(val as 'xlsx' | 'csv')}
              disabled={isExporting}
              className='grid grid-cols-2 gap-2'
            >
              <div
                onClick={() => !isExporting && setExportFormat('xlsx')}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 transition-colors',
                  exportFormat === 'xlsx'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'hover:bg-muted/50'
                )}
              >
                <RadioGroupItem value='xlsx' id='format-xlsx' />
                <FileSpreadsheet className='size-4 text-emerald-600 dark:text-emerald-400' />
                <div className='flex flex-col'>
                  <Label htmlFor='format-xlsx' className='cursor-pointer text-xs font-medium'>
                    Excel (.xlsx)
                  </Label>
                  <span className='text-[10px] text-muted-foreground'>
                    {t('Recommended')}
                  </span>
                </div>
              </div>

              <div
                onClick={() => !isExporting && setExportFormat('csv')}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 transition-colors',
                  exportFormat === 'csv'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'hover:bg-muted/50'
                )}
              >
                <RadioGroupItem value='csv' id='format-csv' />
                <FileText className='size-4 text-blue-600 dark:text-blue-400' />
                <div className='flex flex-col'>
                  <Label htmlFor='format-csv' className='cursor-pointer text-xs font-medium'>
                    CSV (.csv)
                  </Label>
                  <span className='text-[10px] text-muted-foreground'>
                    UTF-8 BOM
                  </span>
                </div>
              </div>
            </RadioGroup>
          </div>

          {/* Progress Indicator */}
          {isExporting && progress && (
            <div className='space-y-2 rounded-lg bg-muted/50 p-3'>
              <div className='flex items-center justify-between text-xs'>
                <span className='text-muted-foreground flex items-center gap-1.5'>
                  <Loader2 className='size-3.5 animate-spin text-primary' />
                  {t('Fetching logs... ({{current}} / {{total}})', {
                    current: progress.current,
                    total: progress.total,
                  })}
                </span>
                <span className='font-mono font-medium'>
                  {Math.min(100, Math.round((progress.current / (progress.total || 1)) * 100))}%
                </span>
              </div>
              <div className='h-1.5 w-full overflow-hidden rounded-full bg-muted'>
                <div
                  className='h-full bg-primary transition-all duration-300'
                  style={{
                    width: `${Math.min(100, Math.round((progress.current / (progress.total || 1)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className='gap-2 sm:gap-0'>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isExporting}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            onClick={handleExport}
            disabled={isExporting}
            className='gap-1.5'
          >
            {isExporting ? (
              <>
                <Loader2 className='size-4 animate-spin' />
                {t('Exporting...')}
              </>
            ) : (
              <>
                <FileSpreadsheet className='size-4' />
                {t('Export')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

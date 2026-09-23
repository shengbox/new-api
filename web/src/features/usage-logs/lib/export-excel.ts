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
import type { TFunction } from 'i18next'

import { formatLogQuota, formatTimestampToDate } from '@/lib/format'

import type { UsageLog } from '../data/schema'
import { getLogTypeConfig } from './utils'

// ============================================================================
// Zero-Dependency ZIP & OpenXML (.xlsx) Builder
// ============================================================================

function crc32(bytes: Uint8Array): number {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c
  }
  let crc = -1
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

interface ZipFileEntry {
  name: string
  data: Uint8Array | string
}

function createZipBuffer(files: ZipFileEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const entries = files.map((f) => {
    const nameBytes = encoder.encode(f.name)
    const dataBytes =
      typeof f.data === 'string' ? encoder.encode(f.data) : f.data
    const crc = crc32(dataBytes)
    return {
      name: f.name,
      nameBytes,
      dataBytes,
      crc,
      size: dataBytes.length,
    }
  })

  let totalSize = 0
  for (const e of entries) {
    totalSize += 30 + e.nameBytes.length + e.size // local header + name + data
    totalSize += 46 + e.nameBytes.length // central directory header + name
  }
  totalSize += 22 // End of Central Directory record

  const buffer = new Uint8Array(totalSize)
  const view = new DataView(buffer.buffer)
  let offset = 0
  const cdOffsets: number[] = []

  // Write local headers and data
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    cdOffsets[i] = offset

    view.setUint32(offset, 0x04034b50, true) // signature
    view.setUint16(offset + 4, 20, true) // version needed: 2.0
    view.setUint16(offset + 6, 0x0800, true) // general purpose flag: UTF-8
    view.setUint16(offset + 8, 0, true) // compression: 0 (store)
    view.setUint16(offset + 10, 0, true) // mod time
    view.setUint16(offset + 12, 0, true) // mod date
    view.setUint32(offset + 14, e.crc, true) // crc-32
    view.setUint32(offset + 18, e.size, true) // compressed size
    view.setUint32(offset + 22, e.size, true) // uncompressed size
    view.setUint16(offset + 26, e.nameBytes.length, true) // file name length
    view.setUint16(offset + 28, 0, true) // extra field length
    offset += 30

    buffer.set(e.nameBytes, offset)
    offset += e.nameBytes.length

    buffer.set(e.dataBytes, offset)
    offset += e.size
  }

  // Write Central Directory headers
  const cdStart = offset
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    view.setUint32(offset, 0x02014b50, true) // signature
    view.setUint16(offset + 4, 20, true) // version made by
    view.setUint16(offset + 6, 20, true) // version needed to extract
    view.setUint16(offset + 8, 0x0800, true) // general purpose flag: UTF-8
    view.setUint16(offset + 10, 0, true) // compression: 0
    view.setUint16(offset + 12, 0, true) // mod time
    view.setUint16(offset + 14, 0, true) // mod date
    view.setUint32(offset + 16, e.crc, true) // crc-32
    view.setUint32(offset + 20, e.size, true) // compressed size
    view.setUint32(offset + 24, e.size, true) // uncompressed size
    view.setUint16(offset + 28, e.nameBytes.length, true) // file name length
    view.setUint16(offset + 30, 0, true) // extra field length
    view.setUint16(offset + 32, 0, true) // comment length
    view.setUint16(offset + 34, 0, true) // disk number start
    view.setUint16(offset + 36, 0, true) // internal file attributes
    view.setUint32(offset + 38, 0, true) // external file attributes
    view.setUint32(offset + 42, cdOffsets[i], true) // relative offset of local header
    offset += 46

    buffer.set(e.nameBytes, offset)
    offset += e.nameBytes.length
  }

  const cdSize = offset - cdStart

  // Write End of Central Directory Record
  view.setUint32(offset, 0x06054b50, true) // signature
  view.setUint16(offset + 4, 0, true) // number of this disk
  view.setUint16(offset + 6, 0, true) // disk where CD starts
  view.setUint16(offset + 8, entries.length, true) // number of CD records on disk
  view.setUint16(offset + 10, entries.length, true) // total number of CD records
  view.setUint32(offset + 12, cdSize, true) // size of central directory
  view.setUint32(offset + 16, cdStart, true) // offset of central directory
  view.setUint16(offset + 20, 0, true) // comment length

  return buffer
}

function xmlEscape(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function getColumnLetter(colIdx: number): string {
  let col = ''
  let n = colIdx
  while (n >= 0) {
    col = String.fromCharCode((n % 26) + 65) + col
    n = Math.floor(n / 26) - 1
  }
  return col
}

/**
 * Generate standard OpenXML (.xlsx) Blob without any external dependencies.
 */
export function generateXlsxBlob(
  sheetName: string,
  headers: string[],
  rows: (string | number)[][],
  colWidths: number[] = []
): Blob {
  let sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  sheetXml +=
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n'

  if (colWidths.length > 0) {
    sheetXml += '  <cols>\n'
    colWidths.forEach((w, idx) => {
      sheetXml += `    <col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>\n`
    })
    sheetXml += '  </cols>\n'
  }

  sheetXml += '  <sheetData>\n'
  // Header row (row 1, style 1 for bold font)
  sheetXml += '    <row r="1">\n'
  headers.forEach((h, colIdx) => {
    const colRef = `${getColumnLetter(colIdx)}1`
    sheetXml += `      <c r="${colRef}" t="inlineStr" s="1"><is><t>${xmlEscape(h)}</t></is></c>\n`
  })
  sheetXml += '    </row>\n'

  // Data rows
  rows.forEach((row, rowIdx) => {
    const rNum = rowIdx + 2
    sheetXml += `    <row r="${rNum}">\n`
    row.forEach((val, colIdx) => {
      const colRef = `${getColumnLetter(colIdx)}${rNum}`
      if (typeof val === 'number') {
        sheetXml += `      <c r="${colRef}"><v>${val}</v></c>\n`
      } else {
        sheetXml += `      <c r="${colRef}" t="inlineStr"><is><t>${xmlEscape(val)}</t></is></c>\n`
      }
    })
    sheetXml += '    </row>\n'
  })

  sheetXml += '  </sheetData>\n</worksheet>'

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><name val="Arial"/><sz val="11"/></font>
    <font><b/><name val="Arial"/><sz val="11"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`

  const files: ZipFileEntry[] = [
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/styles.xml', data: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
  ]

  const zipBytes = createZipBuffer(files)
  return new Blob([zipBytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * Generate standard CSV Blob with UTF-8 BOM so Excel opens with correct encoding.
 */
export function generateCsvBlob(
  headers: string[],
  rows: (string | number)[][]
): Blob {
  const escapeCell = (val: string | number): string => {
    const s = String(val ?? '')
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const headerLine = headers.map(escapeCell).join(',')
  const dataLines = rows.map((row) => row.map(escapeCell).join(','))
  const csvContent = `\uFEFF${[headerLine, ...dataLines].join('\r\n')}\r\n`

  return new Blob([csvContent], {
    type: 'text/csv;charset=utf-8;',
  })
}

/**
 * Trigger file download in browser.
 */
export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Build structured headers and row data for Common Logs.
 */
export function buildCommonLogsExportData(
  logs: UsageLog[],
  options: {
    isAdmin: boolean
    sensitiveVisible: boolean
    t: TFunction
  }
): {
  headers: string[]
  rows: (string | number)[][]
  colWidths: number[]
} {
  const { isAdmin, sensitiveVisible, t } = options

  const headers: string[] = [
    t('Time'),
    ...(isAdmin ? [t('Username'), t('User ID')] : []),
    t('Token Name'),
    t('Type'),
    t('Model'),
    t('Prompt Tokens'),
    t('Completion Tokens'),
    t('Total Tokens'),
    t('Cost'),
    t('Raw Quota'),
    t('Duration (s)'),
    t('Group'),
    ...(isAdmin ? [t('Channel'), t('IP')] : []),
    t('Request ID'),
    t('Upstream Request ID'),
    t('Details'),
  ]

  const colWidths: number[] = [
    20, // Time
    ...(isAdmin ? [14, 10] : []), // Username, User ID
    16, // Token Name
    10, // Type
    22, // Model
    14, // Prompt Tokens
    14, // Completion Tokens
    14, // Total Tokens
    14, // Cost
    12, // Raw Quota
    12, // Duration (s)
    12, // Group
    ...(isAdmin ? [16, 16] : []), // Channel, IP
    26, // Request ID
    26, // Upstream Request ID
    20, // Details
  ]

  const rows: (string | number)[][] = logs.map((log) => {
    const typeConfig = getLogTypeConfig(log.type)
    const typeLabel = t(typeConfig.label)
    const promptTokens = log.prompt_tokens || 0
    const completionTokens = log.completion_tokens || 0
    const totalTokens = promptTokens + completionTokens
    const durationSec =
      log.use_time > 0 ? Number((log.use_time / 1000).toFixed(2)) : 0
    const costStr = formatLogQuota(log.quota)

    const tokenName = !sensitiveVisible ? '••••' : log.token_name || '-'
    const username = !sensitiveVisible ? '••••' : log.username || '-'
    const group = !sensitiveVisible ? '••••' : log.group || '-'
    const channel = log.channel_name
      ? `${log.channel_name} (${log.channel})`
      : log.channel
        ? String(log.channel)
        : '-'

    return [
      formatTimestampToDate(log.created_at),
      ...(isAdmin ? [username, log.user_id] : []),
      tokenName,
      typeLabel,
      log.model_name || '-',
      promptTokens,
      completionTokens,
      totalTokens,
      costStr,
      log.quota || 0,
      durationSec,
      group,
      ...(isAdmin ? [channel, log.ip || '-'] : []),
      log.request_id || '-',
      log.upstream_request_id || '-',
      log.content || '',
    ]
  })

  return { headers, rows, colWidths }
}

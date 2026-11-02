import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Folder,
  FolderLock,
  Lock,
  Presentation,
  type LucideIcon,
} from 'lucide-react'
import { extOf } from '@/lib/mime'
import { cn } from '@/lib/utils'
import type { DriveItem } from '@/drive/model'

const SHEET = new Set(['xls', 'xlsx', 'csv', 'ods', 'numbers'])
const SLIDES = new Set(['ppt', 'pptx', 'odp', 'key'])
const WORD = new Set(['doc', 'docx', 'odt', 'rtf', 'pages'])
const CODE = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'kt', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'json', 'xml', 'html', 'css', 'yml', 'yaml', 'sql'])

function pick(item: DriveItem): [LucideIcon, string] {
  if (item.type === 'folder') return item.encrypted ? [FolderLock, 'text-amber-500'] : [Folder, 'text-amber-500']
  if (item.locked) return [Lock, 'text-muted-foreground']
  const ext = extOf(item.name)
  if (ext === 'pdf') return [FileText, 'text-red-500']
  if (WORD.has(ext)) return [FileText, 'text-blue-500']
  if (SHEET.has(ext)) return [FileSpreadsheet, 'text-emerald-600']
  if (SLIDES.has(ext)) return [Presentation, 'text-orange-500']
  if (CODE.has(ext)) return [FileCode, 'text-violet-500']
  switch (item.category) {
    case 'image':
      return [FileImage, 'text-rose-500']
    case 'video':
      return [FileVideoCamera, 'text-purple-500']
    case 'audio':
      return [FileMusic, 'text-orange-500']
    case 'archive':
      return [FileArchive, 'text-amber-600']
    case 'document':
      return [FileText, 'text-sky-600']
    default:
      return [File, 'text-muted-foreground']
  }
}

export function FileIcon({ item, className }: { item: DriveItem; className?: string }) {
  const [Icon, color] = pick(item)
  return <Icon className={cn('shrink-0', color, className)} />
}

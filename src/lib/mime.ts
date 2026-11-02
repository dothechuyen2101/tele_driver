export type Category = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other'

export const CATEGORIES: Category[] = ['image', 'video', 'audio', 'document', 'archive', 'other']

const DOC_EXT = new Set([
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'epub',
  'mobi', 'json', 'xml', 'yaml', 'yml', 'html', 'htm', 'log', 'ini', 'toml', 'tex',
])
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'dmg', 'apk', 'xapk', 'ipa', 'exe', 'msi', 'deb', 'rpm'])
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'heic', 'heif', 'tif', 'tiff', 'ico'])
const VIDEO_EXT = new Set(['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'wmv', 'flv', '3gp', 'ts', 'mpg', 'mpeg'])
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma', 'aiff'])
const CODE_EXT = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'sh',
  'bat', 'ps1', 'sql', 'css', 'scss', 'vue', 'svelte', 'lua', 'dart', 'r',
])

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', bmp: 'image/bmp', heic: 'image/heic', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
  mkv: 'video/x-matroska', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
  flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html',
  zip: 'application/zip', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar',
}

export function extOf(name: string) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function guessMime(name: string, given?: string) {
  if (given && given !== 'application/octet-stream') return given
  return EXT_MIME[extOf(name)] ?? given ?? 'application/octet-stream'
}

export function categorize(mime: string, name: string): Category {
  const ext = extOf(name)
  if (mime.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image'
  if (mime.startsWith('video/') || VIDEO_EXT.has(ext)) return 'video'
  if (mime.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio'
  if (ARCHIVE_EXT.has(ext) || /zip|rar|7z|tar|compressed/.test(mime)) return 'archive'
  if (DOC_EXT.has(ext) || CODE_EXT.has(ext) || mime.startsWith('text/') || /pdf|word|excel|sheet|presentation|powerpoint|opendocument/.test(mime))
    return 'document'
  return 'other'
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none'

export function previewKind(mime: string, name: string): PreviewKind {
  const ext = extOf(name)
  if (mime.startsWith('image/') && !['heic', 'heif', 'tif', 'tiff'].includes(ext)) return 'image'
  if (mime.startsWith('video/') || ['mp4', 'webm', 'm4v', 'mov', 'mkv'].includes(ext)) return 'video'
  if (mime.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (mime.startsWith('text/') || DOC_EXT.has(ext) && ['txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'log', 'ini', 'toml'].includes(ext) || CODE_EXT.has(ext))
    return 'text'
  return 'none'
}

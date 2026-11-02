export interface DroppedFile {
  file: File
  /** Path including dropped folder names, e.g. `Photos/2024/a.jpg`; undefined for loose files. */
  relPath?: string
}

function readEntries(reader: FileSystemDirectoryReader) {
  return new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
}

function entryFile(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject))
}

/** Expands a drop (files and whole folders) into a flat list with relative paths. */
export async function collectDropped(dt: DataTransfer): Promise<DroppedFile[]> {
  // Entries must be taken synchronously, before the first await.
  const entries = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.() ?? null)
  const loose = [...dt.files]
  if (!entries.some(Boolean)) return loose.map((file) => ({ file }))
  const out: DroppedFile[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await entryFile(entry as FileSystemFileEntry)
      out.push({ file, relPath: prefix ? prefix + file.name : undefined })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await readEntries(reader)
        if (!batch.length) break
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
      }
    }
  }
  for (const e of entries) if (e) await walk(e, '')
  return out
}

export function hasFiles(e: React.DragEvent | DragEvent) {
  return !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
}

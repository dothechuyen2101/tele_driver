import { useRef, type ReactNode } from 'react'
import { FileUp, FolderPlus, FolderUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { startUpload } from '@/app/actions'
import { useCurrentFolderId } from '@/hooks/useView'
import { useUi } from '@/stores/ui'
import { ActionDropdown } from '../ui/menu'

/** "New" dropdown: folder, file upload, folder upload. */
export function NewMenu({ children, align = 'start' }: { children: ReactNode; align?: 'start' | 'end' }) {
  const { t } = useTranslation()
  const folderId = useCurrentFolderId()
  const fileInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)

  const onFiles = (list: FileList | null, withPaths: boolean) => {
    if (!list?.length) return
    startUpload([...list].map((file) => ({ file, folderId, relPath: withPaths ? file.webkitRelativePath || undefined : undefined })))
  }

  return (
    <>
      <ActionDropdown
        align={align}
        actions={[
          { key: 'folder', label: t('new.folder'), icon: <FolderPlus />, onSelect: () => useUi.getState().openDialog({ kind: 'newFolder', parentId: folderId }) },
          { key: 'files', label: t('new.uploadFiles'), icon: <FileUp />, separatorBefore: true, onSelect: () => fileInput.current?.click() },
          { key: 'dir', label: t('new.uploadFolder'), icon: <FolderUp />, onSelect: () => dirInput.current?.click() },
        ]}
      >
        {children}
      </ActionDropdown>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onFiles(e.target.files, false)
          e.target.value = ''
        }}
      />
      <input
        ref={dirInput}
        type="file"
        hidden
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          onFiles(e.target.files, true)
          e.target.value = ''
        }}
      />
    </>
  )
}

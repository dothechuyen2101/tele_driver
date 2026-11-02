import { useUi } from '@/stores/ui'
import { ForwardDialog } from './ForwardDialog'
import { FolderPickerDialog, MoveDialog } from './MoveDialog'
import { SettingsDialog } from './SettingsDialog'
import { ConfirmDialog, DetailsDialog, NewFolderDialog, RenameDialog } from './SimpleDialogs'
import { VaultDialog } from './VaultDialog'

/** Renders whichever dialog the UI store currently asks for. */
export function Dialogs() {
  const dialog = useUi((s) => s.dialog)
  const close = useUi((s) => s.closeDialog)
  if (!dialog) return null
  switch (dialog.kind) {
    case 'newFolder':
      return <NewFolderDialog parentId={dialog.parentId} onClose={close} />
    case 'rename':
      return <RenameDialog item={dialog.item} onClose={close} />
    case 'move':
      return <MoveDialog items={dialog.items} onClose={close} />
    case 'forward':
      return <ForwardDialog files={dialog.files} onClose={close} />
    case 'confirm':
      return <ConfirmDialog {...dialog} onClose={close} />
    case 'details':
      return <DetailsDialog item={dialog.item} onClose={close} />
    case 'vault':
      return <VaultDialog mode={dialog.mode} then={dialog.then} onClose={close} />
    case 'pickFolder':
      return <FolderPickerDialog title={dialog.title} confirmLabel={dialog.confirmLabel} initial={dialog.initial} onPick={dialog.onPick} onClose={close} />
    case 'settings':
      return <SettingsDialog tab={dialog.tab} onClose={close} />
  }
}

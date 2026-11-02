import { ensureFolder } from '@/drive/ops'
import i18n from '@/i18n'
import { describeError } from '@/lib/uiErrors'

export interface TargetState {
  parentId: number
  createSub: boolean
  subfolder: string
}

/** Destination folder id, creating the optional sub-folder first. */
export function resolveTarget(v: TargetState) {
  const name = v.subfolder.trim()
  return v.createSub && name ? ensureFolder(v.parentId, name) : Promise.resolve(v.parentId)
}

const REASONS = ['duplicate', 'protected', 'gone', 'empty', 'shortcut', 'unsupported', 'source']

/** Human text for why an item was skipped or failed. */
export function reasonLabel(reason: string | undefined) {
  if (!reason) return ''
  return REASONS.includes(reason) ? i18n.t(`imports.reasons.${reason}`) : describeError(new Error(reason))
}

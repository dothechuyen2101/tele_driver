import { describe, expect, it } from 'vitest'
import { toEntry } from './drive'

describe('Google Drive entries', () => {
  it('keeps regular files with their size', () => {
    expect(toEntry({ id: 'a', name: 'video.mp4', mimeType: 'video/mp4', size: '1234' }, 'Trips/2024')).toEqual({
      fileId: 'a',
      dir: 'Trips/2024',
      name: 'video.mp4',
      mime: 'video/mp4',
      size: 1234,
      skip: undefined,
    })
  })

  it('exports Google Docs to Office formats and adds the extension once', () => {
    const doc = toEntry({ id: 'd', name: 'Báo cáo', mimeType: 'application/vnd.google-apps.document' }, '')
    expect(doc).toMatchObject({ name: 'Báo cáo.docx', size: -1, exportMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    expect(doc.skip).toBeUndefined()
    expect(toEntry({ id: 's', name: 'Budget.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet' }, '').name).toBe('Budget.xlsx')
    expect(toEntry({ id: 'p', name: 'Deck', mimeType: 'application/vnd.google-apps.presentation' }, '').name).toBe('Deck.pptx')
  })

  it('skips shortcuts, forms and empty files with a reason', () => {
    expect(toEntry({ id: 'x', name: 'link', mimeType: 'application/vnd.google-apps.shortcut' }, '').skip).toBe('shortcut')
    expect(toEntry({ id: 'f', name: 'Survey', mimeType: 'application/vnd.google-apps.form' }, '').skip).toBe('unsupported')
    expect(toEntry({ id: 'e', name: 'empty.txt', mimeType: 'text/plain', size: '0' }, '').skip).toBe('empty')
  })
})

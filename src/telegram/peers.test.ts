import { describe, expect, it } from 'vitest'
import { chatKeyOf, parsePeerLink, peerFromKey } from './peers'

describe('parsePeerLink', () => {
  it.each([
    ['@durov', { type: 'username', username: 'durov' }],
    ['durov', { type: 'username', username: 'durov' }],
    ['https://t.me/telegram', { type: 'username', username: 'telegram' }],
    ['t.me/telegram/123', { type: 'username', username: 'telegram' }],
    ['https://t.me/s/telegram', { type: 'username', username: 'telegram' }],
    ['https://telegram.me/telegram?single', { type: 'username', username: 'telegram' }],
    ['https://t.me/c/1234567890/55', { type: 'channelId', id: '1234567890' }],
    ['https://t.me/+AbCdEf_123', { type: 'invite', hash: 'AbCdEf_123' }],
    ['https://t.me/joinchat/AbCdEf', { type: 'invite', hash: 'AbCdEf' }],
  ])('%s', (input, expected) => {
    expect(parsePeerLink(input)).toEqual(expected)
  })

  it.each(['', 'hi', 'https://example.com/durov', 't.me/', '@a b', 'https://t.me/+'])('rejects %j', (input) => {
    expect(parsePeerLink(input)).toBeUndefined()
  })
})

describe('peer keys', () => {
  it('round-trips chat keys stored in #td_sub', () => {
    expect(chatKeyOf(peerFromKey('c123', '9', 'News')!)).toBe('c123')
    expect(chatKeyOf(peerFromKey('u77', '5', 'Bot')!)).toBe('u77')
    expect(chatKeyOf(peerFromKey('g5', '', 'Group')!)).toBe('g5')
    expect(peerFromKey('self', '', 'Saved')).toEqual({ kind: 'self', title: 'Saved' })
    expect(peerFromKey('cabc', '', 'x')).toBeUndefined()
    expect(peerFromKey('z1', '', 'x')).toBeUndefined()
  })
})

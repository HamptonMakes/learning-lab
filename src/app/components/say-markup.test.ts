import { describe, expect, it } from 'vitest'
import { parseSay, sayToText } from './say-markup'

describe('parseSay', () => {
  it('returns plain text untouched', () => {
    expect(parseSay('Alice sets her status.')).toEqual([
      { kind: 'text', text: 'Alice sets her status.' },
    ])
  })
  it('extracts terms, links and code', () => {
    expect(
      parseSay(
        'An **LWW register** holds a value. See [locks](/crdts/the-problem/locks) and `ts`.',
      ),
    ).toEqual([
      { kind: 'text', text: 'An ' },
      { kind: 'term', text: 'LWW register' },
      { kind: 'text', text: ' holds a value. See ' },
      { kind: 'link', text: 'locks', href: '/crdts/the-problem/locks' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'ts' },
      { kind: 'text', text: '.' },
    ])
  })
  it('ignores external links and stray asterisks', () => {
    expect(parseSay('a * b [x](https://e.com)')).toEqual([
      { kind: 'text', text: 'a * b [x](https://e.com)' },
    ])
  })
  it('sayToText strips markup', () => {
    expect(sayToText('**Whoops** — see [this](/a/b/c) `now`')).toBe('Whoops — see this now')
  })
})

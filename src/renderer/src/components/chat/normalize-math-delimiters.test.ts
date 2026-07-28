import { describe, expect, it } from 'vitest'
import { normalizeMathDelimiters } from './normalize-math-delimiters'

describe('normalizeMathDelimiters', () => {
  it('leaves text without LaTeX-paren/bracket delimiters untouched', () => {
    const input = 'Plain text with $x^2$ and $$y=1$$ already in dollar form.'
    expect(normalizeMathDelimiters(input)).toBe(input)
  })

  it('converts inline \\(...\\) to $...$', () => {
    expect(normalizeMathDelimiters('The mass is \\(E = mc^2\\) exactly.')).toBe(
      'The mass is $E = mc^2$ exactly.'
    )
  })

  it('converts block \\[...\\] to $$...$$', () => {
    expect(normalizeMathDelimiters('Formula:\n\\[a^2 + b^2 = c^2\\]\nend')).toBe(
      'Formula:\n$$a^2 + b^2 = c^2$$\nend'
    )
  })

  it('handles multiple and mixed delimiters in one string', () => {
    const input = 'First \\(a\\), then \\[b\\], then \\(c\\).'
    expect(normalizeMathDelimiters(input)).toBe('First $a$, then $$b$$, then $c$.')
  })

  it('converts multi-line block math', () => {
    const input = '\\[\n\\frac{1}{2}\n\\]'
    expect(normalizeMathDelimiters(input)).toBe('$$\n\\frac{1}{2}\n$$')
  })

  it('does not touch delimiters inside a fenced code block', () => {
    const input = '```js\nconst re = /\\(x\\)/\n```\ntext \\(y\\) here'
    // Inside the fence stays raw; the trailing prose is converted.
    expect(normalizeMathDelimiters(input)).toBe('```js\nconst re = /\\(x\\)/\n```\ntext $y$ here')
  })

  it('does not touch delimiters inside inline code spans', () => {
    const input = 'Use `\\(x\\)` literally, but render \\(x\\) here.'
    expect(normalizeMathDelimiters(input)).toBe('Use `\\(x\\)` literally, but render $x$ here.')
  })

  it('leaves an unmatched lone delimiter as-is', () => {
    const input = 'A lone \\( with no close and \\] with no open.'
    expect(normalizeMathDelimiters(input)).toBe(input)
  })

  it('returns the input unchanged when there is nothing to convert', () => {
    expect(normalizeMathDelimiters('')).toBe('')
    expect(normalizeMathDelimiters('no math at all')).toBe('no math at all')
  })
})

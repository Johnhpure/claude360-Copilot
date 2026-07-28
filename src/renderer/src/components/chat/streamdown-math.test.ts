import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { createMathPlugin } from '@streamdown/math'
import { normalizeMathDelimiters } from './normalize-math-delimiters'

/**
 * End-to-end proof that the math plugin we hand to Streamdown actually turns
 * formulas into KaTeX markup. We run the SAME remark/rehype plugins Streamdown
 * composes (`math.remarkPlugin` then `math.rehypePlugin`) over a small pipeline
 * and inspect the produced hast tree, so a regression in the plugin config
 * (e.g. singleDollarTextMath flipping off) fails here without a full DOM mount.
 *
 * We serialize the hast tree to JSON rather than to an HTML string to avoid
 * pulling rehype-stringify in as a dependency just for the test.
 */
const math = createMathPlugin({ singleDollarTextMath: true })

function renderToHastJson(markdown: string): string {
  const normalized = normalizeMathDelimiters(markdown)
  // math.remarkPlugin / rehypePlugin are [plugin, options] tuples; spread so
  // unified sees (plugin, options) rather than mistaking the tuple for a preset.
  const [remarkMath, remarkMathOpts] = math.remarkPlugin as [unknown, unknown]
  const [rehypeKatex, rehypeKatexOpts] = math.rehypePlugin as [unknown, unknown]
  const processor = unified()
    .use(remarkParse)
    .use(remarkMath as never, remarkMathOpts as never)
    .use(remarkRehype)
    .use(rehypeKatex as never, rehypeKatexOpts as never)
  const tree = processor.runSync(processor.parse(normalized))
  return JSON.stringify(tree)
}

describe('streamdown math plugin', () => {
  it('renders block $$...$$ into KaTeX markup', () => {
    const json = renderToHastJson('$$a^2 + b^2 = c^2$$')
    expect(json).toContain('katex')
    // KaTeX emits a MathML <math> element alongside the HTML span tree.
    expect(json).toContain('math')
  })

  it('renders inline $...$ into KaTeX markup (singleDollarTextMath on)', () => {
    const json = renderToHastJson('mass is $E = mc^2$ here')
    expect(json).toContain('katex')
  })

  it('renders normalized \\(...\\) inline delimiters', () => {
    const json = renderToHastJson('velocity \\(v = d/t\\) shown')
    expect(json).toContain('katex')
  })

  it('renders normalized \\[...\\] block delimiters', () => {
    const json = renderToHastJson('\\[\\int_0^1 x\\,dx\\]')
    expect(json).toContain('katex')
  })

  it('leaves prose without math free of KaTeX markup', () => {
    const json = renderToHastJson('just a normal sentence with a price of 5 dollars')
    expect(json).not.toContain('katex')
  })
})

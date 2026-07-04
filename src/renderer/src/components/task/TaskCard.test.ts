import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TaskCard } from './TaskCard'

describe('TaskCard', () => {
  it('renders running state with breathing accent ring', () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, { status: 'running', title: 'Generating image' })
    )

    expect(html).toContain('data-status="running"')
    expect(html).toContain('Generating image')
    expect(html).toContain('ds-ui-breathe')
    expect(html).toContain('border-accent')
  })

  it('renders success state with green ring and no progress line', () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, { status: 'success', title: 'Done task', progress: 1 })
    )

    expect(html).toContain('data-status="success"')
    expect(html).toContain('border-ds-success')
    expect(html).not.toContain('ds-ui-breathe')
    expect(html).not.toContain('role="progressbar"')
  })

  it('renders error state with red ring', () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, { status: 'error', title: 'Failed task' })
    )

    expect(html).toContain('data-status="error"')
    expect(html).toContain('border-ds-danger')
    expect(html).not.toContain('role="progressbar"')
  })

  it('renders determinate progress bar when progress is provided', () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, { status: 'running', title: 'Half way', progress: 0.42 })
    )

    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="42"')
    expect(html).toContain('width:42%')
    expect(html).not.toContain('ds-ui-progress-sweep')
  })

  it('renders indeterminate sweep when progress is undefined', () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, { status: 'running', title: 'Unknown progress' })
    )

    expect(html).toContain('role="progressbar"')
    expect(html).toContain('ds-ui-progress-sweep')
    expect(html).not.toContain('aria-valuenow')
  })

  it('clamps out-of-range progress into 0-1', () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, { status: 'running', title: 'Overflow', progress: 1.5 })
    )

    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain('width:100%')
  })

  it('shows cancel button only for running status with onCancel', () => {
    const withCancel = renderToStaticMarkup(
      createElement(TaskCard, { status: 'running', title: 'T', onCancel: vi.fn() })
    )
    const withoutHandler = renderToStaticMarkup(
      createElement(TaskCard, { status: 'running', title: 'T' })
    )
    const wrongStatus = renderToStaticMarkup(
      createElement(TaskCard, { status: 'success', title: 'T', onCancel: vi.fn() })
    )

    expect(withCancel).toContain('Cancel')
    expect(withoutHandler).not.toContain('Cancel')
    expect(wrongStatus).not.toContain('Cancel')
  })

  it('shows retry button only for error status with onRetry', () => {
    const withRetry = renderToStaticMarkup(
      createElement(TaskCard, { status: 'error', title: 'T', onRetry: vi.fn() })
    )
    const withoutHandler = renderToStaticMarkup(
      createElement(TaskCard, { status: 'error', title: 'T' })
    )
    const wrongStatus = renderToStaticMarkup(
      createElement(TaskCard, { status: 'running', title: 'T', onRetry: vi.fn() })
    )

    expect(withRetry).toContain('Retry')
    expect(withoutHandler).not.toContain('Retry')
    expect(wrongStatus).not.toContain('Retry')
  })

  it('renders meta and children when provided', () => {
    const html = renderToStaticMarkup(
      createElement(
        TaskCard,
        { status: 'running', title: 'T', meta: 'gpt-image-1' },
        createElement('span', null, 'expanded detail')
      )
    )

    expect(html).toContain('gpt-image-1')
    expect(html).toContain('expanded detail')
  })
})

import { describe, expect, it } from 'vitest'
import {
  activeEditorProject,
  decideTrigger,
  extractSvgEditorProject,
  latestEditTs,
  pendingAnnotations,
  triggerMessage
} from './annotation-trigger'

const PROJECT = '/Users/me/work/projects/deck_ppt169_20260830'

const line = (record: Record<string, unknown>): string => JSON.stringify(record)

const saved = (ts: number, element = 'e1', file = '01.svg'): string =>
  line({ ts, file, element_id: element, action: 'annotation_saved', old: null, new: '改成蓝色' })

const applied = (ts: number, element = 'e1', file = '01.svg'): string =>
  line({ ts, file, element_id: element, action: 'annotation_applied', old: '改成蓝色', new: null })

const edit = (ts: number, element = 'e1', file = '01.svg'): string =>
  line({ ts, file, element_id: element, action: 'edit', kind: 'attr', key: 'fill' })

const base = {
  annotationsJsonl: '',
  editsJsonl: '',
  lastHandledTs: 0,
  hasExportedPptx: true
}

describe('pendingAnnotations', () => {
  it('reports a freshly saved annotation as pending', () => {
    expect(pendingAnnotations(saved(100))).toEqual({ hasPending: true, latestTs: 100 })
  })

  it('clears an annotation once the agent logs it as applied', () => {
    const log = [saved(100), applied(120)].join('\n')
    expect(pendingAnnotations(log)).toEqual({ hasPending: false, latestTs: 0 })
  })

  it('tracks each element separately so a partial apply still reads as pending', () => {
    // The agent applies annotations one at a time. Comparing timestamps
    // globally would treat "just applied e1" as "everything is done".
    const log = [saved(100, 'e1'), saved(101, 'e2'), applied(120, 'e1')].join('\n')
    expect(pendingAnnotations(log)).toEqual({ hasPending: true, latestTs: 101 })
  })

  it('treats a re-annotated element as pending again', () => {
    const log = [saved(100), applied(120), saved(130)].join('\n')
    expect(pendingAnnotations(log)).toEqual({ hasPending: true, latestTs: 130 })
  })

  it('ignores removals', () => {
    const log = [
      saved(100),
      line({ ts: 110, file: '01.svg', element_id: 'e1', action: 'annotation_removed' })
    ].join('\n')
    expect(pendingAnnotations(log)).toEqual({ hasPending: false, latestTs: 0 })
  })

  it('survives a torn trailing line while the editor is appending', () => {
    const log = `${saved(100)}\n{"ts": 101, "file": "02.sv`
    expect(pendingAnnotations(log)).toEqual({ hasPending: true, latestTs: 100 })
  })

  it('handles an empty or missing log', () => {
    expect(pendingAnnotations('')).toEqual({ hasPending: false, latestTs: 0 })
  })
})

describe('latestEditTs', () => {
  it('returns the newest edit timestamp', () => {
    expect(latestEditTs([edit(10), edit(30), edit(20)].join('\n'))).toBe(30)
  })

  it('returns 0 for an empty log', () => {
    expect(latestEditTs('')).toBe(0)
  })
})

describe('decideTrigger', () => {
  it('asks to apply annotations when one is pending', () => {
    expect(decideTrigger({ ...base, annotationsJsonl: saved(100) })).toEqual({
      kind: 'apply-annotations',
      ts: 100
    })
  })

  it('does not fire twice for the same submission', () => {
    const input = { ...base, annotationsJsonl: saved(100) }
    const first = decideTrigger(input)
    expect(first).not.toBeNull()
    expect(decideTrigger({ ...input, lastHandledTs: first!.ts })).toBeNull()
  })

  it('fires again for a newer annotation after the first was handled', () => {
    const log = [saved(100, 'e1'), saved(200, 'e2')].join('\n')
    expect(decideTrigger({ ...base, annotationsJsonl: log, lastHandledTs: 100 })).toEqual({
      kind: 'apply-annotations',
      ts: 200
    })
  })

  it('falls back to a re-export when only direct edits changed', () => {
    expect(decideTrigger({ ...base, editsJsonl: edit(50) })).toEqual({
      kind: 're-export',
      ts: 50
    })
  })

  it('prefers applying annotations over re-export when both are present', () => {
    // Applying annotations re-exports anyway; a separate re-export is noise.
    const result = decideTrigger({
      ...base,
      annotationsJsonl: saved(100),
      editsJsonl: edit(120)
    })
    expect(result?.kind).toBe('apply-annotations')
  })

  it('stays silent before the first PPTX export (skill gate)', () => {
    // live-preview.md Step 2 refuses to apply annotations until Step 7 has
    // produced a PPTX, so firing here would only earn a rejection.
    expect(
      decideTrigger({ ...base, annotationsJsonl: saved(100), hasExportedPptx: false })
    ).toBeNull()
  })

  it('stays silent when nothing changed', () => {
    expect(decideTrigger(base)).toBeNull()
  })
})

describe('extractSvgEditorProject', () => {
  it('reads the quoted form the runtime actually emits', () => {
    const command = `python3 '/skills/ppt-master/scripts/svg_editor/server.py' '${PROJECT}' --daemon`
    expect(extractSvgEditorProject(command)).toBe(PROJECT)
  })

  it('reads an unquoted invocation', () => {
    const command = `python3 /skills/ppt-master/scripts/svg_editor/server.py ${PROJECT} --daemon --live`
    expect(extractSvgEditorProject(command)).toBe(PROJECT)
  })

  it('handles a cd-prefixed compound command', () => {
    const command = `cd '/skills/ppt-master' && python3 scripts/svg_editor/server.py '${PROJECT}' --daemon`
    expect(extractSvgEditorProject(command)).toBe(PROJECT)
  })

  it('skips flags that precede the project argument', () => {
    const command = `python3 scripts/svg_editor/server.py --no-browser '${PROJECT}'`
    expect(extractSvgEditorProject(command)).toBe(PROJECT)
  })

  it('ignores unrelated commands', () => {
    expect(extractSvgEditorProject('python3 scripts/confirm_ui/server.py /p --daemon')).toBeNull()
    expect(extractSvgEditorProject('ls -la')).toBeNull()
  })

  it('returns null when the project argument is missing', () => {
    expect(extractSvgEditorProject('python3 scripts/svg_editor/server.py --daemon')).toBeNull()
  })
})

describe('activeEditorProject', () => {
  const toolBlock = (command: string): Record<string, unknown> => ({
    kind: 'tool',
    meta: { command }
  })
  const launch = (project: string): string =>
    `python3 scripts/svg_editor/server.py '${project}' --daemon`

  it('finds the project from a tool block command', () => {
    expect(activeEditorProject([toolBlock(launch(PROJECT))])).toBe(PROJECT)
  })

  it('prefers the most recent launch when a session reopened another project', () => {
    const older = '/Users/me/work/projects/old_ppt169_20260101'
    expect(
      activeEditorProject([toolBlock(launch(older)), toolBlock(launch(PROJECT))])
    ).toBe(PROJECT)
  })

  it('falls back to the block summary when meta carries no command', () => {
    expect(activeEditorProject([{ kind: 'tool', summary: launch(PROJECT) }])).toBe(PROJECT)
  })

  it('ignores non-tool blocks and unrelated tools', () => {
    expect(
      activeEditorProject([
        { kind: 'assistant', summary: launch(PROJECT) },
        toolBlock('ls -la')
      ])
    ).toBeNull()
  })

  it('returns null for an empty session', () => {
    expect(activeEditorProject([])).toBeNull()
  })
})

describe('triggerMessage', () => {
  it('carries the phrase the skill recognises as an apply signal', () => {
    expect(triggerMessage('apply-annotations')).toContain('apply my annotations')
  })

  it('asks for a re-export on the direct-edit path', () => {
    const message = triggerMessage('re-export')
    expect(message).toContain('重新导出')
    expect(message).not.toContain('apply my annotations')
  })
})

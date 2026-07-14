import type { ChatBlock } from '../agent/types'
import {
  countDiffStats,
  extractDiffFilePath,
  extractUnifiedDiffText,
  formatFilePathForDisplay
} from './diff-stats'

export type ComposerChangedFile = {
  path: string
  added: number
  removed: number
}

export type ComposerChangeSummary = {
  files: ComposerChangedFile[]
  added: number
  removed: number
}

export function collectComposerChangeSummary(
  blocks: ChatBlock[],
  workspaceRoot: string
): ComposerChangeSummary | null {
  const byPath = new Map<string, ComposerChangedFile>()

  for (const block of blocks) {
    if (!(block.kind === 'tool' && block.toolKind === 'file_change' && block.status === 'success')) {
      continue
    }
    const patch = extractUnifiedDiffText(block.detail)
    if (!patch) continue

    const path = formatFilePathForDisplay(extractDiffFilePath(patch, block.filePath), workspaceRoot)
    if (!path) continue

    const stats = countDiffStats(patch) ?? { added: 0, removed: 0 }
    const existing = byPath.get(path)
    if (existing) {
      existing.added += stats.added
      existing.removed += stats.removed
    } else {
      byPath.set(path, { path, added: stats.added, removed: stats.removed })
    }
  }

  if (byPath.size === 0) return null

  const files = [...byPath.values()]
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0)
  }
}

let composerChangeSummaryCache: {
  blocks: ChatBlock[]
  workspaceRoot: string
  value: ComposerChangeSummary | null
} | null = null

function sameComposerChangeSummary(
  a: ComposerChangeSummary | null,
  b: ComposerChangeSummary | null
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.added !== b.added || a.removed !== b.removed || a.files.length !== b.files.length) {
    return false
  }
  for (let index = 0; index < a.files.length; index += 1) {
    const left = a.files[index]!
    const right = b.files[index]!
    if (left.path !== right.path || left.added !== right.added || left.removed !== right.removed) {
      return false
    }
  }
  return true
}

/**
 * Reference-stable zustand selector wrapper (07-14-timeline-performance R2):
 * recomputes only when the blocks array reference or workspace changes, and
 * returns the PREVIOUS object whenever the summary content is unchanged —
 * command-output streaming rebuilds `blocks` every batch without changing
 * file stats, and that must not re-render the Workbench/composer.
 */
export function selectComposerChangeSummary(
  blocks: ChatBlock[],
  workspaceRoot: string
): ComposerChangeSummary | null {
  const cached = composerChangeSummaryCache
  if (cached && cached.blocks === blocks && cached.workspaceRoot === workspaceRoot) {
    return cached.value
  }
  const next = collectComposerChangeSummary(blocks, workspaceRoot)
  const value = cached && sameComposerChangeSummary(cached.value, next) ? cached.value : next
  composerChangeSummaryCache = { blocks, workspaceRoot, value }
  return value
}

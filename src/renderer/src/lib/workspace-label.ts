import i18n from '../i18n'
import {
  APP_PRODUCT_NAME,
  DEFAULT_CODE_WORKSPACE_ROOT,
  LEGACY_DEFAULT_CODE_WORKSPACE_ROOTS
} from '@shared/app-settings'

const DEFAULT_WORKSPACE_LABEL = APP_PRODUCT_NAME

function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function defaultWorkspaceSuffix(path: string): string {
  const normalized = normalizePathForMatch(path)
  return normalized.startsWith('~/') ? normalized.slice(1) : normalized
}

// Treat both current and legacy default workspace paths as the app workspace.
// Older installs can keep legacy paths until settings normalization completes.
function isDefaultWorkspacePath(path: string): boolean {
  const normalized = normalizePathForMatch(path)
  return [DEFAULT_CODE_WORKSPACE_ROOT, ...LEGACY_DEFAULT_CODE_WORKSPACE_ROOTS].some((candidate) => {
    const normalizedCandidate = normalizePathForMatch(candidate)
    const suffix = defaultWorkspaceSuffix(candidate)
    return normalized === normalizedCandidate || normalized.endsWith(suffix)
  })
}

export function workspaceLabelFromPath(path: string): string {
  const p = path?.trim() ?? ''
  if (!p) return i18n.t('common:workingDirectory')
  if (isDefaultWorkspacePath(p)) return DEFAULT_WORKSPACE_LABEL
  const normalized = p.replace(/[/\\]+$/, '')
  const parts = normalized.split(/[/\\]/)
  const base = parts[parts.length - 1]
  return base || i18n.t('common:workingDirectory')
}

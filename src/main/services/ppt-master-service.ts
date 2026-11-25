/**
 * Facade over the PPT Master skill installer and its managed Python
 * environment. IPC handlers and the renderer only ever see the combined state,
 * so "is the PPT assistant usable" is a single question with a single answer.
 */
import { join } from 'node:path'
import type {
  PptMasterActionResult,
  PptMasterPythonState,
  PptMasterSkillState,
  PptMasterState
} from '../../shared/ppt-master'
import { pptMasterIsReady } from '../../shared/ppt-master'
import {
  installPptMasterSkill,
  pptMasterSkillState,
  uninstallPptMasterSkill
} from './ppt-master-installer'
import { installPptMasterPython, pptMasterPythonState } from './ppt-master-python-env'

export type PptMasterServiceInput = {
  userDataDir: string
  proxyUrl?: string
  signal?: AbortSignal
  onState?: (state: PptMasterState) => void
}

export async function pptMasterState(userDataDir: string): Promise<PptMasterState> {
  const [skill, python] = await Promise.all([
    pptMasterSkillState(userDataDir),
    pptMasterPythonState({ userDataDir })
  ])
  return { skill, python }
}

/**
 * Provision whatever is missing: download and verify the skill package, then
 * build the venv and install its requirements. Safe to call when parts are
 * already in place — each step short-circuits on a ready state.
 */
export async function installPptMaster(
  input: PptMasterServiceInput
): Promise<PptMasterActionResult> {
  let skill = await pptMasterSkillState(input.userDataDir)
  let python = await pptMasterPythonState({ userDataDir: input.userDataDir })
  const emit = (): void => input.onState?.({ skill, python })

  if (skill.status !== 'ready') {
    skill = await installPptMasterSkill({
      userDataDir: input.userDataDir,
      ...(input.proxyUrl ? { proxyUrl: input.proxyUrl } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      onState: (next) => {
        skill = next
        emit()
      }
    })
    if (skill.status !== 'ready') {
      return { ok: false, message: skill.message ?? 'skill installation failed', state: { skill, python } }
    }
  }

  if (python.status !== 'ready') {
    python = { ...python, status: 'installing' }
    emit()
    python = await installPptMasterPython({
      userDataDir: input.userDataDir,
      requirementsPath: requirementsPathFor(skill),
      ...(input.signal ? { signal: input.signal } : {}),
      onProgress: (line) => {
        python = { ...python, status: 'installing', progress: line }
        emit()
      }
    })
    emit()
    if (python.status !== 'ready') {
      return {
        ok: false,
        message: python.message ?? 'Python environment setup failed',
        state: { skill, python }
      }
    }
  }

  const state = { skill, python }
  return pptMasterIsReady(state)
    ? { ok: true, state }
    : { ok: false, message: 'PPT Master is still not ready', state }
}

/**
 * Discard everything the app provisioned and build it again from scratch.
 *
 * Deliberately heavier than a second `installPptMaster`: that one trusts the
 * recorded state and skips anything already "ready", which is exactly wrong for
 * the cases repair exists to fix — a truncated extraction that still has a
 * SKILL.md, or a venv whose wheels no longer load against the host libraries.
 * A local directory override is untouched; only userData is cleared.
 */
export async function repairPptMaster(
  input: PptMasterServiceInput
): Promise<PptMasterActionResult> {
  await uninstallPptMasterSkill(input.userDataDir)
  return installPptMaster(input)
}

function requirementsPathFor(skill: PptMasterSkillState): string {
  return join(skill.skillDir ?? '', 'requirements.txt')
}

export type { PptMasterPythonState, PptMasterSkillState }

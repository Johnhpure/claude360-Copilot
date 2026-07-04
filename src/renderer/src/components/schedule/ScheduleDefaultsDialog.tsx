import type { ReactElement } from 'react'
import { useState } from 'react'
import { X } from 'lucide-react'
import {
  DEFAULT_SCHEDULE_MODEL,
  SCHEDULE_MODEL_IDS,
  mergeScheduleSettings,
  type ScheduleSettingsV1
} from '@shared/app-settings'
import {
  compactHomePathForSettingsDisplay,
  compactHomePathTextForSettingsDisplay,
  expandHomePathForSettingsUse,
  expandHomePathListForSettingsUse,
  expandHomePathTextForSettingsUse
} from '../../lib/settings-home-paths'
import { Button, Input, Modal, Select, Textarea } from '../ui'

type ScheduleModelProviderOption = {
  providerId: string
  label: string
  modelIds: string[]
}

function splitLooseList(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function modelIdsEqual(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function firstConcreteModel(modelIds: readonly string[], fallback = DEFAULT_SCHEDULE_MODEL): string {
  return modelIds.find((model) => model.trim() && model.trim().toLowerCase() !== 'auto') ?? fallback
}

function resolveDefaultsModelSelection(
  providers: readonly ScheduleModelProviderOption[],
  providerId: string | undefined,
  model: string | undefined
): { providerId: string; model: string } {
  const requestedProviderId = providerId?.trim() ?? ''
  const requestedModel = model?.trim() ?? ''
  const providerById = providers.find((provider) => provider.providerId === requestedProviderId)
  const providerByModel = requestedModel && requestedModel.toLowerCase() !== 'auto'
    ? providers.find((provider) => provider.modelIds.some((id) => modelIdsEqual(id, requestedModel)))
    : undefined
  const provider = providerById ?? providerByModel ?? providers[0]
  if (!provider) {
    return {
      providerId: requestedProviderId,
      model: requestedModel && requestedModel.toLowerCase() !== 'auto' ? requestedModel : DEFAULT_SCHEDULE_MODEL
    }
  }
  return {
    providerId: provider.providerId,
    model:
      requestedModel &&
      requestedModel.toLowerCase() !== 'auto' &&
      provider.modelIds.some((id) => modelIdsEqual(id, requestedModel))
        ? requestedModel
        : firstConcreteModel(provider.modelIds)
  }
}

export function ScheduleDefaultsDialog({
  schedule,
  modelProviders,
  onClose,
  onSave,
  t
}: {
  schedule: ScheduleSettingsV1
  modelProviders: ScheduleModelProviderOption[]
  onClose: () => void
  onSave: (patch: Parameters<typeof mergeScheduleSettings>[1]) => Promise<void>
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const [draft, setDraft] = useState({
    enabled: schedule.enabled,
    defaultWorkspaceRoot: schedule.defaultWorkspaceRoot,
    providerId: schedule.providerId ?? '',
    model: schedule.model,
    promptPrefix: schedule.promptPrefix,
    defaultNames: schedule.skills.defaultNames.join(', '),
    extraDirs: schedule.skills.extraDirs.join('\n')
  })

  const update = (patch: Partial<typeof draft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const save = async (): Promise<void> => {
    const selection = resolveDefaultsModelSelection(modelProviders, draft.providerId, draft.model)
    await onSave({
      enabled: draft.enabled,
      defaultWorkspaceRoot: expandHomePathForSettingsUse(draft.defaultWorkspaceRoot),
      providerId: selection.providerId,
      model: selection.model,
      mode: 'agent',
      promptPrefix: draft.promptPrefix,
      skills: {
        defaultNames: splitLooseList(draft.defaultNames),
        extraDirs: expandHomePathListForSettingsUse(splitLooseList(draft.extraDirs))
      }
    })
  }
  const fallbackProviders = modelProviders.length > 0
    ? modelProviders
    : [{
        providerId: draft.providerId,
        label: draft.providerId || 'Default',
        modelIds: [...SCHEDULE_MODEL_IDS]
      }]
  const selection = resolveDefaultsModelSelection(fallbackProviders, draft.providerId, draft.model)
  const selectedProvider = fallbackProviders.find((provider) => provider.providerId === selection.providerId) ?? null
  const selectedModelIds = selectedProvider?.modelIds ?? [selection.model]
  const updateProvider = (providerId: string): void => {
    const next = resolveDefaultsModelSelection(fallbackProviders, providerId, '')
    update({ providerId: next.providerId, model: next.model })
  }
  const updateModel = (model: string): void => {
    const next = resolveDefaultsModelSelection(fallbackProviders, selection.providerId, model)
    update({ providerId: next.providerId, model: next.model })
  }

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={t('scheduleDefaultsTitle')}
      size="lg"
      className="max-h-[calc(100vh-4rem)] overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[16px] font-semibold text-ds-ink">
          {t('scheduleDefaultsTitle')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink"
          aria-label={t('close')}
          title={t('close')}
        >
          <X className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-ds-subtle px-3 py-2">
        <span className="text-[13px] text-ds-muted">{t('scheduleGlobalEnabled')}</span>
        <label className="inline-flex items-center">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
            className="sr-only"
          />
          <span className={`relative h-5 w-9 rounded-[var(--radius-pill)] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-oneui)] ${draft.enabled ? 'bg-accent' : 'bg-ds-faint'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-[var(--radius-pill)] bg-white shadow-[var(--c360-shadow-sm)] transition-[left] duration-[var(--motion-fast)] ease-[var(--ease-oneui)] ${draft.enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </span>
        </label>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-[13px] font-medium text-ds-ink">
          {t('scheduleProvider')}
          <Select
            value={selection.providerId}
            options={fallbackProviders.map((provider) => ({
              value: provider.providerId,
              label: provider.label
            }))}
            onChange={updateProvider}
          />
        </label>
        <label className="flex flex-col gap-2 text-[13px] font-medium text-ds-ink">
          {t('scheduleModel')}
          <Select
            value={selection.model}
            options={selectedModelIds.map((model) => ({ value: model, label: model }))}
            onChange={updateModel}
          />
        </label>
      </div>

      <label className="mt-4 flex flex-col gap-2 text-[13px] font-medium text-ds-ink">
        {t('scheduleDefaultWorkspace')}
        <Input
          value={compactHomePathForSettingsDisplay(draft.defaultWorkspaceRoot)}
          onChange={(event) =>
            update({ defaultWorkspaceRoot: expandHomePathForSettingsUse(event.target.value) })}
          placeholder={t('scheduleWorkspacePlaceholder')}
        />
      </label>

      <label className="mt-4 flex flex-col gap-2 text-[13px] font-medium text-ds-ink">
        {t('schedulePromptPrefix')}
        <Textarea
          rows={4}
          value={draft.promptPrefix}
          onChange={(event) => update({ promptPrefix: event.target.value })}
          placeholder={t('schedulePromptPrefixPlaceholder')}
          className="resize-y"
        />
      </label>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-[13px] font-medium text-ds-ink">
          {t('scheduleDefaultSkills')}
          <Textarea
            rows={3}
            value={draft.defaultNames}
            onChange={(event) => update({ defaultNames: event.target.value })}
            placeholder={t('scheduleDefaultSkillsPlaceholder')}
            className="resize-y"
          />
        </label>
        <label className="flex flex-col gap-2 text-[13px] font-medium text-ds-ink">
          {t('scheduleExtraSkillDirs')}
          <Textarea
            rows={3}
            value={compactHomePathTextForSettingsDisplay(draft.extraDirs)}
            onChange={(event) =>
              update({ extraDirs: expandHomePathTextForSettingsUse(event.target.value) })}
            placeholder={t('scheduleExtraSkillDirsPlaceholder')}
            className="resize-y"
          />
        </label>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button onClick={() => void save()}>{t('confirm')}</Button>
      </div>
    </Modal>
  )
}

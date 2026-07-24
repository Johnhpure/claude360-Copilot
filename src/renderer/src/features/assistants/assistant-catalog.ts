import type { BuiltinAssistantDefinition } from './assistant-types'
import { contractReviewPersona } from './personas/contract-review'
import { dataAnalysisPersona } from './personas/data-analysis'
import { meetingNotesPersona } from './personas/meeting-notes'
import { officialDocumentPersona } from './personas/official-document'
import { reportSummaryPersona } from './personas/report-summary'
import { researchPersona } from './personas/research'

export type BuiltinAssistantCatalog = {
  items: readonly BuiltinAssistantDefinition[]
  byId: ReadonlyMap<string, BuiltinAssistantDefinition>
  diagnostics: readonly string[]
}

type CreateCatalogOptions = {
  strict?: boolean
  reportInvalid?: (message: string) => void
}

const RAW_BUILTIN_ASSISTANTS: readonly BuiltinAssistantDefinition[] = [
  {
    id: 'builtin.official-document',
    version: 1,
    order: 10,
    nameKey: 'assistantNameOfficialDocument',
    descriptionKey: 'assistantDescriptionOfficialDocument',
    riskNoteKey: 'assistantRiskOfficialDocument',
    systemPrompt: officialDocumentPersona
  },
  {
    id: 'builtin.meeting-notes',
    version: 1,
    order: 20,
    nameKey: 'assistantNameMeetingNotes',
    descriptionKey: 'assistantDescriptionMeetingNotes',
    riskNoteKey: 'assistantRiskMeetingNotes',
    systemPrompt: meetingNotesPersona
  },
  {
    id: 'builtin.report-summary',
    version: 1,
    order: 30,
    nameKey: 'assistantNameReportSummary',
    descriptionKey: 'assistantDescriptionReportSummary',
    riskNoteKey: 'assistantRiskReportSummary',
    systemPrompt: reportSummaryPersona
  },
  {
    id: 'builtin.research',
    version: 1,
    order: 40,
    nameKey: 'assistantNameResearch',
    descriptionKey: 'assistantDescriptionResearch',
    riskNoteKey: 'assistantRiskResearch',
    systemPrompt: researchPersona
  },
  {
    id: 'builtin.data-analysis',
    version: 1,
    order: 50,
    nameKey: 'assistantNameDataAnalysis',
    descriptionKey: 'assistantDescriptionDataAnalysis',
    riskNoteKey: 'assistantRiskDataAnalysis',
    systemPrompt: dataAnalysisPersona
  },
  {
    id: 'builtin.contract-review',
    version: 1,
    order: 60,
    nameKey: 'assistantNameContractReview',
    descriptionKey: 'assistantDescriptionContractReview',
    riskNoteKey: 'assistantRiskContractReview',
    systemPrompt: contractReviewPersona
  }
]

function validateDefinition(
  definition: BuiltinAssistantDefinition,
  seenIds: ReadonlySet<string>,
  seenOrders: ReadonlySet<number>
): string[] {
  const errors: string[] = []
  const id = definition.id.trim()
  if (!id.startsWith('builtin.') || id === 'builtin.') {
    errors.push(`id must use the reserved builtin.* namespace: ${definition.id}`)
  }
  if (id !== definition.id) errors.push(`id must not contain surrounding whitespace: ${definition.id}`)
  if (seenIds.has(id)) errors.push(`duplicate id: ${id}`)
  if (!Number.isInteger(definition.version) || definition.version <= 0) {
    errors.push(`version must be a positive integer: ${id}`)
  }
  if (!Number.isFinite(definition.order)) errors.push(`order must be finite: ${id}`)
  if (seenOrders.has(definition.order)) errors.push(`duplicate order: ${definition.order}`)
  if (!definition.nameKey.trim()) errors.push(`nameKey must not be empty: ${id}`)
  if (!definition.descriptionKey.trim()) errors.push(`descriptionKey must not be empty: ${id}`)
  if (!definition.riskNoteKey.trim()) errors.push(`riskNoteKey must not be empty: ${id}`)
  if (!definition.systemPrompt.trim()) errors.push(`systemPrompt must not be empty: ${id}`)
  return errors
}

/**
 * Validate and build an immutable view of a builtin assistant catalog.
 *
 * Development/tests use strict mode so malformed product content fails fast.
 * Production callers may use non-strict mode to exclude malformed entries while
 * preserving a diagnostic instead of crashing the application.
 */
export function createBuiltinAssistantCatalog(
  definitions: readonly BuiltinAssistantDefinition[],
  options: CreateCatalogOptions = {}
): BuiltinAssistantCatalog {
  const strict = options.strict ?? true
  const seenIds = new Set<string>()
  const seenOrders = new Set<number>()
  const valid: BuiltinAssistantDefinition[] = []
  const diagnostics: string[] = []

  for (const source of definitions) {
    const errors = validateDefinition(source, seenIds, seenOrders)
    if (errors.length > 0) {
      const message = `[assistant-catalog] ${errors.join('; ')}`
      diagnostics.push(message)
      options.reportInvalid?.(message)
      if (strict) throw new Error(message)
      continue
    }

    const definition = Object.freeze({ ...source })
    seenIds.add(definition.id)
    seenOrders.add(definition.order)
    valid.push(definition)
  }

  valid.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  const items = Object.freeze([...valid])
  return Object.freeze({
    items,
    byId: new Map(items.map((definition) => [definition.id, definition])),
    diagnostics: Object.freeze([...diagnostics])
  })
}

const strictCatalogValidation = import.meta.env.DEV || import.meta.env.MODE === 'test'

export const builtinAssistantCatalog = createBuiltinAssistantCatalog(RAW_BUILTIN_ASSISTANTS, {
  strict: strictCatalogValidation,
  reportInvalid: strictCatalogValidation
    ? undefined
    : (message) => console.error(message)
})

export const builtinAssistants = builtinAssistantCatalog.items
export const builtinAssistantById = builtinAssistantCatalog.byId

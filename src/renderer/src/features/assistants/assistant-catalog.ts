import type { BuiltinAssistantDefinition } from './assistant-types'
import { briefingPublicityPersona } from './personas/briefing-publicity'
import { contractReviewPersona } from './personas/contract-review'
import { dataAnalysisPersona } from './personas/data-analysis'
import { meetingNotesPersona } from './personas/meeting-notes'
import { officialDocumentPersona } from './personas/official-document'
import { partyBuildingPersona } from './personas/party-building'
import { reportSummaryPersona } from './personas/report-summary'
import { researchPersona } from './personas/research'
import { rulesRegulationsPersona } from './personas/rules-regulations'
import { speechWritingPersona } from './personas/speech-writing'

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
    capabilityKey: 'assistantCapabilityOfficialDocument',
    strengthKeys: [
      'assistantStrengthOfficialDocument1',
      'assistantStrengthOfficialDocument2',
      'assistantStrengthOfficialDocument3',
      'assistantStrengthOfficialDocument4'
    ],
    exampleKeys: [
      'assistantExampleOfficialDocument1',
      'assistantExampleOfficialDocument2',
      'assistantExampleOfficialDocument3'
    ],
    systemPrompt: officialDocumentPersona
  },
  {
    id: 'builtin.meeting-notes',
    version: 1,
    order: 20,
    nameKey: 'assistantNameMeetingNotes',
    descriptionKey: 'assistantDescriptionMeetingNotes',
    riskNoteKey: 'assistantRiskMeetingNotes',
    capabilityKey: 'assistantCapabilityMeetingNotes',
    strengthKeys: [
      'assistantStrengthMeetingNotes1',
      'assistantStrengthMeetingNotes2',
      'assistantStrengthMeetingNotes3',
      'assistantStrengthMeetingNotes4'
    ],
    exampleKeys: [
      'assistantExampleMeetingNotes1',
      'assistantExampleMeetingNotes2',
      'assistantExampleMeetingNotes3'
    ],
    systemPrompt: meetingNotesPersona
  },
  {
    id: 'builtin.report-summary',
    version: 1,
    order: 30,
    nameKey: 'assistantNameReportSummary',
    descriptionKey: 'assistantDescriptionReportSummary',
    riskNoteKey: 'assistantRiskReportSummary',
    capabilityKey: 'assistantCapabilityReportSummary',
    strengthKeys: [
      'assistantStrengthReportSummary1',
      'assistantStrengthReportSummary2',
      'assistantStrengthReportSummary3',
      'assistantStrengthReportSummary4'
    ],
    exampleKeys: [
      'assistantExampleReportSummary1',
      'assistantExampleReportSummary2',
      'assistantExampleReportSummary3'
    ],
    systemPrompt: reportSummaryPersona
  },
  {
    id: 'builtin.research',
    version: 1,
    order: 40,
    nameKey: 'assistantNameResearch',
    descriptionKey: 'assistantDescriptionResearch',
    riskNoteKey: 'assistantRiskResearch',
    capabilityKey: 'assistantCapabilityResearch',
    strengthKeys: [
      'assistantStrengthResearch1',
      'assistantStrengthResearch2',
      'assistantStrengthResearch3',
      'assistantStrengthResearch4'
    ],
    exampleKeys: [
      'assistantExampleResearch1',
      'assistantExampleResearch2',
      'assistantExampleResearch3'
    ],
    systemPrompt: researchPersona
  },
  {
    id: 'builtin.data-analysis',
    version: 1,
    order: 50,
    nameKey: 'assistantNameDataAnalysis',
    descriptionKey: 'assistantDescriptionDataAnalysis',
    riskNoteKey: 'assistantRiskDataAnalysis',
    capabilityKey: 'assistantCapabilityDataAnalysis',
    strengthKeys: [
      'assistantStrengthDataAnalysis1',
      'assistantStrengthDataAnalysis2',
      'assistantStrengthDataAnalysis3',
      'assistantStrengthDataAnalysis4'
    ],
    exampleKeys: [
      'assistantExampleDataAnalysis1',
      'assistantExampleDataAnalysis2',
      'assistantExampleDataAnalysis3'
    ],
    systemPrompt: dataAnalysisPersona
  },
  {
    id: 'builtin.contract-review',
    version: 1,
    order: 60,
    nameKey: 'assistantNameContractReview',
    descriptionKey: 'assistantDescriptionContractReview',
    riskNoteKey: 'assistantRiskContractReview',
    capabilityKey: 'assistantCapabilityContractReview',
    strengthKeys: [
      'assistantStrengthContractReview1',
      'assistantStrengthContractReview2',
      'assistantStrengthContractReview3',
      'assistantStrengthContractReview4'
    ],
    exampleKeys: [
      'assistantExampleContractReview1',
      'assistantExampleContractReview2',
      'assistantExampleContractReview3'
    ],
    systemPrompt: contractReviewPersona
  },
  {
    id: 'builtin.speech-writing',
    version: 1,
    order: 70,
    nameKey: 'assistantNameSpeechWriting',
    descriptionKey: 'assistantDescriptionSpeechWriting',
    riskNoteKey: 'assistantRiskSpeechWriting',
    capabilityKey: 'assistantCapabilitySpeechWriting',
    strengthKeys: [
      'assistantStrengthSpeechWriting1',
      'assistantStrengthSpeechWriting2',
      'assistantStrengthSpeechWriting3',
      'assistantStrengthSpeechWriting4'
    ],
    exampleKeys: [
      'assistantExampleSpeechWriting1',
      'assistantExampleSpeechWriting2',
      'assistantExampleSpeechWriting3'
    ],
    systemPrompt: speechWritingPersona
  },
  {
    id: 'builtin.rules-regulations',
    version: 1,
    order: 80,
    nameKey: 'assistantNameRulesRegulations',
    descriptionKey: 'assistantDescriptionRulesRegulations',
    riskNoteKey: 'assistantRiskRulesRegulations',
    capabilityKey: 'assistantCapabilityRulesRegulations',
    strengthKeys: [
      'assistantStrengthRulesRegulations1',
      'assistantStrengthRulesRegulations2',
      'assistantStrengthRulesRegulations3',
      'assistantStrengthRulesRegulations4'
    ],
    exampleKeys: [
      'assistantExampleRulesRegulations1',
      'assistantExampleRulesRegulations2',
      'assistantExampleRulesRegulations3'
    ],
    systemPrompt: rulesRegulationsPersona
  },
  {
    id: 'builtin.briefing-publicity',
    version: 1,
    order: 90,
    nameKey: 'assistantNameBriefingPublicity',
    descriptionKey: 'assistantDescriptionBriefingPublicity',
    riskNoteKey: 'assistantRiskBriefingPublicity',
    capabilityKey: 'assistantCapabilityBriefingPublicity',
    strengthKeys: [
      'assistantStrengthBriefingPublicity1',
      'assistantStrengthBriefingPublicity2',
      'assistantStrengthBriefingPublicity3',
      'assistantStrengthBriefingPublicity4'
    ],
    exampleKeys: [
      'assistantExampleBriefingPublicity1',
      'assistantExampleBriefingPublicity2',
      'assistantExampleBriefingPublicity3'
    ],
    systemPrompt: briefingPublicityPersona
  },
  {
    id: 'builtin.party-building',
    version: 1,
    order: 100,
    nameKey: 'assistantNamePartyBuilding',
    descriptionKey: 'assistantDescriptionPartyBuilding',
    riskNoteKey: 'assistantRiskPartyBuilding',
    capabilityKey: 'assistantCapabilityPartyBuilding',
    strengthKeys: [
      'assistantStrengthPartyBuilding1',
      'assistantStrengthPartyBuilding2',
      'assistantStrengthPartyBuilding3',
      'assistantStrengthPartyBuilding4'
    ],
    exampleKeys: [
      'assistantExamplePartyBuilding1',
      'assistantExamplePartyBuilding2',
      'assistantExamplePartyBuilding3'
    ],
    systemPrompt: partyBuildingPersona
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
  if (!definition.capabilityKey.trim()) errors.push(`capabilityKey must not be empty: ${id}`)
  if (definition.strengthKeys.length === 0) errors.push(`strengthKeys must not be empty: ${id}`)
  if (definition.strengthKeys.some((key) => !key.trim())) {
    errors.push(`strengthKeys must not contain blanks: ${id}`)
  }
  if (definition.exampleKeys.length === 0) errors.push(`exampleKeys must not be empty: ${id}`)
  if (definition.exampleKeys.some((key) => !key.trim())) {
    errors.push(`exampleKeys must not contain blanks: ${id}`)
  }
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

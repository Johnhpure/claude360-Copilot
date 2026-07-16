/**
 * IPC channel names shared with the sandboxed preload.
 *
 * This module must stay free of runtime imports (zod included): the preload
 * bundle externalizes dependencies, and a sandboxed preload's `require` can
 * only load 'electron' — a transitive `require('zod')` here made the whole
 * preload fail to load in packaged v0.2.12/13 builds, killing window.kunGui
 * and surfacing everywhere in the UI as "connection failed".
 */
export const CRASH_CONTEXT_UPDATE_CHANNEL = 'crash:context:update'

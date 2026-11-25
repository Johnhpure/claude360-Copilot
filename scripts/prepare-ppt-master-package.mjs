#!/usr/bin/env node
/**
 * Stage the PPT Master skill into packages/ppt-master-skill/ before publishing.
 *
 * The payload is ~116MB across ~13k files, so it is not committed; this script
 * copies it from an upstream checkout at release time. The copy must be
 * byte-for-byte: the skill runs `scripts/attribution_guard.py` as a mandatory
 * step and refuses to work if its attribution files or gate scripts were
 * altered, so nothing here rewrites, prunes, or reformats the payload.
 *
 * Usage:
 *   node scripts/prepare-ppt-master-package.mjs --from /path/to/ppt-master
 *
 * `--from` accepts either the skill package directory itself (the one holding
 * SKILL.md) or a parent containing `ppt-master/` or `skills/ppt-master/`.
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_DIR = join(REPO_ROOT, 'packages', 'ppt-master-skill')
const PAYLOAD_DIR = join(PACKAGE_DIR, 'ppt-master')

/** Files the skill's own integrity gate requires; a missing one fails the build. */
const REQUIRED_FILES = [
  'SKILL.md',
  'LICENSE',
  'SPONSORS.md',
  'SPONSORS_CN.md',
  'requirements.txt',
  join('scripts', 'attribution_guard.py'),
  join('workflows', 'routing.md')
]

async function main() {
  const from = argValue('--from')
  if (!from) fail('missing --from <path to a ppt-master checkout>')

  const source = await resolveSkillDir(resolve(from))
  const version = await readSkillVersion(source)
  const declared = JSON.parse(await readFile(join(PACKAGE_DIR, 'package.json'), 'utf8')).version

  console.log(`source:  ${source}`)
  console.log(`version: ${version ?? '(unknown)'} (package.json declares ${declared})`)
  if (version && version !== declared) {
    fail(
      `version mismatch: the skill reports ${version} but packages/ppt-master-skill/package.json ` +
      `declares ${declared}. Update package.json and PPT_MASTER_VERSION in src/shared/ppt-master.ts first.`
    )
  }

  await rm(PAYLOAD_DIR, { recursive: true, force: true })
  await mkdir(PAYLOAD_DIR, { recursive: true })
  await cp(source, PAYLOAD_DIR, { recursive: true, preserveTimestamps: true })

  for (const relative of REQUIRED_FILES) {
    if (!(await exists(join(PAYLOAD_DIR, relative)))) fail(`staged payload is missing ${relative}`)
  }

  // Run the skill's own gate against the staged copy: if it fails here, every
  // user's first activation would fail the same way.
  const guard = spawnSync('python3', ['scripts/attribution_guard.py'], {
    cwd: PAYLOAD_DIR,
    encoding: 'utf8'
  })
  if (guard.error && guard.error.code === 'ENOENT') {
    console.warn('warning: python3 not found — skipping the attribution guard check')
  } else if (guard.status !== 0) {
    fail(`attribution guard failed on the staged payload:\n${guard.stderr || guard.stdout}`)
  } else {
    console.log('attribution guard: ok')
  }

  console.log(`\nStaged into ${PAYLOAD_DIR}`)
  console.log('Next: `cd packages/ppt-master-skill && npm pack` to check size, then `npm publish`.')
}

async function resolveSkillDir(root) {
  const candidates = [root, join(root, 'ppt-master'), join(root, 'skills', 'ppt-master')]
  for (const candidate of candidates) {
    if (await exists(join(candidate, 'SKILL.md'))) return candidate
  }
  fail(`no SKILL.md found under any of:\n  ${candidates.join('\n  ')}`)
}

async function readSkillVersion(dir) {
  const text = await readFile(join(dir, 'SKILL.md'), 'utf8')
  return /^\s*version:\s*["']?([\w.+-]+)["']?\s*$/m.exec(text)?.[1]
}

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

await main()

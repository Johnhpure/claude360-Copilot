export function isKunHealthResponseBody(body: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object') return false
  const record = parsed as Record<string, unknown>
  return record.status === 'ok' && record.service === 'kun' && record.mode === 'serve'
}

/**
 * spawn 前健康预探测的超时决策（07-19-startup-perf-optimization P2）。
 *
 * 预探测的意义是复用「外部手动启动的 kun」或「上一实例遗留的健康 kun」。
 * 冷启动（本会话从未 spawn 过子进程且当前无子进程）时端口大概率是死的，
 * 2s 全额等待纯属浪费——缩到 200ms（localhost 连接拒绝毫秒级返回，
 * waitForKunHealth 内部 150ms 间隔重试，200ms 足够 1–2 轮，仍能兜住
 * 用户手动 `kun serve` 的场景）。非冷启动（重启 / hung 恢复 / 二次
 * ensure）保持原 2s，行为不变。
 */
export function resolvePreSpawnProbeTimeoutMs(input: {
  everSpawned: boolean
  childRunning: boolean
}): number {
  return input.everSpawned || input.childRunning ? 2_000 : 200
}

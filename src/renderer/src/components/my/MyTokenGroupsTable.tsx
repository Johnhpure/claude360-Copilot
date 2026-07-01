import type { ReactElement } from 'react'
import { KeyRound, Eye, Copy, Loader2, Plus } from 'lucide-react'
import type { Claude360TokenListItem } from '@shared/claude360'

type Translate = (key: string, params?: Record<string, unknown>) => string

// API Key 分组表。
// 安全约束(codex plan-03 Task 6 设计要求):
//   - 明文 Key 默认不显示,列表只展示脱敏 maskedKey;
//   - reveal 必须是显式点击(onReveal 回调),reveal 后的明文由 revealed 传入;
//   - 复制走 onCopy 回调。
export function MyTokenGroupsTable({
  tokens,
  revealed,
  creating,
  onReveal,
  onCopy,
  onCreate,
  t
}: {
  tokens: Claude360TokenListItem[]
  /** tokenId -> 已 reveal 的明文 Key。未在其中的一律脱敏展示。 */
  revealed: Record<number, string>
  creating: boolean
  onReveal: (tokenId: number) => void
  onCopy: (value: string) => void
  onCreate: () => void
  t: Translate
}): ReactElement {
  return (
    <div className="rounded-2xl border border-ds-border bg-ds-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink">
          <KeyRound className="h-4 w-4" strokeWidth={1.75} />
          {t('myApiKeys')}
        </h2>
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-main px-3 py-1.5 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          {creating ? t('myCreatingKey') : t('myCreateKey')}
        </button>
      </div>

      {tokens.length === 0 ? (
        <p className="mt-4 text-[13px] text-ds-faint">{t('myNoApiKeys')}</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-ds-border">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="bg-ds-main text-[11.5px] uppercase tracking-wide text-ds-faint">
              <tr>
                <th className="px-3 py-2 font-medium">{t('myKeyName')}</th>
                <th className="px-3 py-2 font-medium">{t('myKeyGroup')}</th>
                <th className="px-3 py-2 font-medium">{t('myKeyValue')}</th>
                <th className="px-3 py-2 font-medium">{t('myKeyQuota')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('myKeyActions')}</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => {
                const plain = revealed[token.id]
                const isRevealed = typeof plain === 'string' && plain.length > 0
                return (
                  <tr key={token.id} className="border-t border-ds-border-muted">
                    <td className="px-3 py-2 text-ds-ink">{token.name}</td>
                    <td className="px-3 py-2 text-ds-muted">{token.group || 'default'}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-ds-muted">
                      {isRevealed ? plain : token.maskedKey}
                    </td>
                    <td className="px-3 py-2 text-ds-muted">
                      {token.unlimitedQuota ? t('myKeyUnlimited') : token.remainQuota.toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          aria-label={t('myRevealKey')}
                          title={t('myRevealKey')}
                          onClick={() => onReveal(token.id)}
                          className="rounded-md border border-ds-border px-2 py-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                        >
                          <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                        {isRevealed ? (
                          <button
                            type="button"
                            aria-label={t('myCopyKey')}
                            title={t('myCopyKey')}
                            onClick={() => onCopy(plain)}
                            className="rounded-md border border-ds-border px-2 py-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                          >
                            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

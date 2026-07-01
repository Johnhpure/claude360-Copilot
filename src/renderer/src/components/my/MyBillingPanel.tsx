import type { ReactElement } from 'react'
import { CreditCard, QrCode, Loader2, CheckCircle2 } from 'lucide-react'
import type { Claude360TopupOptions, Claude360TopupOrder } from '@shared/claude360'

type Translate = (key: string, params?: Record<string, unknown>) => string

export type BillingPollPhase = 'idle' | 'pending' | 'completed'

// 充值面板:金额 options、微信充值二维码、订单轮询状态。
// 纯展示:选中金额 / 当前订单 / 轮询状态由容器通过 props 注入。
export function MyBillingPanel({
  options,
  selectedAmount,
  order,
  pollPhase,
  submitting,
  onSelectAmount,
  onCreateWechatTopup,
  t
}: {
  options: Claude360TopupOptions | null
  selectedAmount: number | null
  order: Claude360TopupOrder | null
  pollPhase: BillingPollPhase
  submitting: boolean
  onSelectAmount: (amount: number) => void
  onCreateWechatTopup: () => void
  t: Translate
}): ReactElement {
  return (
    <div className="rounded-2xl border border-ds-border bg-ds-card p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink">
        <CreditCard className="h-4 w-4" strokeWidth={1.75} />
        {t('myTopup')}
      </h2>

      {!options ? (
        <p className="mt-4 text-[13px] text-ds-faint">{t('myLoading')}</p>
      ) : (
        <>
          <p className="mt-2 text-[12.5px] text-ds-faint">
            {t('myMinTopup')}: {options.minTopup}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {options.amountOptions.map((amount) => {
              const active = amount === selectedAmount
              return (
                <button
                  key={amount}
                  type="button"
                  onClick={() => onSelectAmount(amount)}
                  className={`rounded-lg border px-3.5 py-2 text-[13px] font-medium shadow-sm transition ${
                    active
                      ? 'border-accent/50 bg-accent/10 text-ds-ink'
                      : 'border-ds-border bg-ds-main text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`}
                >
                  ¥{amount}
                </button>
              )
            })}
          </div>

          {options.wechatEnabled ? (
            <button
              type="button"
              onClick={onCreateWechatTopup}
              disabled={submitting || selectedAmount == null}
              className="mt-4 flex items-center gap-2 rounded-lg bg-ds-userbubble px-4 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <QrCode className="h-4 w-4" strokeWidth={1.75} />
              {submitting ? t('myCreatingOrder') : t('myWechatTopup')}
            </button>
          ) : (
            <p className="mt-4 text-[12.5px] text-ds-faint">{t('myWechatDisabled')}</p>
          )}

          {order ? (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-ds-border bg-ds-main p-4">
              <span className="text-[12.5px] font-medium text-ds-ink">
                {t('myScanToPay')} · {order.moneyDisplay}
              </span>
              <img
                src={order.codeUrl}
                alt={t('myWechatQr')}
                className="h-40 w-40 rounded-md border border-ds-border bg-white object-contain"
              />
              {pollPhase === 'pending' ? (
                <span className="flex items-center gap-1.5 text-[12px] text-ds-faint">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                  {t('myWaitingPayment')}
                </span>
              ) : null}
              {pollPhase === 'completed' ? (
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t('myPaymentComplete')}
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

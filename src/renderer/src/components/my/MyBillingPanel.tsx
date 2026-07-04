import type { ReactElement } from 'react'
import { CreditCard, QrCode, Loader2, CheckCircle2 } from 'lucide-react'
import type { Claude360TopupOptions, Claude360TopupOrder } from '@shared/claude360'
import { Button, Card } from '../ui'

type Translate = (key: string, params?: Record<string, unknown>) => string

export type BillingPollPhase = 'idle' | 'pending' | 'completed'

// 充值面板:金额 options、微信充值二维码、订单轮询状态。
// 纯展示:选中金额 / 当前订单 / 轮询状态由容器通过 props 注入。
// Calm Blue 换肤（父任务 07-03-oneui-redesign design §4.7）：卡 = ui/Card focus block；
// 金额选择 = 胶囊 chip（选中 accent-soft 底 + 蓝字，规避 bg-accent/10 静默失效陷阱）；
// 微信支付 = ui/Button primary（loading 态内置转圈）。
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
    <Card>
      <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink">
        <CreditCard className="h-4 w-4" strokeWidth={1.75} aria-hidden />
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
                  aria-pressed={active}
                  onClick={() => onSelectAmount(amount)}
                  className={`rounded-[var(--radius-pill)] border px-3.5 py-2 text-[13px] font-medium transition-colors duration-[var(--motion-fast)] ${
                    active
                      ? 'border-[color-mix(in_srgb,var(--ds-accent)_45%,transparent)] bg-accent-soft text-accent'
                      : 'border-ds-border bg-ds-main text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`}
                >
                  ¥{amount}
                </button>
              )
            })}
          </div>

          {options.wechatEnabled ? (
            <Button
              className="mt-4"
              onClick={onCreateWechatTopup}
              disabled={selectedAmount == null}
              loading={submitting}
            >
              {submitting ? null : <QrCode className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
              {submitting ? t('myCreatingOrder') : t('myWechatTopup')}
            </Button>
          ) : (
            <p className="mt-4 text-[12.5px] text-ds-faint">{t('myWechatDisabled')}</p>
          )}

          {order ? (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-ds-border bg-ds-main p-4">
              <span className="text-[12.5px] font-medium text-ds-ink">
                {t('myScanToPay')} · {order.moneyDisplay}
              </span>
              {/* 二维码必须白底才可靠扫码:bg-white 为内容约束色,不随主题反转。 */}
              <img
                src={order.codeUrl}
                alt={t('myWechatQr')}
                className="h-40 w-40 rounded-[var(--radius-sm)] border border-ds-border bg-white object-contain"
              />
              {pollPhase === 'pending' ? (
                <span className="flex items-center gap-1.5 text-[12px] text-ds-faint">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
                  {t('myWaitingPayment')}
                </span>
              ) : null}
              {pollPhase === 'completed' ? (
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-ds-success">
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  {t('myPaymentComplete')}
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Card>
  )
}

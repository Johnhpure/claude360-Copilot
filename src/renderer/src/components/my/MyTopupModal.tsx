import { useState } from 'react'
import type { ReactElement } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { CheckCircle2, Clock, Loader2, QrCode, X, XCircle } from 'lucide-react'
import type { Claude360TopupOptions, Claude360TopupOrder } from '@shared/claude360'
import { Button, Modal } from '../ui'
import { classifyQrPayload, type BillingPollPhase, type QrPayload } from './my-page-actions'

type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * 充值弹窗（07-07-my-page-redesign-topup-modal design §3）。
 *
 * 两层导出:
 * - MyTopupModalContent:纯展示。ui/Modal 走 createPortal,node 环境
 *   renderToStaticMarkup 渲染不到 portal 内容,单测直接渲染本组件。
 * - MyTopupModal:ui/Modal 壳(遮罩/Esc/焦点) + Content,容器组合用。
 *
 * 视图由 order + pollPhase + submitting 推导,无独立状态机:
 *   [order=null]                  → 金额选择 chips + 「微信充值」按钮
 *   [order!=null, pending]        → 支付金额 + 二维码 + 等待支付 spinner
 *   [order!=null, completed]      → 成功图标 + 「完成」按钮(关闭)
 *   [order!=null, failed/expired] → 失败/超时提示 + 「重新生成二维码」按钮
 */
export type MyTopupModalContentProps = {
  options: Claude360TopupOptions | null
  selectedAmount: number | null
  order: Claude360TopupOrder | null
  pollPhase: BillingPollPhase
  submitting: boolean
  /** 充值过程错误(创建订单/轮询请求失败),只在弹窗内展示,与全页加载错误分离。 */
  error: string | null
  onSelectAmount: (amount: number) => void
  onCreateWechatTopup: () => void
  /** 失败/超时后回金额选择视图重新下单(金额保留,不自动重建订单)。 */
  onRegenerate: () => void
  /** 关闭弹窗(头部 X / 支付成功后的「完成」)。 */
  onClose: () => void
  t: Translate
}

export function MyTopupModalContent({
  options,
  selectedAmount,
  order,
  pollPhase,
  submitting,
  error,
  onSelectAmount,
  onCreateWechatTopup,
  onRegenerate,
  onClose,
  t
}: MyTopupModalContentProps): ReactElement {
  // codeUrl 防御:order 存在但 codeUrl 为空(接口异常)时显式报错并打日志,禁止空白占位。
  const qrPayload = order ? classifyQrPayload(order.codeUrl) : null
  if (order && qrPayload?.kind === 'empty') {
    console.error('[topup] empty codeUrl', order)
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[16px] font-semibold text-ds-ink">{t('myTopupModalTitle')}</h2>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t('close')}
          title={t('close')}
        >
          <X className="h-4 w-4" strokeWidth={1.7} aria-hidden />
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--ds-danger)_35%,transparent)] bg-ds-danger-soft px-3 py-2 text-[12.5px] text-ds-danger">
          {error}
        </p>
      ) : null}

      {order && qrPayload ? (
        <TopupOrderView
          order={order}
          qrPayload={qrPayload}
          pollPhase={pollPhase}
          onRegenerate={onRegenerate}
          onClose={onClose}
          t={t}
        />
      ) : (
        <TopupAmountView
          options={options}
          selectedAmount={selectedAmount}
          submitting={submitting}
          onSelectAmount={onSelectAmount}
          onCreateWechatTopup={onCreateWechatTopup}
          t={t}
        />
      )}
    </div>
  )
}

/** 金额选择视图:接口下发的档位 chips(不前端写死)+ 微信充值按钮。 */
function TopupAmountView({
  options,
  selectedAmount,
  submitting,
  onSelectAmount,
  onCreateWechatTopup,
  t
}: {
  options: Claude360TopupOptions | null
  selectedAmount: number | null
  submitting: boolean
  onSelectAmount: (amount: number) => void
  onCreateWechatTopup: () => void
  t: Translate
}): ReactElement {
  if (!options) {
    return <p className="mt-4 text-[13px] text-ds-faint">{t('myLoading')}</p>
  }
  return (
    <div>
      <p className="mt-3 text-[12.5px] text-ds-faint">
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
          className="mt-4 w-full"
          onClick={onCreateWechatTopup}
          disabled={selectedAmount == null}
          loading={submitting}
          data-testid="my-topup-wechat"
        >
          {submitting ? null : <QrCode className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
          {submitting ? t('myCreatingOrder') : t('myWechatTopup')}
        </Button>
      ) : (
        <p className="mt-4 text-[12.5px] text-ds-faint">{t('myWechatDisabled')}</p>
      )}
    </div>
  )
}

/** 订单视图:二维码 + 支付状态;终态(成功/失败/超时)切换为结果面板。 */
function TopupOrderView({
  order,
  qrPayload,
  pollPhase,
  onRegenerate,
  onClose,
  t
}: {
  order: Claude360TopupOrder
  qrPayload: QrPayload
  pollPhase: BillingPollPhase
  onRegenerate: () => void
  onClose: () => void
  t: Translate
}): ReactElement {
  if (pollPhase === 'completed') {
    return (
      <div className="mt-4 flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle2 className="h-10 w-10 text-ds-success" strokeWidth={1.5} aria-hidden />
        <p className="text-[13.5px] font-medium text-ds-success">{t('myPaymentComplete')}</p>
        <Button className="mt-1 min-w-28" onClick={onClose} data-testid="my-topup-done">
          {t('myDone')}
        </Button>
      </div>
    )
  }
  if (pollPhase === 'failed' || pollPhase === 'expired') {
    return (
      <div className="mt-4 flex flex-col items-center gap-3 py-4 text-center">
        {pollPhase === 'failed' ? (
          <XCircle className="h-10 w-10 text-ds-danger" strokeWidth={1.5} aria-hidden />
        ) : (
          <Clock className="h-10 w-10 text-ds-warning" strokeWidth={1.5} aria-hidden />
        )}
        <p className="text-[13px] text-ds-muted">
          {pollPhase === 'failed' ? t('myOrderStatusFailed') : t('myTopupTimeout')}
        </p>
        <Button variant="secondary" className="mt-1" onClick={onRegenerate} data-testid="my-topup-regenerate">
          {t('myRegenerateQr')}
        </Button>
      </div>
    )
  }
  return (
    <div className="mt-4 flex flex-col items-center gap-3">
      <span className="text-[13px] font-medium text-ds-ink">
        {t('myScanToPay')} · {order.moneyDisplay}
      </span>
      {/* key=orderId:换单后重置 img 失败态(useState 随组件重建归零)。 */}
      <TopupQr key={order.orderId} payload={qrPayload} t={t} />
      {pollPhase === 'pending' ? (
        <span className="flex items-center gap-1.5 text-[12px] text-ds-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden />
          {t('myWaitingPayment')}
        </span>
      ) : null}
    </div>
  )
}

/**
 * 二维码渲染(R4,分类逻辑在 classifyQrPayload 纯函数):
 * encode → QRCodeSVG 前端编码(weixin:// 支付链接不能当 img src,恒空白);
 * image  → <img> 200×200,onError 兜底错误文案,不留空白;
 * empty  → 显式错误文案(console.error 由父组件带完整 order 打点)。
 * 白底 p-3 为 quiet zone:bg-white 是内容约束色,不随主题反转,保证扫码可靠。
 */
function TopupQr({ payload, t }: { payload: QrPayload; t: Translate }): ReactElement {
  const [imgFailed, setImgFailed] = useState(false)
  if (payload.kind === 'empty') {
    return <span className="text-[12.5px] text-ds-danger">{t('myQrError')}</span>
  }
  if (payload.kind === 'image' && imgFailed) {
    return <span className="text-[12.5px] text-ds-danger">{t('myQrImageError')}</span>
  }
  return (
    <div className="shrink-0 rounded-[var(--radius-sm)] border border-ds-border bg-white p-3">
      {payload.kind === 'encode' ? (
        <QRCodeSVG value={payload.value} size={200} role="img" aria-label={t('myWechatQr')} />
      ) : (
        /* 固定 200×200,不让 CSS 压缩成不可扫的色块。 */
        <img
          src={payload.src}
          width={200}
          height={200}
          className="block h-[200px] w-[200px]"
          alt={t('myWechatQr')}
          onError={() => setImgFailed(true)}
        />
      )}
    </div>
  )
}

export type MyTopupModalProps = MyTopupModalContentProps & { open: boolean }

/** ui/Modal 壳 + Content:遮罩模糊/Esc/焦点管理由 Modal 统一提供。 */
export function MyTopupModal({ open, ...content }: MyTopupModalProps): ReactElement {
  return (
    <Modal
      open={open}
      onClose={content.onClose}
      ariaLabel={content.t('myTopupModalTitle')}
      size="sm"
      // 仅创建订单请求进行中防误关;等待支付期间允许 Esc/遮罩关闭(用户可能放弃支付)。
      dismissable={!content.submitting}
    >
      <MyTopupModalContent {...content} />
    </Modal>
  )
}

import { useState } from 'react';
import { useUploadStore } from '../store/useUploadStore';
import { SectionHeader } from './SectionHeader';
import { SponsorList } from './SponsorList';

export function PaymentPanel() {
  const palette = useUploadStore((s) => s.palette);
  const [sponsorListOpen, setSponsorListOpen] = useState(false);
  const [qrPinned, setQrPinned] = useState(false);

  return (
    <section className="glass p-6" style={{ borderColor: 'color-mix(in srgb, var(--zzz-primary) 32%, transparent)' }}>
      <SectionHeader
        title="支持影画工坊"
        action={
          <button
            type="button"
            onClick={() => setSponsorListOpen(true)}
            className="glass-btn px-3 py-1.5 font-mono text-xs text-zzz-text"
          >
            赞助名单
          </button>
        }
      />
      <p className="mb-4 font-mono text-xs leading-relaxed text-zzz-text/55">
        赞助用于维护模型额度与创作工具，不影响现有免费功能。请使用支付宝扫码支持。
      </p>

      <div className="group relative inline-flex" onMouseLeave={() => setQrPinned(false)}>
        <button
          type="button"
          aria-controls="personal-alipay-qr"
          aria-expanded={qrPinned}
          onBlur={() => setQrPinned(false)}
          onFocus={() => setQrPinned(true)}
          onClick={() => setQrPinned((pinned) => !pinned)}
          className="glass-btn px-5 py-2.5 font-mono text-xs text-zzz-text transition-colors"
          style={{ borderColor: 'color-mix(in srgb, var(--zzz-primary) 55%, transparent)', boxShadow: '0 0 18px color-mix(in srgb, var(--zzz-primary) 20%, transparent)' }}
        >
          扫码赞助 →
        </button>
        <div
          id="personal-alipay-qr"
          role="tooltip"
          className={`absolute bottom-full left-1/2 z-20 mb-3 w-64 max-w-[calc(100vw-3rem)] -translate-x-1/2 rounded-xl border border-zzz-primary/45 bg-[#0d0a14] p-3 shadow-2xl transition ${qrPinned ? 'visible opacity-100' : 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100'}`}
        >
          <img
            src="/alipay-sponsor-qr.jpg"
            alt="支付宝个人收款二维码，扫码支持影画工坊"
            className="aspect-[9/16] w-full rounded-lg bg-white object-contain"
          />
          <p className="mt-2 text-center font-mono text-[11px] leading-relaxed text-zzz-text/60">
            使用支付宝扫描二维码支持影画工坊
          </p>
        </div>
      </div>
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-zzz-text/40">
        个人收款暂不自动登记至赞助名单，感谢你的理解与支持。
      </p>

      {palette && <span className="sr-only">赞助卡片已跟随当前立绘主题色</span>}
      <SponsorList open={sponsorListOpen} onClose={() => setSponsorListOpen(false)} />
    </section>
  );
}

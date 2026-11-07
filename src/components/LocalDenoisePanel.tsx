import { useEffect, useRef, useState } from 'react';
import { DENOISE_STRENGTHS, type DenoiseStrength, type DenoiseWorkerResponse } from '../lib/localDenoise';
import { validateImageFile } from '../lib/validation';
import '../styles/local-denoise.css';

type Phase = 'empty' | 'preparing' | 'ready' | 'running' | 'done' | 'cancelled' | 'error';
interface Picture { url: string; width: number; height: number; name: string }
interface Result { url: string; strength: DenoiseStrength; elapsedMs: number }

/** Standalone local pixel processing; does not use generation credentials or prompts. */
export function LocalDenoisePanel() {
  const [source, setSource] = useState<Picture | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [strength, setStrength] = useState<DenoiseStrength>('medium');
  const [phase, setPhase] = useState<Phase>('empty');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [actualSize, setActualSize] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const sourceRef = useRef<Picture | null>(null);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = phase === 'preparing' || phase === 'running';

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null; }, []);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  function prepare(file: File, runStrength?: DenoiseStrength) {
    workerRef.current?.terminate();
    workerRef.current = null;
    setError(''); setProgress(0); setPhase('preparing');
    try {
      const worker = new Worker(new URL('../workers/denoiseWorker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      const fail = (message: string) => {
        if (workerRef.current !== worker) return;
        worker.terminate(); workerRef.current = null;
        setError(message); setPhase('error');
      };
      worker.onerror = () => fail('后台处理未能启动或意外中断，请重新选择图片或更新浏览器。');
      worker.onmessage = (event: MessageEvent<DenoiseWorkerResponse>) => {
        // A replaced upload, cancelled job or unmounted panel cannot publish results.
        if (workerRef.current !== worker) return;
        const message = event.data;
        if (message.type === 'ready') {
          if (!sourceRef.current) {
            const picture = { url: URL.createObjectURL(file), name: file.name, width: message.width, height: message.height };
            sourceRef.current = picture; setSource(picture);
          }
          if (runStrength) { setPhase('running'); worker.postMessage({ type: 'run', strength: runStrength }); }
          else setPhase('ready');
        } else if (message.type === 'progress') setProgress(message.percent);
        else if (message.type === 'result') {
          setResult({ url: URL.createObjectURL(message.blob), strength: message.strength, elapsedMs: message.elapsedMs });
          setPhase('done'); setProgress(100);
        } else fail(message.message);
      };
      worker.postMessage({ type: 'prepare', file });
    } catch {
      workerRef.current?.terminate(); workerRef.current = null;
      setError('无法启动后台图片处理，请使用支持 Web Worker 的新版浏览器。'); setPhase('error');
    }
  }

  function selectFile(file: File) {
    const check = validateImageFile(file);
    if (!check.ok) { setError(check.message ?? '文件校验失败。'); return; }
    // Revoke the previous image via the effects above; processing always starts from this file.
    fileRef.current = file; sourceRef.current = null; setSource(null); setResult(null); setActualSize(false);
    prepare(file);
  }

  function run() {
    const file = fileRef.current;
    if (!file || busy) return;
    setResult(null); setError(''); setProgress(0);
    if (workerRef.current) { setPhase('running'); workerRef.current.postMessage({ type: 'run', strength }); }
    else prepare(file, strength);
  }

  function cancel() {
    workerRef.current?.terminate(); workerRef.current = null;
    setPhase('cancelled'); setProgress(0);
  }

  const appliedLabel = DENOISE_STRENGTHS.find((option) => option.value === result?.strength)?.label;
  return <section className="local-denoise" aria-labelledby="local-denoise-title">
    <header className="local-denoise-heading">
      <div><div className="studio-eyebrow"><span />LOCAL IMAGE LAB</div><h1 id="local-denoise-title">图片降噪<span>，留住细节。</span></h1>
        <p>压低平涂色块内的鱼鳞状细纹、颗粒与杂色，保留线稿和色块边界。所有像素运算均在浏览器本地完成。</p></div>
      <span className="local-denoise-badge">本地处理 / 无需上传服务器</span>
    </header>
    <div className="local-denoise-layout">
      <aside className="local-denoise-controls" aria-label="降噪设置">
        <span className="local-denoise-step">01 / 选择原图</span>
        <button type="button" className="local-denoise-upload" onClick={() => inputRef.current?.click()}>
          <span aria-hidden="true">＋</span><strong>{source ? '更换图片' : '选择一张图片'}</strong><small>PNG / JPEG / WebP · 10 MB 以内</small>
        </button>
        <input ref={inputRef} type="file" className="local-denoise-file" aria-label="选择待降噪图片" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) selectFile(file); }} />
        <p className="local-denoise-help">保留原图尺寸与透明度。最多 400 万像素，单边不超过 8192 像素；不自动缩图。</p>
        <fieldset disabled={busy}><legend className="local-denoise-step">02 / 调整强度</legend>
          {DENOISE_STRENGTHS.map((option) => <label key={option.value} className={`local-denoise-option ${strength === option.value ? 'is-selected' : ''}`}>
            <input type="radio" name="local-denoise-strength" value={option.value} checked={strength === option.value} onChange={() => setStrength(option.value)} />
            <span><strong>{option.label}</strong><small>{option.hint}</small></span>
          </label>)}
        </fieldset>
        <button type="button" className="studio-action studio-action-primary local-denoise-run" disabled={!fileRef.current || busy || (!source && phase === 'error')} onClick={run}>{busy ? (phase === 'preparing' ? '正在读取图片…' : '正在降噪…') : result ? '重新处理原图' : '开始本地降噪'}<span aria-hidden="true">↗</span></button>
        {busy && <><progress className="local-denoise-progress" aria-label={phase === 'preparing' ? '读取图片' : '降噪进度'} max={100} value={phase === 'preparing' ? undefined : progress} /><button type="button" className="local-denoise-cancel" onClick={cancel}>取消处理</button></>}
        <div className="local-denoise-status" role="status" aria-live="polite">{phase === 'cancelled' ? '已取消，可重新开始。' : phase === 'preparing' ? '正在本地解码并检查尺寸…' : phase === 'running' ? (progress === 100 ? '正在导出 PNG…' : `正在处理像素 ${progress}%`) : result ? `${appliedLabel}降噪完成 · ${(result.elapsedMs / 1000).toFixed(1)} 秒` : source ? `${source.width} × ${source.height} · 已就绪` : '选择图片，开始比较。'}</div>
        {error && <p className="local-denoise-error" role="alert">{error}</p>}
      </aside>
      <div className="local-denoise-workspace">
        <div className="local-denoise-preview-bar"><span>03 / 对比结果</span><label><input type="checkbox" checked={actualSize} disabled={!source} onChange={(event) => setActualSize(event.target.checked)} />100% 像素查看</label></div>
        <div className={`local-denoise-comparison ${actualSize ? 'is-actual' : ''}`}>
          <figure><figcaption><strong>原图</strong><span>{source ? `${source.width} × ${source.height}` : 'BEFORE'}</span></figcaption><div className="local-denoise-image">{source ? <img src={source.url} alt="降噪前的原图" /> : <div className="local-denoise-empty"><span aria-hidden="true">◌</span><p>让杂点退场，<br />让画面更纯净。</p></div>}</div></figure>
          <figure><figcaption><strong>处理后</strong><span>{result ? `${appliedLabel}降噪` : 'AFTER'}</span></figcaption><div className="local-denoise-image">{result ? <img src={result.url} alt={`${appliedLabel}降噪后的图片`} /> : <div className="local-denoise-empty"><span aria-hidden="true">✧</span><p>{busy ? '正在准备你的画面…' : '处理完成后，在这里对比。'}</p></div>}</div></figure>
        </div>
        {result && source && <div className="local-denoise-download"><p>结果始终由原图计算，反复调整不会叠加处理。</p><a className="studio-action studio-action-secondary" href={result.url} download={`${source.name.replace(/\.[^.]+$/, '')}-降噪-${result.strength}.png`}>下载 PNG <span aria-hidden="true">↓</span></a></div>}
        <details className="local-denoise-notes"><summary>它适合处理什么？</summary><p>使用 L0 梯度平滑处理二次元、番剧画风和平涂插画中的细密鱼鳞纹。较强随机颗粒会先经过亮度与色度联合保边预处理。轻度、标准、较强的 L0 强度分别为 0.0005、0.001、0.002。较强档可能削弱腮红、柔和渐变与刻意纹理，可用 100% 像素查看比较后保存。</p><p>本站采用分块 FFT 和有限迭代控制浏览器内存，分块边缘平滑衔接，透明交界附近优先保留原像素。大图处理可能需要数十秒，可随时取消。结果保留原尺寸和透明度，输出为浏览器解码后的静态 PNG，原始 EXIF、ICC 与动画需要另行保留。</p><p>这项本地数学处理的生成额度消耗为零。算法参考 <a href="https://github.com/CXP-2024/gpt-anime-denoise" target="_blank" rel="noopener noreferrer">gpt-anime-denoise 的 L0 梯度平滑 ↗</a></p></details>
      </div>
    </div>
  </section>;
}

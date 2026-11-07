import { useEffect, useRef, useState } from 'react';
import { useProviderStore } from '../store/useProviderStore';
import { useToast } from '../store/useToast';
import { validateImageFile } from '../lib/validation';
import { formatImagePrompt, PROMPT_TARGETS, reverseImagePrompt, type ImagePromptResponse, type PromptTarget } from '../lib/imageToPrompt';
import '../styles/image-to-prompt.css';

const OUTPUTS = [
  { key: 'promptZh', label: '中文 Prompt' }, { key: 'promptEn', label: 'English Prompt' },
  { key: 'editablePrompt', label: '可复用模板' }, { key: 'negativePrompt', label: 'Negative Prompt' },
] as const;

export function ImageToPromptPanel() {
  const [source, setSource] = useState<{ file: File; url: string } | null>(null);
  const [target, setTarget] = useState<PromptTarget>('general');
  const [focus, setFocus] = useState('');
  const [output, setOutput] = useState<ImagePromptResponse | null>(null);
  const [activeOutput, setActiveOutput] = useState<typeof OUTPUTS[number]['key']>('promptZh');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const outputText = useRef<HTMLTextAreaElement>(null);
  const request = useRef(0);
  const flight = useRef<AbortController | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  const useServerPreset = useProviderStore((s) => s.freeloadEnabled);
  const visionCred = useProviderStore((s) => s.visionCred);
  const notify = useToast((s) => s.show);
  const configured = useServerPreset || Boolean(visionCred.apiKey.trim() && visionCred.baseUrl.trim() && visionCred.model.trim());

  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);
  useEffect(() => () => { ++request.current; flight.current?.abort(); clearTimeout(copyTimer.current); }, []);
  const resetRequest = () => { ++request.current; flight.current?.abort(); flight.current = null; setBusy(false); setCopied(false); };
  const selectFile = (file?: File) => {
    if (!file) return;
    const check = validateImageFile(file);
    if (!check.ok || !file.size) { setError(check.message || '图片内容为空，请重新选择'); return; }
    resetRequest(); setError(''); setOutput(null); setActiveOutput('promptZh');
    setSource({ file, url: URL.createObjectURL(file) });
  };
  const run = async () => {
    if (!source || busy) return;
    if (!configured) { setError('请先打开右上角「设置」，填写视觉模型的 API Key、Base URL 和模型名称；也可以开启作者免费通道。'); return; }
    resetRequest();
    const id = request.current;
    const controller = new AbortController(); flight.current = controller;
    setBusy(true); setError(''); setOutput(null); setActiveOutput('promptZh');
    try {
      const result = await reverseImagePrompt(source.file, { target, focus, useServerPreset, ...(!useServerPreset ? visionCred : {}) }, controller.signal);
      if (id === request.current) setOutput(result);
    } catch (reason) {
      if (id === request.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : '图片反推失败，请重试');
    } finally {
      if (id === request.current) { setBusy(false); flight.current = null; }
    }
  };
  const copy = async (all = false) => {
    if (!output) return;
    const text = all ? formatImagePrompt(output.result) : output.result[activeOutput];
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(text);
      setCopied(true); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      outputText.current?.focus(); outputText.current?.select();
      notify('自动复制不可用，已选中当前提示词，请手动复制');
    }
  };

  return <div className="image-prompt-page">
    <header className="image-prompt-heading">
      <div><p className="studio-eyebrow">IMAGE → PROMPT</p><h1>看见画面，<br />写出它的<span>提示词。</span></h1></div>
      <p>提炼参考图的整体画风、构图、光线与质感，生成可替换主体的复刻模板。<br />三视图会保留视角、比例与版面结构，提供可直接复制的中英文版本。</p>
    </header>
    <div className="image-prompt-workbench">
      <section className="image-prompt-source" aria-label="参考图片与反推设置">
        <div className="image-prompt-section-label"><span>参考画面</span><span aria-hidden="true">↘</span></div>
        <button type="button" className={`image-prompt-upload${source ? ' has-image' : ''}`} onClick={() => input.current?.click()}
          onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFile(event.dataTransfer.files[0]); }}
          aria-label={source ? '更换参考图片' : '上传参考图片'}>
          {source ? <><img src={source.url} alt="用于反推提示词的参考图片" /><span className="image-prompt-replace">更换图片 ↗</span></>
            : <span className="image-prompt-upload-empty"><span aria-hidden="true">＋</span><strong>放入一张参考图</strong><small>拖放到这里，或点击上传<br />PNG / JPEG / WebP · 最大 10 MB</small></span>}
        </button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ''; }} />
        {source && <p className="image-prompt-filename">{source.file.name}</p>}
        <label className="image-prompt-field">用于哪种生图工具<select value={target} disabled={busy} onChange={(event) => { setTarget(event.target.value as PromptTarget); setOutput(null); }}>
          {PROMPT_TARGETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select></label>
        <label className="image-prompt-field">特别想保留什么 <span>可选</span><textarea value={focus} maxLength={500} disabled={busy} onChange={(event) => setFocus(event.target.value)} rows={3} placeholder="默认提炼整体画风与结构。如需保留原角色的发型、服装或其他特征，请在这里说明" /></label>
        <p className="image-prompt-connection">{useServerPreset ? '当前使用作者视觉模型通道' : '使用「设置」中的视觉模型'}{!configured && ' · 尚未配置'}</p>
        <button type="button" className="studio-action studio-action-primary image-prompt-submit" disabled={!source || busy} onClick={() => void run()}>{busy ? '正在观察画面…' : output ? '重新反推提示词' : '反推提示词'}<span aria-hidden="true">↗</span></button>
        {busy && <button type="button" className="studio-text-link" onClick={resetRequest}>停止等待</button>}
        <p className="image-prompt-disclosure">点击反推后，图片会发送至所选视觉模型进行分析，不会保存到公共画廊。</p>
      </section>
      <section className="image-prompt-output" aria-label="反推结果" aria-busy={busy}>
        <div className="image-prompt-section-label"><span>复刻用的文字</span><span aria-hidden="true">↗</span></div>
        {error && <div className="image-prompt-error" role="alert">{error}</div>}
        {busy ? <div className="image-prompt-empty" role="status"><span className="image-prompt-observing" aria-hidden="true">◎</span><h2>正在把画面，整理成文字。</h2><p>辨认主体与构图，梳理光线、色彩和质感。<br />完成后，中英文提示词会出现在这里。</p></div>
          : output ? <>
            <p className="image-prompt-summary">{output.result.summary}</p>
            <div className="image-prompt-output-controls"><div className="image-prompt-tabs" role="group" aria-label="提示词版本">{OUTPUTS.filter((item) => item.key !== 'negativePrompt' || output.result.negativePrompt).map((item) => <button type="button" key={item.key} aria-pressed={activeOutput === item.key} onClick={() => { setActiveOutput(item.key); setCopied(false); }}>{item.label}</button>)}</div>
              <span className="image-prompt-ratio">{output.image.aspectRatio}</span></div>
            <textarea ref={outputText} className="image-prompt-result-text" aria-label={OUTPUTS.find((item) => item.key === activeOutput)!.label} value={output.result[activeOutput]} readOnly spellCheck={false} />
            {activeOutput === 'editablePrompt' && <p className="image-prompt-hint">复制后替换【括号中的内容】，就能保留画面结构、尝试新的主体或场景。</p>}
            <div className="image-prompt-copy-actions"><button type="button" className="studio-action studio-action-primary" onClick={() => void copy()}>{copied ? '已复制 ✓' : '复制当前提示词'}</button><button type="button" className="studio-text-link" onClick={() => void copy(true)}>复制全部版本 ↗</button><span role="status" className="sr-only">{copied ? '提示词已复制' : ''}</span></div>
            {output.result.tips && <div className="image-prompt-tips"><strong>复刻建议</strong><p>{output.result.tips}</p></div>}
          </> : <div className="image-prompt-empty"><div className="image-prompt-quotation" aria-hidden="true">“<span>画面的下一种语言</span>”</div><h2>从一张图片开始。</h2><p>不止描述“有什么”，也保留它为什么好看。<br />你会得到中文、英文，以及可替换主体的完整版本。</p><div className="image-prompt-anchor-list"><span>构图</span><span>光线</span><span>色彩</span><span>材质</span></div></div>}
        <p className="image-prompt-footnote">提示词是基于可见画面的重建，不能恢复原始提示词或种子。复刻结果也取决于生图模型和参考图能力。</p>
      </section>
    </div>
  </div>;
}

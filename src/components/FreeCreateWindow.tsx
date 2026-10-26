import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { buildFreeCreateBatchRequests, buildFreeCreateRequest, FREE_CREATE_ASPECT_RATIOS, MAX_FREE_CREATE_IMAGES, MAX_FREE_CREATE_REFERENCES, MIN_FREE_CREATE_IMAGES } from '../lib/freeCreate';
import { startFreeCreateQueue } from '../lib/freeCreateQueue';
import { downloadImage } from '../lib/download';
import { fileToDataUrl, validateImageFile } from '../lib/validation';
import { activeSession, sessionHasPending, useFreeCreateStore } from '../store/useFreeCreateStore';
import { useIdentityStore } from '../store/useIdentityStore';
import { useInpaintStore } from '../store/useInpaintStore';
import { gptImageQualityForRequest, useProviderStore } from '../store/useProviderStore';
import { useToast } from '../store/useToast';
import { useViewerStore } from '../store/useViewerStore';
import { navigateTo } from '../lib/navigation';
import { GallerySaveButton } from './GallerySaveButton';
import { PromptShareButton } from './PromptShareButton';
import { ZoomButton } from './ImageLightbox';
import type { FreeCreateReference, FreeCreateSession, FreeCreateUserMessage } from '../types';

const buttonClass = 'glass-btn px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-zzz-cyan/60 disabled:cursor-not-allowed disabled:opacity-40';
const modeLabels = { conversation: '普通创作', 'fixed-character': '固定角色换画面', 'fixed-scene': '固定背景换角色' };
const statusLabels = { queued: '等待生成', sending: '正在生成', complete: '已完成', error: '生成失败', uncertain: '结果尚未确认' };

function sessionSummary(session: FreeCreateSession): string {
  if (session.pausedReason) return '任务已暂停';
  const messages = session.messages.filter((message): message is FreeCreateUserMessage => message.role === 'user');
  const running = messages.filter((message) => message.status === 'sending').length;
  const queued = messages.filter((message) => message.status === 'queued').length;
  const errors = messages.filter((message) => message.status === 'error' || message.status === 'uncertain').length;
  if (running || queued) return [running ? `${running} 个生成中` : '', queued ? `${queued} 个排队` : ''].filter(Boolean).join(' · ');
  if (errors) return `${errors} 个待处理`;
  return messages.length ? `${messages.filter((message) => message.status === 'complete').length} 个已完成` : '草稿';
}

function PlusIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}

function ReferencePreview({ reference, onRemove }: { reference: FreeCreateReference; onRemove?: () => void }) {
  return <figure className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-zzz-text/15 bg-black/25">
    <img src={reference.dataUrl} alt={reference.name} title={reference.name} className="h-full w-full object-contain" />
    <ZoomButton src={reference.dataUrl} alt={reference.name} />
    {onRemove && <button type="button" onClick={onRemove} aria-label={`移除 ${reference.name}`} className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-black/80 text-sm text-white hover:bg-red-950">×</button>}
  </figure>;
}

export const FreeCreateWindow = memo(function FreeCreateWindow() {
  const isOpen = useFreeCreateStore((state) => state.isOpen);
  const sessions = useFreeCreateStore((state) => state.sessions);
  const activeSessionId = useFreeCreateStore((state) => state.activeSessionId);
  const session = useFreeCreateStore(activeSession);
  const close = useFreeCreateStore((state) => state.close);
  const newConversation = useFreeCreateStore((state) => state.newConversation);
  const copyConversation = useFreeCreateStore((state) => state.copyConversation);
  const selectSession = useFreeCreateStore((state) => state.selectSession);
  const setDraft = useFreeCreateStore((state) => state.setDraft);
  const setMode = useFreeCreateStore((state) => state.setMode);
  const setSharedReference = useFreeCreateStore((state) => state.setSharedReference);
  const setCostumeMode = useFreeCreateStore((state) => state.setCostumeMode);
  const addDraftReferences = useFreeCreateStore((state) => state.addDraftReferences);
  const removeDraftReference = useFreeCreateStore((state) => state.removeDraftReference);
  const addBatchReferences = useFreeCreateStore((state) => state.addBatchReferences);
  const removeBatchReference = useFreeCreateStore((state) => state.removeBatchReference);
  const selectContextImage = useFreeCreateStore((state) => state.selectContextImage);
  const setImageCount = useFreeCreateStore((state) => state.setImageCount);
  const setAspectRatio = useFreeCreateStore((state) => state.setAspectRatio);
  const enqueueGeneration = useFreeCreateStore((state) => state.enqueueGeneration);
  const enqueueBatch = useFreeCreateStore((state) => state.enqueueBatch);
  const retryGeneration = useFreeCreateStore((state) => state.retryGeneration);
  const recheckGeneration = useFreeCreateStore((state) => state.recheckGeneration);
  const restoreDraft = useFreeCreateStore((state) => state.restoreDraft);
  const resumeSession = useFreeCreateStore((state) => state.resumeSession);
  const quality = useProviderStore(gptImageQualityForRequest);
  const gptCredentials = useProviderStore((state) => state.creds['gpt-image']);
  const freeloadEnabled = useProviderStore((state) => state.freeloadEnabled);
  const characterName = useIdentityStore((state) => state.characterName);
  const showError = useToast((state) => state.show);
  const isWorkspaceOpen = useInpaintStore((state) => state.isWorkspaceOpen);
  const viewerFullscreen = useViewerStore((state) => state.viewerFullscreen);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sharedInputRef = useRef<HTMLInputElement>(null);
  const uploadOwnerRef = useRef<{ sessionId: string; kind: 'shared' | 'batch' | 'conversation' } | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [batchExpanded, setBatchExpanded] = useState(false);
  const [readingSessions, setReadingSessions] = useState<Record<string, number>>({});
  const [confirmRegenerate, setConfirmRegenerate] = useState<string | null>(null);
  const shouldAvoidFullscreen = isWorkspaceOpen || viewerFullscreen;
  const { draft, draftReferences, batchReferences, messages, contextImageUrl, imageCount, aspectRatio, sharedReference, mode, costumeMode } = session;
  const isBatch = mode !== 'conversation';
  const references = isBatch ? batchReferences : draftReferences;
  const isPending = sessionHasPending(session);
  const isReading = (readingSessions[activeSessionId] ?? 0) > 0;
  const runningCount = sessions.reduce((count, item) => count + item.messages.filter((message) => message.role === 'user' && message.status === 'sending').length, 0);
  const queuedCount = sessions.reduce((count, item) => count + item.messages.filter((message) => message.role === 'user' && message.status === 'queued').length, 0);

  useEffect(() => { startFreeCreateQueue(); }, []);
  useEffect(() => {
    if (!isOpen || shouldAvoidFullscreen) return;
    promptRef.current?.focus();
    setConfirmRegenerate(null);
  }, [isOpen, shouldAvoidFullscreen, activeSessionId]);
  useEffect(() => {
    if (!isOpen || shouldAvoidFullscreen) return;
    const list = messageListRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [isOpen, shouldAvoidFullscreen, activeSessionId, messages.length]);
  useEffect(() => {
    if (!isOpen || shouldAvoidFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, isOpen, shouldAvoidFullscreen]);

  const showOwnedError = useCallback((ownerId: string, message: string) => {
    if (useFreeCreateStore.getState().activeSessionId === ownerId) showError(message);
  }, [showError]);

  const handleFiles = useCallback(async (files: FileList | null, ownerId: string, kind: 'shared' | 'batch' | 'conversation') => {
    if (!files?.length) return;
    const selected = Array.from(files);
    const owner = useFreeCreateStore.getState().sessions.find((item) => item.id === ownerId);
    if (!owner) return;
    const ownerReferences = kind === 'batch' ? owner.batchReferences : owner.draftReferences;
    if (kind === 'shared' && selected.length !== 1) { showOwnedError(ownerId, '共用素材请选择一张图片'); return; }
    if (kind !== 'shared' && ownerReferences.length + selected.length > MAX_FREE_CREATE_REFERENCES) {
      showOwnedError(ownerId, `最多添加 ${MAX_FREE_CREATE_REFERENCES} 张${kind === 'batch' ? '逐项素材' : '参考图'}`);
      return;
    }
    for (const file of selected) {
      const check = validateImageFile(file);
      if (!check.ok) { showOwnedError(ownerId, check.message ?? '文件校验失败'); return; }
    }
    setReadingSessions((current) => ({ ...current, [ownerId]: (current[ownerId] ?? 0) + 1 }));
    try {
      const images = await Promise.all(selected.map(async (file): Promise<FreeCreateReference> => ({ id: crypto.randomUUID(), dataUrl: await fileToDataUrl(file), name: file.name })));
      const currentOwner = useFreeCreateStore.getState().sessions.find((item) => item.id === ownerId);
      if (!currentOwner) return;
      if (kind === 'shared') setSharedReference(images[0], ownerId);
      else {
        const currentReferences = kind === 'batch' ? currentOwner.batchReferences : currentOwner.draftReferences;
        if (currentReferences.length + images.length > MAX_FREE_CREATE_REFERENCES) showOwnedError(ownerId, `最多添加 ${MAX_FREE_CREATE_REFERENCES} 张图片`);
        else if (kind === 'batch') addBatchReferences(images, ownerId);
        else addDraftReferences(images, ownerId);
      }
    } catch { showOwnedError(ownerId, '读取图片失败，请重新选择'); }
    finally { setReadingSessions((current) => ({ ...current, [ownerId]: Math.max(0, (current[ownerId] ?? 1) - 1) })); }
  }, [addDraftReferences, addBatchReferences, setSharedReference, showOwnedError]);

  const chooseImages = (kind: 'shared' | 'batch' | 'conversation') => {
    uploadOwnerRef.current = { sessionId: session.id, kind };
    (kind === 'shared' ? sharedInputRef : fileInputRef).current?.click();
  };

  const consumeUpload = (files: FileList | null) => {
    const owner = uploadOwnerRef.current;
    if (owner) void handleFiles(files, owner.sessionId, owner.kind);
    uploadOwnerRef.current = null;
  };

  const handleSend = useCallback((onlyReference?: FreeCreateReference) => {
    const ownerId = session.id;
    if (isReading || session.pausedReason) return;
    if (session.messages.some((message) => message.role === 'user' && (message.status === 'queued' || message.status === 'sending') && (!isBatch || !onlyReference || message.targetReference?.id === onlyReference.id))) return;
    const prompt = draft.trim();
    if (!isBatch && !prompt) { showOwnedError(ownerId, '请输入创作说明'); return; }
    if (!freeloadEnabled && !gptCredentials.apiKey.trim()) { showOwnedError(ownerId, '请先在「工坊设置 → 接口与模型」填写 gpt-image API Key'); return; }
    if (!freeloadEnabled && !gptCredentials.baseUrl.trim()) { showOwnedError(ownerId, '请先在「工坊设置 → 接口与模型」填写 gpt-image Base URL'); return; }
    const input = { prompt, contextImageUrl, references: draftReferences, credentials: gptCredentials, quality, useServerPreset: freeloadEnabled, imageCount, aspectRatio };
    try {
      if (mode === 'conversation') {
        const request = buildFreeCreateRequest(input);
        enqueueGeneration({ sessionId: ownerId, prompt, references: draftReferences, request });
      } else {
        if (!sharedReference) { showOwnedError(ownerId, mode === 'fixed-character' ? '请先上传共用角色三视图' : '请先上传共用背景图'); return; }
        const targets = onlyReference ? [onlyReference] : batchReferences;
        if (!targets.length) { showOwnedError(ownerId, mode === 'fixed-character' ? '请添加需要替换角色的目标画面' : '请添加要放入背景的角色三视图'); return; }
        const items = buildFreeCreateBatchRequests({ ...input, mode, sharedReference, targets, costumeMode });
        enqueueBatch({ sessionId: ownerId, prompt, items });
      }
    } catch (error) { showOwnedError(ownerId, error instanceof Error ? error.message : '图片准备失败'); }
  }, [session, draft, isBatch, isReading, freeloadEnabled, gptCredentials, contextImageUrl, draftReferences, batchReferences, quality, imageCount, aspectRatio, mode, sharedReference, costumeMode, enqueueGeneration, enqueueBatch, showOwnedError]);

  if (!isOpen || shouldAvoidFullscreen) return null;

  const renderTaskActions = (message: FreeCreateUserMessage) => {
    if (message.status !== 'error' && message.status !== 'uncertain') return null;
    return <div className="mt-2 flex flex-wrap items-center gap-2">
      {message.status === 'error' ? <button type="button" onClick={() => retryGeneration(session.id, message.id)} className={`${buttonClass} text-zzz-cyan`}>重试</button> : <>
        <button type="button" onClick={() => recheckGeneration(session.id, message.id)} className={`${buttonClass} text-zzz-cyan`}>查询原请求</button>
        <button type="button" onClick={() => setConfirmRegenerate(message.id)} className={`${buttonClass} text-zzz-text/70`}>重新生成</button>
      </>}
      <button type="button" onClick={() => restoreDraft(session.id, message.id)} className={`${buttonClass} text-zzz-text/75`}>编辑后重试</button>
      {confirmRegenerate === message.id && <div role="alert" className="w-full rounded-lg border border-amber-300/25 bg-amber-200/5 p-3 text-xs leading-relaxed text-amber-100">
        原请求可能仍会完成。重新生成可能再次消耗额度。
        <div className="mt-2 flex gap-2"><button type="button" onClick={() => { retryGeneration(session.id, message.id, true); setConfirmRegenerate(null); }} className={`${buttonClass} text-amber-100`}>确认重新生成</button><button type="button" onClick={() => setConfirmRegenerate(null)} className={`${buttonClass} text-zzz-text/65`}>返回</button></div>
      </div>}
      <details className="w-full text-[10px] text-zzz-text/40"><summary className="cursor-pointer">错误详情</summary><p className="mt-1 break-all">{message.errorCode || 'UPSTREAM_ERROR'}{message.httpStatus ? ` · HTTP ${message.httpStatus}` : ''} · 请求 {message.requestSnapshot?.idempotencyKey ?? message.attemptId}</p></details>
    </div>;
  };

  return <section id="free-create-window" role="dialog" aria-modal="false" aria-labelledby="free-create-title" className={`glass fixed bottom-28 right-3 top-3 z-[10002] flex w-[calc(100%-1.5rem)] flex-col overflow-hidden sm:right-6 sm:top-6 ${compact ? 'max-w-[440px]' : 'max-w-[1040px]'}`}>
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zzz-text/12 bg-black/20 px-4 py-3 sm:px-5">
      <div className="min-w-0"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zzz-primary/45 bg-zzz-primary/15 text-zzz-primary"><PlusIcon /></span><h2 id="free-create-title" className="zzz-heading text-lg text-zzz-text sm:text-xl">自由创作</h2><span className="hidden rounded-full border border-zzz-text/12 px-2 py-0.5 font-mono text-[10px] text-zzz-text/50 sm:inline">工作台</span></div><p className="mt-1 truncate font-mono text-[10px] text-zzz-text/50 sm:text-xs">{runningCount ? `${runningCount}/2 个任务生成中` : '关闭后保留会话'}{queuedCount ? ` · ${queuedCount} 个排队` : ''} · 刷新后清空</p></div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={newConversation} className={`${buttonClass} text-zzz-cyan`}>新建</button>
        <button type="button" onClick={() => setCompact((current) => !current)} aria-label={compact ? '展开创作工作台' : '收窄创作窗口'} title={compact ? '展开工作台' : '收窄窗口'} className="glass-btn hidden h-8 w-8 items-center justify-center text-zzz-text/70 sm:flex"><svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d={compact ? 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5' : 'M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5'} /></svg></button>
        <button type="button" onClick={close} aria-label="收起自由创作" className="glass-btn flex h-8 w-8 items-center justify-center text-zzz-text/70"><svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      </div>
    </header>

    <div className="flex min-h-0 flex-1">
      {!compact && <aside className="hidden w-48 shrink-0 flex-col border-r border-zzz-text/12 bg-black/15 p-3 lg:flex">
        <div className="mb-3 flex items-center justify-between font-mono text-xs text-zzz-text/45"><span>会话</span><span>{sessions.length}</span></div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">{sessions.map((item, index) => <button key={item.id} type="button" onClick={() => selectSession(item.id)} aria-current={item.id === activeSessionId} data-active={item.id === activeSessionId} className={`w-full rounded-xl border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-zzz-cyan/60 ${item.id === activeSessionId ? 'border-zzz-primary/45 bg-zzz-primary/10' : 'border-zzz-text/10 bg-black/15 hover:border-zzz-text/25'}`}>
          <span className="flex items-center justify-between gap-2 text-sm text-zzz-text">会话 {index + 1}{sessionHasPending(item) && <span aria-label="任务进行中" className="h-1.5 w-1.5 rounded-full bg-zzz-cyan" />}</span><span className="mt-1 block truncate font-mono text-[10px] text-zzz-text/50">{modeLabels[item.mode]}</span><span className={`mt-2 block font-mono text-[10px] ${item.pausedReason ? 'text-amber-200' : 'text-zzz-text/40'}`}>{sessionSummary(item)}</span>
        </button>)}</div>
        <button type="button" onClick={() => copyConversation(session.id)} className={`${buttonClass} mt-3 w-full text-zzz-text/75`}>沿用素材新建</button><p className="mt-2 text-[10px] leading-relaxed text-zzz-text/35">复制当前素材与设置，开始独立会话。</p>
      </aside>}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className={`shrink-0 border-b border-zzz-text/10 bg-black/10 px-3 py-2 ${compact ? '' : 'lg:hidden'}`}><div className="flex items-center gap-2 overflow-x-auto pb-1">
          {sessions.map((item, index) => <button key={item.id} type="button" onClick={() => selectSession(item.id)} aria-current={item.id === activeSessionId} data-active={item.id === activeSessionId} className={`${buttonClass} shrink-0 ${item.id === activeSessionId ? 'text-zzz-primary' : 'text-zzz-text/60'}`}>会话 {index + 1}{sessionHasPending(item) ? ' · 进行中' : item.pausedReason ? ' · 已暂停' : ''}</button>)}
          <button type="button" onClick={() => copyConversation(session.id)} className={`${buttonClass} shrink-0 text-zzz-cyan/80`}>沿用素材新建</button>
        </div></div>
        {session.pausedReason && <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-200/15 bg-amber-200/5 px-4 py-2.5 text-xs text-amber-100"><span className="min-w-0 flex-1 leading-relaxed">{session.pausedReason}；未开始的任务已暂停。</span><button type="button" onClick={() => resumeSession(session.id)} className={`${buttonClass} text-amber-100`}>继续任务</button></div>}

        <div ref={messageListRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-5">
          {messages.length === 0 && <div className="flex min-h-full flex-col justify-center"><div className="mx-auto w-full max-w-lg py-4"><span className="mb-4 block font-mono text-[10px] tracking-[0.2em] text-zzz-cyan/65">FREE CREATION</span><p className="zzz-heading text-2xl leading-tight text-zzz-text">从一个想法，<br />或一组参考开始。</p><p className="mt-3 text-sm leading-relaxed text-zzz-text/55">在下方描述想创作的画面，也可以添加参考图。生成时可以继续新建其它会话。</p></div></div>}
          {messages.map((message) => message.role === 'user' ? <article key={message.id} className={`${message.targetReference ? 'mr-auto w-full' : 'ml-auto max-w-[92%] sm:max-w-[82%]'} rounded-xl border border-zzz-text/15 bg-black/20 p-3.5`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]"><span className="text-zzz-text/45">{message.targetReference ? `逐项生成${message.batchIndex !== undefined ? ` · ${message.batchIndex + 1}` : ''}` : '创作说明'}</span><span aria-live="polite" className={`flex items-center gap-1.5 ${message.status === 'error' ? 'text-red-300' : message.status === 'uncertain' ? 'text-amber-200' : message.status === 'sending' || message.status === 'queued' ? 'text-zzz-cyan' : 'text-zzz-text/45'}`}>{message.status === 'sending' && <span className="h-2.5 w-2.5 animate-spin rounded-full border border-zzz-cyan/30 border-t-zzz-cyan motion-reduce:animate-none" />}{statusLabels[message.status]}</span></div>
            {message.targetReference && <div className="mb-2 flex items-center gap-3"><ReferencePreview reference={message.targetReference} /><p className="min-w-0 text-xs text-zzz-text/60"><span className="block truncate">{message.targetReference.name}</span><span className="mt-1 block text-zzz-text/35">每项独立生成 · 共用素材保持一致</span></p></div>}
            {message.prompt && <><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zzz-text/90">{message.prompt}</p><div className="mt-2 flex justify-end"><PromptShareButton prompt={message.prompt} /></div></>}
            {!message.targetReference && message.references.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{message.references.map((reference) => <ReferencePreview key={reference.id} reference={reference} />)}</div>}
            {(message.status === 'error' || message.status === 'uncertain') && <p className={`mt-2 break-words text-xs leading-relaxed ${message.status === 'uncertain' ? 'text-amber-200/85' : 'text-red-300/90'}`}>{message.error ?? '生成未完成，请重试或编辑输入。'}</p>}{renderTaskActions(message)}
          </article> : <article key={message.id} className="mr-auto w-full"><div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-zzz-cyan/80"><span className="h-px w-4 bg-zzz-cyan/50" />创作结果{message.userMessageId && (() => { const source = messages.find((item) => item.id === message.userMessageId && item.role === 'user'); return source?.role === 'user' && source.targetReference ? ` · ${source.targetReference.name}` : ''; })()}</div><div className={`grid gap-3 ${!compact && message.images.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
            {message.images.map((image, index) => { const selected = contextImageUrl === image && !isBatch; return <figure key={`${message.id}-${index}`} className={`relative overflow-hidden rounded-xl border bg-black/25 ${selected ? 'border-zzz-primary/65' : 'border-zzz-text/15'}`}><img src={image} alt={`自由创作结果 ${index + 1}`} className="max-h-80 w-full object-contain" loading="lazy" /><ZoomButton src={image} alt={`自由创作结果 ${index + 1}`} /><figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-zzz-text/10 px-3 py-2.5"><span className={`font-mono text-[10px] ${selected ? 'text-zzz-primary' : 'text-zzz-text/45'}`}>{selected ? '当前上下文' : `结果 ${index + 1}`}</span><span className="flex flex-wrap items-center gap-2"><GallerySaveButton saveInfo={{ imageUrl: image, style: '自由创作', characterName, prompt: message.prompt, provider: 'gpt-image' }} /><button type="button" onClick={() => { selectContextImage(image, session.id); setMode('conversation', session.id); }} className="glass-btn px-2 py-1 font-mono text-xs text-zzz-cyan">以此继续</button><button type="button" onClick={() => void downloadImage(image, `free-create-${index + 1}.png`)} className="glass-btn px-2 py-1 font-mono text-xs text-zzz-text/70">下载</button></span></figcaption></figure>; })}
          </div></article>)}
        </div>

        <div className="max-h-[58%] shrink-0 overflow-y-auto border-t border-zzz-text/12 bg-zzz-ink/85 px-3 py-3 sm:px-4">
          <div className="mb-3 rounded-xl border border-zzz-text/12 bg-black/15"><div className="flex items-center justify-between gap-2 px-3 py-2.5"><button type="button" onClick={() => setBatchExpanded((current) => !current)} aria-expanded={batchExpanded} aria-controls="free-create-batch" className="flex min-w-0 items-center gap-2 text-left text-xs text-zzz-text/80"><span className={`text-zzz-cyan transition ${batchExpanded ? 'rotate-90' : ''}`}>›</span><span>批量复用</span>{isBatch && <span className="truncate rounded-full border border-zzz-cyan/25 px-2 py-0.5 text-[10px] text-zzz-cyan">{modeLabels[mode]}</span>}</button>{isBatch && <button type="button" onClick={() => setMode('conversation', session.id)} className="shrink-0 text-[10px] text-zzz-text/50 hover:text-zzz-text">返回普通创作</button>}</div>
            {batchExpanded && <div id="free-create-batch" className="border-t border-zzz-text/10 px-3 pb-3 pt-3"><div className="mb-3 grid gap-2 sm:grid-cols-2">
              <button type="button" aria-pressed={mode === 'fixed-character'} onClick={() => setMode('fixed-character', session.id)} className={`rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-zzz-cyan/60 ${mode === 'fixed-character' ? 'border-zzz-cyan/40 bg-zzz-cyan/5' : 'border-zzz-text/15 hover:border-zzz-text/30'}`}><span className="block text-xs text-zzz-text/85">固定角色换画面</span><span className="mt-1 block text-[10px] leading-relaxed text-zzz-text/45">一份三视图，逐张替换目标画面的角色</span></button>
              <button type="button" aria-pressed={mode === 'fixed-scene'} onClick={() => setMode('fixed-scene', session.id)} className={`rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-zzz-cyan/60 ${mode === 'fixed-scene' ? 'border-zzz-cyan/40 bg-zzz-cyan/5' : 'border-zzz-text/15 hover:border-zzz-text/30'}`}><span className="block text-xs text-zzz-text/85">固定背景换角色</span><span className="mt-1 block text-[10px] leading-relaxed text-zzz-text/45">保留婚礼等场景，逐张放入不同角色</span></button>
            </div>
              {isBatch ? <><div className="flex items-center gap-3 rounded-lg border border-dashed border-zzz-cyan/30 bg-zzz-cyan/5 p-2.5">{sharedReference ? <ReferencePreview reference={sharedReference} onRemove={() => setSharedReference(null, session.id)} /> : <button type="button" disabled={isReading} onClick={() => chooseImages('shared')} aria-label={mode === 'fixed-character' ? '上传共用角色三视图' : '上传共用背景图'} className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-zzz-cyan/25 text-zzz-cyan/75 disabled:opacity-40"><PlusIcon /></button>}<div className="min-w-0"><span className="block text-xs text-zzz-text/85">{mode === 'fixed-character' ? '共用角色三视图' : '共用背景图'}</span><span className="mt-1 block text-[10px] leading-relaxed text-zzz-text/45">{mode === 'fixed-character' ? '以三视图保持角色身份，借用目标画面的动作与背景。' : '保留背景与构图，将每张角色三视图分别放入场景。'}</span><button type="button" disabled={isReading} onClick={() => chooseImages('shared')} className="mt-2 text-[10px] text-zzz-cyan disabled:opacity-40">{sharedReference ? '更换图片' : '选择图片'}</button></div></div>
                {mode === 'fixed-character' && <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-zzz-text/60"><span>服装依据</span><label className="flex items-center gap-1.5"><input type="radio" name={`costume-${session.id}`} checked={costumeMode === 'character'} onChange={() => setCostumeMode('character', session.id)} className="accent-[var(--zzz-cyan)]" />保留角色服装</label><label className="flex items-center gap-1.5"><input type="radio" name={`costume-${session.id}`} checked={costumeMode === 'target'} onChange={() => setCostumeMode('target', session.id)} className="accent-[var(--zzz-cyan)]" />沿用目标服装</label></div>}
                <p className="mt-2 text-[10px] leading-relaxed text-zzz-text/45">{mode === 'fixed-character' ? '下方添加目标画面，每张替换一个角色。' : '下方添加角色三视图，每张单独生成一张场景图。'} 最多 16 项，每项生成 1 张。</p>
              </> : <p className="text-xs leading-relaxed text-zzz-text/45">选择一种复用方式：一份共用素材，配合多张逐项素材分别生成。</p>}
            </div>}
          </div>
          <input ref={sharedInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { consumeUpload(event.target.files); event.target.value = ''; }} />
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(event) => { consumeUpload(event.target.files); event.target.value = ''; }} />
          {!isBatch && contextImageUrl && <div className="mb-3 flex items-center gap-2 rounded-lg border border-zzz-primary/25 bg-zzz-primary/5 p-2"><img src={contextImageUrl} alt="当前创作上下文" className="h-9 w-12 rounded object-contain" /><span className="flex-1 text-xs text-zzz-text/60">这张成图是本轮主图</span><button type="button" onClick={() => selectContextImage(null, session.id)} className="text-[10px] text-zzz-text/50 hover:text-zzz-text">清除主图</button></div>}
          {references.length > 0 && <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{references.map((reference, index) => <div key={reference.id} className="shrink-0"><ReferencePreview reference={reference} onRemove={() => isBatch ? removeBatchReference(reference.id, session.id) : removeDraftReference(reference.id, session.id)} />{!isBatch && <span className="mt-1 block w-20 truncate text-center text-[9px] text-zzz-text/45">{!contextImageUrl && index === 0 ? '主图 · 背景优先' : `参考图 ${index + 1}`}</span>}{isBatch && <button type="button" disabled={isReading || !!session.pausedReason || messages.some((message) => message.role === 'user' && message.targetReference?.id === reference.id && (message.status === 'queued' || message.status === 'sending'))} onClick={() => handleSend(reference)} className="mt-1 w-20 truncate text-[10px] text-zzz-cyan/80 disabled:opacity-40">生成第 {index + 1} 项</button>}</div>)}</div>}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2"><span className="font-mono text-[10px] text-zzz-text/45">{isReading ? '正在读取图片…' : `${isBatch ? (mode === 'fixed-character' ? '目标画面' : '角色三视图') : '参考图'} ${references.length}/${MAX_FREE_CREATE_REFERENCES}`}</span><div className="flex flex-wrap items-center gap-1">{FREE_CREATE_ASPECT_RATIOS.map((ratio) => <button key={ratio} type="button" onClick={() => setAspectRatio(ratio, session.id)} aria-pressed={ratio === aspectRatio} data-active={ratio === aspectRatio} className={`glass-btn px-2 py-1 font-mono text-[10px] ${ratio === aspectRatio ? 'text-zzz-cyan' : 'text-zzz-text/45'}`}>{ratio}</button>)}{!isBatch && <div className="ml-1 flex items-center gap-1 border-l border-zzz-text/15 pl-2"><button type="button" onClick={() => setImageCount(imageCount - 1, session.id)} disabled={imageCount <= MIN_FREE_CREATE_IMAGES} aria-label="减少生成数量" className="h-6 w-5 text-zzz-text/70 disabled:opacity-25">−</button><span className="font-mono text-[10px] text-zzz-text/60">{imageCount} 张</span><button type="button" onClick={() => setImageCount(imageCount + 1, session.id)} disabled={imageCount >= MAX_FREE_CREATE_IMAGES} aria-label="增加生成数量" className="h-6 w-5 text-zzz-text/70 disabled:opacity-25">+</button></div>}</div></div>
          <div className="flex items-end gap-2 rounded-xl border border-zzz-text/20 bg-black/25 p-2"><button type="button" disabled={isReading || references.length >= MAX_FREE_CREATE_REFERENCES} onClick={() => chooseImages(isBatch ? 'batch' : 'conversation')} title={isBatch ? '添加逐项素材' : '添加参考图'} aria-label={isBatch ? '添加逐项素材' : '添加参考图'} className="glass-btn flex h-10 w-10 shrink-0 items-center justify-center p-0 text-zzz-cyan disabled:opacity-40"><PlusIcon /></button><textarea ref={promptRef} value={draft} onChange={(event) => setDraft(event.target.value, session.id)} rows={2} placeholder={isBatch ? '补充说明（可选，例如人物比例、婚礼氛围）…' : contextImageUrl ? '说明下一步如何修改…' : '描述画面；多人同框可添加背景和各角色图，说明每人的位置…'} className="max-h-28 min-h-14 flex-1 resize-y bg-transparent px-1 py-1 text-sm leading-relaxed text-zzz-text placeholder:text-zzz-text/35 focus:outline-none" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); handleSend(); } }} /><button type="button" disabled={isReading || !!session.pausedReason || (isBatch ? !sharedReference || !references.length || isPending : !draft.trim() || isPending)} onClick={() => handleSend()} aria-label={isBatch ? '全部生成' : '发送创作请求'} className="glass-btn flex h-10 shrink-0 items-center gap-2 px-3 font-mono text-xs text-zzz-cyan disabled:opacity-35">{isBatch ? '全部生成' : isPending ? '生成中' : '生成'}<svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m4 4 16 8-16 8 3-8-3-8ZM7 12h13" /></svg></button></div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] leading-relaxed text-zzz-text/35">{isBatch ? '每项独立生成，失败可单独补跑。' : 'Enter 生成 · Shift + Enter 换行。'}{freeloadEnabled ? ' 免费额度在请求开始后消耗，失败重试会再次消耗。' : ' 参考图与会话仅保留在本页。'}</p><button type="button" onClick={() => { close(); navigateTo('prompts'); }} className="shrink-0 text-[10px] text-zzz-cyan/75 underline decoration-zzz-cyan/30 underline-offset-2 hover:text-zzz-cyan">找灵感？浏览提示词画廊</button></div>
        </div>
      </div>
    </div>
  </section>;
});

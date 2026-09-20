import { memo, useCallback, useEffect, useRef } from 'react';
import { ApiError, generate } from '../lib/apiClient';
import { buildFreeCreateRequest, maxFreeCreateReferenceImages } from '../lib/freeCreate';
import { downloadImage } from '../lib/download';
import { fileToDataUrl, validateImageFile } from '../lib/validation';
import { useFreeCreateStore } from '../store/useFreeCreateStore';
import { useInpaintStore } from '../store/useInpaintStore';
import { useProviderStore } from '../store/useProviderStore';
import { useToast } from '../store/useToast';
import { useViewerStore } from '../store/useViewerStore';
import type { FreeCreateReference } from '../types';

export const FreeCreateWindow = memo(function FreeCreateWindow() {
  const isOpen = useFreeCreateStore((state) => state.isOpen);
  const draft = useFreeCreateStore((state) => state.draft);
  const draftReferences = useFreeCreateStore((state) => state.draftReferences);
  const messages = useFreeCreateStore((state) => state.messages);
  const contextImageUrl = useFreeCreateStore((state) => state.contextImageUrl);
  const isGenerating = useFreeCreateStore((state) => state.isGenerating);
  const close = useFreeCreateStore((state) => state.close);
  const newConversation = useFreeCreateStore((state) => state.newConversation);
  const setDraft = useFreeCreateStore((state) => state.setDraft);
  const addDraftReferences = useFreeCreateStore((state) => state.addDraftReferences);
  const removeDraftReference = useFreeCreateStore((state) => state.removeDraftReference);
  const selectContextImage = useFreeCreateStore((state) => state.selectContextImage);
  const beginGeneration = useFreeCreateStore((state) => state.beginGeneration);
  const completeGeneration = useFreeCreateStore((state) => state.completeGeneration);
  const failGeneration = useFreeCreateStore((state) => state.failGeneration);
  const gptCredentials = useProviderStore((state) => state.creds['gpt-image']);
  const freeloadEnabled = useProviderStore((state) => state.freeloadEnabled);
  const showError = useToast((state) => state.show);
  const isWorkspaceOpen = useInpaintStore((state) => state.isWorkspaceOpen);
  const viewerFullscreen = useViewerStore((state) => state.viewerFullscreen);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldAvoidFullscreen = isWorkspaceOpen || viewerFullscreen;
  const maxReferences = maxFreeCreateReferenceImages(gptCredentials.model, Boolean(contextImageUrl));

  useEffect(() => {
    if (!isOpen || shouldAvoidFullscreen) return;
    promptRef.current?.focus();
  }, [isOpen, shouldAvoidFullscreen]);

  useEffect(() => {
    if (!isOpen || shouldAvoidFullscreen) return;
    const list = messageListRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [isOpen, shouldAvoidFullscreen, messages.length, isGenerating]);

  useEffect(() => {
    if (!isOpen || shouldAvoidFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, isOpen, shouldAvoidFullscreen]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files);
    if (selected.length === 0) return;
    const availableSlots = maxReferences - draftReferences.length;
    if (availableSlots <= 0 || selected.length > availableSlots) {
      showError(`当前模型本轮最多支持 ${maxReferences} 张参考图`);
      return;
    }

    for (const file of selected) {
      const check = validateImageFile(file);
      if (!check.ok) {
        showError(check.message ?? '文件校验失败');
        return;
      }
    }

    try {
      const references = await Promise.all(selected.map(async (file): Promise<FreeCreateReference> => ({
        id: crypto.randomUUID(),
        dataUrl: await fileToDataUrl(file),
        name: file.name,
      })));
      addDraftReferences(references);
    } catch {
      showError('读取参考图失败，请重试');
    }
  }, [addDraftReferences, draftReferences.length, maxReferences, showError]);

  const handleSend = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt) {
      showError('请输入创作说明');
      return;
    }
    if (!freeloadEnabled && !gptCredentials.apiKey.trim()) {
      showError('请先在「接口与角色」模块填写 gpt-image API Key');
      return;
    }
    if (!freeloadEnabled && !gptCredentials.baseUrl.trim()) {
      showError('请先在「接口与角色」模块填写 gpt-image Base URL');
      return;
    }

    let request;
    try {
      request = buildFreeCreateRequest({
        prompt,
        contextImageUrl,
        references: draftReferences,
        credentials: gptCredentials,
        useServerPreset: freeloadEnabled,
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : '参考图准备失败');
      return;
    }

    const generation = beginGeneration(prompt, draftReferences);
    if (!generation) return;

    try {
      const images = await generate(request);
      completeGeneration(generation, images);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '生成失败';
      failGeneration(generation, message);
      showError(message);
    }
  }, [beginGeneration, completeGeneration, contextImageUrl, draft, draftReferences, failGeneration, freeloadEnabled, gptCredentials, showError]);

  if (!isOpen || shouldAvoidFullscreen) return null;

  return (
    <section
      id="free-create-window"
      role="dialog"
      aria-modal="false"
      aria-labelledby="free-create-title"
      className="fixed bottom-4 right-4 top-4 z-50 flex w-[calc(100%-2rem)] max-w-[440px] flex-col overflow-hidden rounded-[24px] border border-[var(--zzz-text)]/20 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--zzz-primary)_20%,transparent),color-mix(in_srgb,var(--zzz-ink)_92%,transparent)_42%,color-mix(in_srgb,var(--zzz-magenta)_12%,transparent))] shadow-[0_24px_70px_rgba(0,0,0,0.62),0_0_36px_color-mix(in_srgb,var(--zzz-primary)_22%,transparent)] backdrop-blur-2xl sm:bottom-6 sm:right-6 sm:top-6"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--zzz-text)]/12 bg-black/15 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--zzz-primary)]/50 bg-[var(--zzz-primary)]/14 text-[var(--zzz-primary)]">
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18" />
                <path d="M3 12h18" />
                <path d="m18.5 4.5 1 1" />
              </svg>
            </span>
            <h2 id="free-create-title" className="font-mono text-sm font-bold tracking-wide text-[var(--zzz-text)]">
              自由创作
            </h2>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-[var(--zzz-text)]/50">
            关闭后保留本页会话，刷新页面后清空
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={newConversation}
            className="glass-btn px-2.5 py-1.5 font-mono text-[10px] text-[var(--zzz-cyan)]"
          >
            新建
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="收起自由创作"
            className="glass-btn flex h-7 w-7 items-center justify-center p-0 text-[var(--zzz-text)]/75"
          >
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </header>

      <div ref={messageListRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--zzz-primary)]/45 bg-[var(--zzz-primary)]/12 text-[var(--zzz-primary)]">
              <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18" />
                <path d="M3 12h18" />
                <path d="m18.5 4.5 1 1" />
              </svg>
            </span>
            <p className="font-mono text-xs leading-relaxed text-[var(--zzz-text)]/75">
              描述你想创作的画面，或先添加参考图。
            </p>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--zzz-text)]/40">
              成图会自动成为下一轮的上下文，也可从历史结果重新开始。
            </p>
          </div>
        )}

        {messages.map((message) => message.role === 'user' ? (
          <article key={message.id} className="ml-auto flex max-w-[88%] flex-col items-end gap-1.5">
            <div className="rounded-2xl rounded-br-md border border-[var(--zzz-primary)]/45 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--zzz-primary)_80%,#1c1730),color-mix(in_srgb,var(--zzz-magenta)_48%,#171221))] px-3.5 py-2.5 font-mono text-xs leading-relaxed text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--zzz-primary)_28%,transparent)]">
              {message.prompt}
            </div>
            {message.references.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {message.references.map((reference) => (
                  <img
                    key={reference.id}
                    src={reference.dataUrl}
                    alt={reference.name}
                    className="h-14 w-14 rounded-lg border border-[var(--zzz-primary)]/35 object-cover"
                  />
                ))}
              </div>
            )}
            {message.status === 'sending' && (
              <span className="font-mono text-[10px] text-[var(--zzz-text)]/45">正在生成</span>
            )}
            {message.status === 'error' && (
              <span className="font-mono text-[10px] text-red-300">{message.error ?? '生成失败'}</span>
            )}
          </article>
        ) : (
          <article key={message.id} className="mr-auto max-w-[94%]">
            <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] text-[var(--zzz-cyan)]/90">
              <span className="h-px w-4 bg-[var(--zzz-cyan)]/60" />
              创作结果
            </div>
            <div className="grid grid-cols-1 gap-2">
              {message.images.map((image, index) => {
                const selected = contextImageUrl === image;
                return (
                  <figure
                    key={`${message.id}-${index}`}
                    className={`overflow-hidden rounded-xl border bg-black/20 ${selected ? 'border-[var(--zzz-primary)] shadow-[0_0_18px_color-mix(in_srgb,var(--zzz-primary)_36%,transparent)]' : 'border-[var(--zzz-text)]/16'}`}
                  >
                    <button
                      type="button"
                      onClick={() => selectContextImage(image)}
                      className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-[var(--zzz-primary)]"
                      aria-label="使用此图继续创作"
                    >
                      <img src={image} alt={`自由创作结果 ${index + 1}`} className="max-h-72 w-full object-contain" loading="lazy" />
                    </button>
                    <figcaption className="flex items-center justify-between gap-2 border-t border-[var(--zzz-text)]/10 px-2 py-2">
                      <span className={`font-mono text-[10px] ${selected ? 'text-[var(--zzz-primary)]' : 'text-[var(--zzz-text)]/45'}`}>
                        {selected ? '当前上下文' : '历史结果'}
                      </span>
                      <span className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => selectContextImage(image)}
                          className="glass-btn px-2 py-1 font-mono text-[10px] text-[var(--zzz-primary)]"
                        >
                          以此继续
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadImage(image, `free-create-${index + 1}.png`)}
                          className="glass-btn px-2 py-1 font-mono text-[10px] text-[var(--zzz-text)]/80"
                        >
                          下载
                        </button>
                      </span>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </article>
        ))}

        {isGenerating && (
          <div aria-live="polite" className="mr-auto flex items-center gap-2 rounded-xl border border-[var(--zzz-text)]/12 bg-black/15 px-3 py-2 font-mono text-[10px] text-[var(--zzz-text)]/60">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--zzz-primary)]/25 border-t-[var(--zzz-primary)]" />
            正在生成新的画面
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--zzz-text)]/12 bg-black/20 p-3">
        {draftReferences.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {draftReferences.map((reference) => (
              <div key={reference.id} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-[var(--zzz-text)]/20">
                <img src={reference.dataUrl} alt={reference.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeDraftReference(reference.id)}
                  aria-label={`移除参考图 ${reference.name}`}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/75 text-[10px] text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mb-2 flex items-center justify-between gap-3 font-mono text-[10px] text-[var(--zzz-text)]/45">
          <span>{contextImageUrl ? '将基于当前成图继续修改' : '可直接文字创作或添加参考图'}</span>
          <span>参考图 {draftReferences.length}/{maxReferences}</span>
        </div>
        <div className="flex items-end gap-2 rounded-2xl border border-[var(--zzz-text)]/18 bg-[var(--zzz-ink)]/55 p-2 shadow-inner">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={isGenerating || maxReferences === 0 || draftReferences.length >= maxReferences}
            onClick={() => fileInputRef.current?.click()}
            title={maxReferences === 0 ? '当前模型无法在已有图像上下文上附加更多参考图' : '添加参考图'}
            aria-label="添加参考图"
            className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center p-0 text-[var(--zzz-cyan)] disabled:cursor-not-allowed"
          >
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <textarea
            ref={promptRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={1}
            placeholder={contextImageUrl ? '直接说明下一步如何修改…' : '描述想要创作的画面…'}
            className="min-h-9 max-h-28 flex-1 resize-none bg-transparent px-1 py-2 font-mono text-xs leading-relaxed text-[var(--zzz-text)] placeholder:text-[var(--zzz-text)]/35 focus:outline-none"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
          />
          <button
            type="button"
            disabled={isGenerating || !draft.trim()}
            onClick={() => void handleSend()}
            aria-label="发送创作请求"
            className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center p-0 text-[var(--zzz-primary)] disabled:cursor-not-allowed"
          >
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="m4 4 16 8-16 8 3-8-3-8Z" />
              <path d="M7 12h13" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
});

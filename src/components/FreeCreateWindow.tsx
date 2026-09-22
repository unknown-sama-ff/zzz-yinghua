import { memo, useCallback, useEffect, useRef } from 'react';
import { ApiError, generate } from '../lib/apiClient';
import { buildFreeCreateRequest, MAX_FREE_CREATE_IMAGES, MAX_FREE_CREATE_REFERENCES, MIN_FREE_CREATE_IMAGES } from '../lib/freeCreate';
import { downloadImage } from '../lib/download';
import { fileToDataUrl, validateImageFile } from '../lib/validation';
import { activeSession, useFreeCreateStore } from '../store/useFreeCreateStore';
import { useIdentityStore } from '../store/useIdentityStore';
import { useInpaintStore } from '../store/useInpaintStore';
import { useProviderStore } from '../store/useProviderStore';
import { useToast } from '../store/useToast';
import { useViewerStore } from '../store/useViewerStore';
import { GallerySaveButton } from './GallerySaveButton';
import type { FreeCreateReference } from '../types';

export const FreeCreateWindow = memo(function FreeCreateWindow() {
  const isOpen = useFreeCreateStore((state) => state.isOpen);
  const sessions = useFreeCreateStore((state) => state.sessions);
  const activeSessionId = useFreeCreateStore((state) => state.activeSessionId);
  const session = useFreeCreateStore(activeSession);
  const isGenerating = useFreeCreateStore((state) => state.isGenerating);
  const close = useFreeCreateStore((state) => state.close);
  const newConversation = useFreeCreateStore((state) => state.newConversation);
  const selectSession = useFreeCreateStore((state) => state.selectSession);
  const setDraft = useFreeCreateStore((state) => state.setDraft);
  const addDraftReferences = useFreeCreateStore((state) => state.addDraftReferences);
  const removeDraftReference = useFreeCreateStore((state) => state.removeDraftReference);
  const selectContextImage = useFreeCreateStore((state) => state.selectContextImage);
  const setImageCount = useFreeCreateStore((state) => state.setImageCount);
  const beginGeneration = useFreeCreateStore((state) => state.beginGeneration);
  const completeGeneration = useFreeCreateStore((state) => state.completeGeneration);
  const failGeneration = useFreeCreateStore((state) => state.failGeneration);
  const gptCredentials = useProviderStore((state) => state.creds['gpt-image']);
  const freeloadEnabled = useProviderStore((state) => state.freeloadEnabled);
  const characterName = useIdentityStore((state) => state.characterName);
  const showError = useToast((state) => state.show);
  const isWorkspaceOpen = useInpaintStore((state) => state.isWorkspaceOpen);
  const viewerFullscreen = useViewerStore((state) => state.viewerFullscreen);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldAvoidFullscreen = isWorkspaceOpen || viewerFullscreen;
  const { draft, draftReferences, messages, contextImageUrl, imageCount } = session;

  useEffect(() => {
    if (!isOpen || shouldAvoidFullscreen) return;
    promptRef.current?.focus();
  }, [isOpen, shouldAvoidFullscreen, activeSessionId]);

  useEffect(() => {
    if (!isOpen || shouldAvoidFullscreen) return;
    const list = messageListRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [isOpen, shouldAvoidFullscreen, activeSessionId, messages.length, isGenerating]);

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
    const availableSlots = MAX_FREE_CREATE_REFERENCES - draftReferences.length;
    if (availableSlots <= 0 || selected.length > availableSlots) {
      showError(`单轮最多支持 ${MAX_FREE_CREATE_REFERENCES} 张参考图`);
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
  }, [addDraftReferences, draftReferences.length, showError]);

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
        imageCount,
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : '参考图准备失败');
      return;
    }

    if (freeloadEnabled && imageCount > 1) {
      showError('服务端预设通道每轮固定生成 1 张，填写自己的 API Key 后可生成多张');
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
  }, [beginGeneration, completeGeneration, contextImageUrl, draft, draftReferences, failGeneration, freeloadEnabled, gptCredentials, imageCount, showError]);

  if (!isOpen || shouldAvoidFullscreen) return null;

  return (
    <section
      id="free-create-window"
      role="dialog"
      aria-modal="false"
      aria-labelledby="free-create-title"
      // bottom-28 clears the fixed 白嫖作者 / 特效 buttons in the lower-right corner,
      // and z-[10002] keeps this above them (they sit at z-[10001]).
      className="glass fixed bottom-28 right-4 top-4 z-[10002] flex w-[calc(100%-2rem)] max-w-[440px] flex-col overflow-hidden sm:right-6 sm:top-6"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zzz-text/12 bg-black/15 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zzz-primary/50 bg-zzz-primary/15 text-zzz-primary">
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18" />
                <path d="M3 12h18" />
                <path d="m18.5 4.5 1 1" />
              </svg>
            </span>
            <h2 id="free-create-title" className="zzz-heading text-lg text-zzz-text">
              自由创作
            </h2>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-zzz-text/55">
            关闭或新建后保留会话，刷新页面后清空
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={newConversation}
            disabled={isGenerating}
            className="glass-btn px-2.5 py-1.5 font-mono text-xs text-zzz-cyan disabled:opacity-40"
          >
            新建
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="收起自由创作"
            className="glass-btn flex h-8 w-8 items-center justify-center p-0 text-zzz-text/75"
          >
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </header>

      {sessions.length > 1 && (
        <div className="shrink-0 border-b border-zzz-text/12 bg-black/10 px-3 py-2">
          <div className="mb-1 font-mono text-xs text-zzz-text/45">会话 · 点击可切回</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {sessions.map((item, index) => {
              const current = item.id === activeSessionId;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => selectSession(item.id)}
                  aria-current={current}
                  className={`glass-btn shrink-0 px-2.5 py-1 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                    current ? 'text-zzz-primary' : 'text-zzz-text/60'
                  }`}
                  data-active={current}
                >
                  会话 {index + 1}
                  {item.messages.length === 0 ? ' · 空' : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div ref={messageListRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-zzz-primary/45 bg-zzz-primary/12 text-zzz-primary">
              <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18" />
                <path d="M3 12h18" />
                <path d="m18.5 4.5 1 1" />
              </svg>
            </span>
            <p className="text-sm leading-relaxed text-zzz-text/80">
              描述你想创作的画面，或先添加参考图。
            </p>
            <p className="mt-2 font-mono text-xs leading-relaxed text-zzz-text/45">
              成图会自动成为下一轮的上下文，也可从历史结果重新开始。
            </p>
          </div>
        )}

        {messages.map((message) => message.role === 'user' ? (
          <article key={message.id} className="ml-auto flex max-w-[88%] flex-col items-end gap-1.5">
            <div className="rounded-2xl rounded-br-md border border-zzz-primary/45 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--zzz-primary)_80%,#1c1730),color-mix(in_srgb,var(--zzz-magenta)_48%,#171221))] px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--zzz-primary)_28%,transparent)]">
              {message.prompt}
            </div>
            {message.references.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {message.references.map((reference) => (
                  <img
                    key={reference.id}
                    src={reference.dataUrl}
                    alt={reference.name}
                    className="h-14 w-14 rounded-lg border border-zzz-primary/35 object-cover"
                  />
                ))}
              </div>
            )}
            {message.status === 'sending' && (
              <span className="font-mono text-xs text-zzz-text/45">正在生成</span>
            )}
            {message.status === 'error' && (
              <span className="font-mono text-xs text-red-300">{message.error ?? '生成失败'}</span>
            )}
          </article>
        ) : (
          <article key={message.id} className="mr-auto max-w-[94%]">
            <div className="mb-1.5 flex items-center gap-2 font-mono text-xs text-zzz-cyan/90">
              <span className="h-px w-4 bg-zzz-cyan/60" />
              创作结果
            </div>
            <div className="grid grid-cols-1 gap-2">
              {message.images.map((image, index) => {
                const selected = contextImageUrl === image;
                return (
                  <figure
                    key={`${message.id}-${index}`}
                    className={`overflow-hidden rounded-xl border bg-black/20 ${selected ? 'border-zzz-primary shadow-[0_0_18px_color-mix(in_srgb,var(--zzz-primary)_36%,transparent)]' : 'border-zzz-text/16'}`}
                  >
                    <button
                      type="button"
                      onClick={() => selectContextImage(image)}
                      className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-zzz-primary"
                      aria-label="使用此图继续创作"
                    >
                      <img src={image} alt={`自由创作结果 ${index + 1}`} className="max-h-72 w-full object-contain" loading="lazy" />
                    </button>
                    <figcaption className="flex items-center justify-between gap-2 border-t border-zzz-text/10 px-2 py-2">
                      <span className={`font-mono text-xs ${selected ? 'text-zzz-primary' : 'text-zzz-text/45'}`}>
                        {selected ? '当前上下文' : '历史结果'}
                      </span>
                      <span className="flex gap-1.5">
                        <GallerySaveButton
                          saveInfo={{
                            imageUrl: image,
                            style: '自由创作',
                            characterName,
                            prompt: message.prompt,
                            provider: 'gpt-image',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => selectContextImage(image)}
                          className="glass-btn px-2 py-1 font-mono text-xs text-zzz-primary"
                        >
                          以此继续
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadImage(image, `free-create-${index + 1}.png`)}
                          className="glass-btn px-2 py-1 font-mono text-xs text-zzz-text/80"
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
          <div aria-live="polite" className="mr-auto flex items-center gap-2 rounded-xl border border-zzz-text/12 bg-black/15 px-3 py-2 font-mono text-xs text-zzz-text/60">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zzz-primary/25 border-t-zzz-primary" />
            正在生成新的画面
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-zzz-text/12 bg-black/20 p-3">
        {draftReferences.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {draftReferences.map((reference) => (
              <div key={reference.id} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-zzz-text/20">
                <img src={reference.dataUrl} alt={reference.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeDraftReference(reference.id)}
                  aria-label={`移除参考图 ${reference.name}`}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/75 text-xs text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mb-2 flex items-center justify-between gap-3 font-mono text-xs text-zzz-text/45">
          <span>{contextImageUrl ? '将基于当前成图继续修改' : '可直接文字创作或添加参考图'}</span>
          <span>参考图 {draftReferences.length}/{MAX_FREE_CREATE_REFERENCES}</span>
        </div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-zzz-text/45">
            生成数量{freeloadEnabled ? '（预设通道固定 1 张）' : ''}
          </span>
          <div className="flex items-center gap-2 rounded-full border border-zzz-text/18 bg-zzz-ink/50 px-1 py-1">
            <button
              type="button"
              onClick={() => setImageCount(imageCount - 1)}
              disabled={isGenerating || imageCount <= MIN_FREE_CREATE_IMAGES}
              aria-label="减少生成数量"
              className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold text-zzz-text/80 transition hover:bg-zzz-text/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              −
            </button>
            <span className="w-4 text-center font-mono text-xs text-zzz-text">{imageCount}</span>
            <button
              type="button"
              onClick={() => setImageCount(imageCount + 1)}
              disabled={isGenerating || imageCount >= MAX_FREE_CREATE_IMAGES}
              aria-label="增加生成数量"
              className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold text-zzz-text/80 transition hover:bg-zzz-text/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex items-end gap-2 rounded-2xl border border-zzz-text/18 bg-zzz-ink/55 p-2 shadow-inner">
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
            disabled={isGenerating || draftReferences.length >= MAX_FREE_CREATE_REFERENCES}
            onClick={() => fileInputRef.current?.click()}
            title="添加参考图"
            aria-label="添加参考图"
            className="glass-btn flex h-10 w-10 shrink-0 items-center justify-center p-0 text-zzz-cyan disabled:cursor-not-allowed"
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
            className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-relaxed text-zzz-text placeholder:text-zzz-text/35 focus:outline-none"
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
            className="glass-btn flex h-10 w-10 shrink-0 items-center justify-center p-0 text-zzz-primary disabled:cursor-not-allowed"
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

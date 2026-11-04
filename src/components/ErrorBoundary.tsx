import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Lightweight React Error Boundary.
 * Catches render-phase errors in children and displays a fallback UI
 * instead of crashing the entire app tree.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const moduleLoadFailed = /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|chunkloaderror/i.test(this.state.error?.message ?? '');
      return (
        <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-red-500/30 bg-red-500/5 p-8">
          <div className="text-center">
            <p className="font-mono text-sm text-red-400">{moduleLoadFailed ? '页面资源暂时无法加载' : '⚠ 组件渲染出错'}</p>
            <p className="mt-2 font-mono text-xs text-red-400/60">
              {moduleLoadFailed ? '请检查网络。刷新页面前，请等待生图结束，并保存需要的内容。' : this.state.error?.message ?? '未知错误'}
            </p>
            {moduleLoadFailed && <details className="mt-2 max-w-lg break-all font-mono text-xs text-red-400/60"><summary>错误详情</summary><p>{this.state.error?.message}</p></details>}
            <button
              onClick={() => moduleLoadFailed ? window.location.reload() : this.setState({ hasError: false, error: null })}
              className="mt-4 glass-btn px-4 py-1.5 font-mono text-xs text-red-400"
            >
              {moduleLoadFailed ? '刷新页面加载最新版' : '重试'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

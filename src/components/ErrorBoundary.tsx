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
      return (
        <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-red-500/30 bg-red-500/5 p-8">
          <div className="text-center">
            <p className="font-mono text-sm text-red-400">⚠ 组件渲染出错</p>
            <p className="mt-2 font-mono text-xs text-red-400/60">
              {this.state.error?.message ?? '未知错误'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-4 glass-btn px-4 py-1.5 font-mono text-xs text-red-400"
            >
              重试
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

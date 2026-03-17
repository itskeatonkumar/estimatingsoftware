import React from 'react';

/**
 * ErrorBoundary — catches React render errors and shows a recovery UI
 * instead of white-screening the entire app.
 * 
 * Usage: wrap any feature section that might crash independently:
 *   <ErrorBoundary feature="Takeoff Workspace">
 *     <TakeoffWorkspace />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log to console in dev, could send to Sentry/LogRocket in prod
    console.error(`[ErrorBoundary] ${this.props.feature || 'Unknown'} crashed:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', padding: 40, textAlign: 'center', background: 'var(--bg)', color: 'var(--tx)',
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, fontFamily: "'Syne', sans-serif" }}>
            {this.props.feature || 'This section'} encountered an error
          </h2>
          <p style={{ fontSize: 13, color: 'var(--tx3)', maxWidth: 400, marginBottom: 20, lineHeight: 1.6 }}>
            Something went wrong. Your data has been saved. Try refreshing the page or going back.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
              style={{
                background: '#10B981', border: 'none', color: '#fff', padding: '8px 20px',
                borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}>
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'none', border: '1px solid var(--bd2)', color: 'var(--tx3)',
                padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
              }}>
              Reload Page
            </button>
          </div>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details style={{ marginTop: 20, textAlign: 'left', maxWidth: 600, width: '100%' }}>
              <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--tx4)' }}>Error details</summary>
              <pre style={{
                fontSize: 10, color: '#EF4444', background: 'var(--bg3)', padding: 12,
                borderRadius: 6, overflow: 'auto', maxHeight: 200, marginTop: 8,
                fontFamily: "'DM Mono', monospace",
              }}>
                {this.state.error.toString()}
                {'\n\n'}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;

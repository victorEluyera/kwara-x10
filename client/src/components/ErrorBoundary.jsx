import React from 'react';

/**
 * Without this, any unhandled render error anywhere in the tree (a null
 * field on an unexpected API shape, a bad prop) blanks the entire app to a
 * white screen for that user, with no way back except knowing to hit
 * refresh. On a launch night with real field agents on real phones, that is
 * not an acceptable failure mode -- this at least gives them a way out and
 * a chance to tell someone what happened.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  reload = () => {
    this.setState({ error: null });
    window.location.href = '/';
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: '#f6f7f2', padding: 24, fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <div style={{
          maxWidth: 420, textAlign: 'center', background: '#fff',
          border: '1px solid #dde2d6', borderRadius: 12, padding: 32,
          boxShadow: '0 14px 38px rgba(6,46,26,.12)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
          <h2 style={{ margin: 0, fontSize: 18, color: '#12180f' }}>
            Something went wrong
          </h2>
          <p style={{ color: '#6d7a67', fontSize: 13.5, marginTop: 10, lineHeight: 1.6 }}>
            This screen hit an unexpected error and could not continue. Your
            work up to this point is safe on the server -- reloading will
            take you back to the dashboard.
          </p>
          <button
            onClick={this.reload}
            style={{
              marginTop: 18, padding: '10px 20px', borderRadius: 7,
              border: 0, background: '#0e4a2b', color: '#fff',
              fontWeight: 600, fontSize: 13.5, cursor: 'pointer',
            }}
          >
            Reload KWARA X10
          </button>
          <div style={{ marginTop: 16, fontSize: 11, color: '#97a192' }}>
            If this keeps happening, tell the programme office what you were
            doing when it appeared.
          </div>
        </div>
      </div>
    );
  }
}

type Event =
  | 'demo_opened'
  | 'session_ready'
  | 'quote_viewed'
  | 'run_started'
  | 'payment_settled'
  | 'result_delivered'
  | 'demo_error'
  | 'agent_setup_opened'
  | 'seller_guide_opened'
  | 'setup_copied';
declare global {
  interface Window {
    agenticAnalytics?: (event: Event, properties: { id?: string; code?: string }) => void;
  }
}
export function track(event: Event, properties: { id?: string; code?: string } = {}, once = false) {
  try {
    const key = `analytics:${event}:${properties.id || ''}`;
    if (once && localStorage.getItem(key)) return;
    if (once) localStorage.setItem(key, '1');
    window.agenticAnalytics?.(event, properties);
  } catch {
    /* Analytics never blocks a purchase or its recovery. */
  }
}

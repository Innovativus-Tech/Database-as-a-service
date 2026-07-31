interface GrafanaPanelProps {
  /** Numeric `id` of the panel inside the dashboard JSON. */
  panelId: number
  /**
   * Dashboard UID. Defaults to the Mongo dashboard so existing call-sites
   * keep working without changes. SQL monitors pass `sqlmon-postgres` /
   * `sqlmon-mysql`.
   */
  dashboardUid?: string
  height?: number
  /** Grafana template variables, applied as `var-<key>=<value>` query params. */
  vars?: Record<string, string>
  /**
   * Auto-refresh cadence. Defaults to 15s to match the Prometheus scrape
   * interval — polling faster cannot surface newer data.
   */
  refreshSeconds?: number
}

/**
 * Single-panel Grafana iframe.
 *
 * Uses Grafana's `/d-solo/<uid>` route which renders just one panel without
 * any of Grafana's chrome. `theme=dark` matches the app theme.
 *
 * Two things here are deliberate, because the Monitor page renders NINE of
 * these at once:
 *
 *  - `loading="lazy"`. Previously all nine fetched the moment the page
 *    mounted, even the ones far below the fold. When Grafana is slow or
 *    unreachable (a misconfigured GRAFANA_PUBLIC_URL, say) all nine hang
 *    until TCP timeout, saturating the browser's per-host connection budget
 *    — which made navigating away from Monitor feel frozen. Lazy loading
 *    means only panels actually scrolled into view are ever requested.
 *
 *  - Refresh defaults to 15s, not 5s. Prometheus scrapes the backend every
 *    15s, so the underlying series cannot change faster than that; polling
 *    at 5s just issued three Grafana + Prometheus queries per panel per
 *    window to re-render identical data. With nine panels that was ~108
 *    requests/minute of pure waste.
 *
 * Framing requires `allow_embedding = true` (set in grafana.ini) and a
 * GRAFANA_PUBLIC_URL the USER'S BROWSER can reach — an internal Docker
 * hostname or localhost will render an empty box.
 */
export function GrafanaPanel({
  panelId,
  dashboardUid = 'mongodb-adv-vis',
  height = 300,
  vars = {},
  refreshSeconds = 15,
}: GrafanaPanelProps) {
  const grafanaUrl = (process.env.NEXT_PUBLIC_GRAFANA_URL ?? 'http://localhost:3003')
  const varString  = Object.entries(vars)
    .map(([k, v]) => `var-${k}=${encodeURIComponent(v)}`)
    .join('&')
  const src = `${grafanaUrl}/d-solo/${dashboardUid}` +
              `?orgId=1&panelId=${panelId}&theme=dark&refresh=${refreshSeconds}s` +
              (varString ? '&' + varString : '')

  return (
    <iframe
      src={src}
      width="100%"
      height={height}
      frameBorder={0}
      loading="lazy"
      style={{ borderRadius: 8 }}
      title={`Grafana panel ${dashboardUid}/${panelId}`}
    />
  )
}

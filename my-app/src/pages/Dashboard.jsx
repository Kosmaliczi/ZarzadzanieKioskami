import { ui } from './uiClasses'
import { useAsync, useKiosks } from '../hooks'

export default function Dashboard() {
  const kioskService = useKiosks()
  const { data: kiosks, loading, error } = useAsync(() => kioskService.getKiosks())

  const kioskList = kiosks || []
  const onlineCount = kioskList.filter((kiosk) => kiosk.status === 'online').length
  const offlineCount = kioskList.length - onlineCount

  return (
    <section id="dashboard" className={`${ui.section} active-section`}>
      <h2 className={ui.sectionTitle}>Dashboard</h2>

      {loading ? <p className={ui.muted}>Ładowanie danych...</p> : null}
      {error ? <p className="text-sm text-red-600">{error.message}</p> : null}

      <div className={ui.gridCards}>
        <div className={`${ui.card} stat-card`}>
          <h3 className={ui.sectionSubtitle}>Wszystkie kioski</h3>
          <div className="mt-2 text-3xl font-bold text-slate-900">{kioskList.length}</div>
        </div>
        <div className={`${ui.card} stat-card`}>
          <h3 className={ui.sectionSubtitle}>Online</h3>
          <div className="mt-2 text-3xl font-bold text-emerald-600">{onlineCount}</div>
        </div>
        <div className={`${ui.card} stat-card`}>
          <h3 className={ui.sectionSubtitle}>Offline</h3>
          <div className="mt-2 text-3xl font-bold text-red-600">{offlineCount}</div>
        </div>
      </div>

      <div className={`${ui.card} recent-activity`}>
        <h3 className={ui.sectionSubtitle}>Ostatnia aktywność</h3>
        <div className="mt-3 space-y-2">
          {kioskList.length === 0 ? (
            <p className={ui.muted}>Brak danych o aktywności</p>
          ) : (
            kioskList.slice(0, 5).map((kiosk) => (
              <p key={kiosk.id} className="text-sm text-slate-700">
                {kiosk.name || `Kiosk #${kiosk.id}`} - {kiosk.status} - {kiosk.last_connection || 'brak danych'}
              </p>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

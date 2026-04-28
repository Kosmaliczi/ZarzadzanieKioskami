import { useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useKiosks } from '../hooks'

const LEVEL_OPTIONS = [
  { value: '', label: 'Wszystkie poziomy' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
]

function directionBadgeClass(direction) {
  switch (String(direction || '').toLowerCase()) {
    case 'sent':
      return 'bg-emerald-100 text-emerald-800 border border-emerald-300'
    case 'received':
      return 'bg-indigo-100 text-indigo-800 border border-indigo-300'
    case 'internal':
      return 'bg-slate-100 text-slate-700 border border-slate-300'
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-300'
  }
}

function directionLabel(direction) {
  switch (String(direction || '').toLowerCase()) {
    case 'sent':
      return 'Wysłane'
    case 'received':
      return 'Odebrane'
    case 'internal':
      return 'Wewnętrzne'
    default:
      return 'Nieznane'
  }
}

function levelBadgeClass(level) {
  switch (String(level || '').toLowerCase()) {
    case 'error':
      return 'bg-red-100 text-red-800 border border-red-300'
    case 'warning':
      return 'bg-amber-100 text-amber-800 border border-amber-300'
    case 'info':
      return 'bg-blue-100 text-blue-800 border border-blue-300'
    case 'debug':
      return 'bg-slate-100 text-slate-700 border border-slate-300'
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-300'
  }
}

function formatDetails(details) {
  if (details == null || details === '') {
    return '-'
  }

  if (typeof details === 'string') {
    return details
  }

  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

export default function KioskErrorLogs() {
  const kioskService = useKiosks()
  const [selectedKioskId, setSelectedKioskId] = useState('')
  const [level, setLevel] = useState('')
  const [limit, setLimit] = useState(200)

  const { data: kiosks } = useAsync(() => kioskService.getKiosks())

  const loadLogsMutation = useMutation(async () => {
    const kioskId = Number(selectedKioskId)
    const filters = {
      limit: Math.min(500, Math.max(1, Number(limit) || 200)),
      ...(selectedKioskId ? { kiosk_id: kioskId } : {}),
      ...(level ? { level } : {}),
    }

    return kioskService.getErrorLogs(filters)
  })

  const logs = loadLogsMutation.data?.logs || []

  return (
    <section id="kioskErrorLogs" className={ui.section}>
      <div className={ui.headerRow}>
        <h2 className={ui.sectionTitle}>Logi aktywności kiosków</h2>
        <span className={ui.muted}>Podgląd wymaga prawa akcji: kiosk.error_logs.view</span>
      </div>

      <p className={ui.muted}>
        Widok obejmuje komunikaty wysłane do kiosku i odebrane z kiosku. Filtr poniżej działa po poziomie komunikatu.
      </p>

      <div className={`${ui.card} grid gap-3 md:grid-cols-4`}>
        <select className={ui.select} value={selectedKioskId} onChange={(event) => setSelectedKioskId(event.target.value)}>
          <option value="">Wszystkie kioski</option>
          {(kiosks || []).map((kiosk) => (
            <option key={kiosk.id} value={kiosk.id}>
              {kiosk.name || `Kiosk #${kiosk.id}`}
            </option>
          ))}
        </select>

        <select className={ui.select} value={level} onChange={(event) => setLevel(event.target.value)}>
          {LEVEL_OPTIONS.map((item) => (
            <option key={item.value || 'all'} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>

        <input
          type="number"
          min="1"
          max="500"
          className={ui.input}
          value={limit}
          onChange={(event) => setLimit(Number(event.target.value))}
          placeholder="Limit (1-500)"
        />

        <button className={ui.btnPrimary} onClick={() => loadLogsMutation.execute()} disabled={loadLogsMutation.loading}>
          {loadLogsMutation.loading ? 'Pobieranie...' : 'Pobierz logi'}
        </button>
      </div>

      {loadLogsMutation.error ? <p className="text-sm text-red-600">{loadLogsMutation.error.message}</p> : null}

      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th className={ui.th}>Data</th>
              <th className={ui.th}>Kiosk</th>
              <th className={ui.th}>Poziom</th>
              <th className={ui.th}>Kierunek</th>
              <th className={ui.th}>Źródło</th>
              <th className={ui.th}>Wiadomość</th>
              <th className={ui.th}>Szczegóły</th>
              <th className={ui.th}>IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td className={ui.td}>{log.created_at}</td>
                <td className={ui.td}>
                  <div className="font-medium text-slate-900">{log.kiosk_name || `Kiosk #${log.kiosk_id}`}</div>
                  <div className="text-xs text-slate-500">{log.serial_number || '-'}</div>
                </td>
                <td className={ui.td}>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${levelBadgeClass(log.level)}`}>
                    {log.level}
                  </span>
                </td>
                <td className={ui.td}>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${directionBadgeClass(log.direction)}`}>
                    {directionLabel(log.direction)}
                  </span>
                </td>
                <td className={ui.td}>{log.source || '-'}</td>
                <td className={ui.td}>{log.message}</td>
                <td className={ui.td}>
                  <pre className="max-w-md whitespace-pre-wrap wrap-break-word text-xs text-slate-700">{formatDetails(log.details)}</pre>
                </td>
                <td className={ui.td}>{log.ip_address || '-'}</td>
              </tr>
            ))}
            {logs.length === 0 ? (
              <tr>
                <td className={ui.td} colSpan={8}>
                  {loadLogsMutation.data ? 'Brak logów dla wybranych filtrów' : 'Kliknij "Pobierz logi", aby załadować dane'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

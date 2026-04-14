import { useEffect, useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useSettings } from '../hooks'

export default function Settings() {
  const settingsService = useSettings()
  const [form, setForm] = useState({
    refreshInterval: 30,
    defaultFtpPort: 21,
    defaultSshPort: 22,
    defaultFtpPath: '/home/kiosk/MediaPionowe',
    defaultFtpUsername: '',
    defaultFtpPassword: '',
    defaultSshUsername: 'root',
  })

  const { data, loading, error, refetch } = useAsync(() => settingsService.getSettings())

  useEffect(() => {
    if (!data) {
      return
    }

    setForm((previous) => ({
      ...previous,
      refreshInterval: Number(data.refreshInterval ?? previous.refreshInterval),
      defaultFtpPort: Number(data.defaultFtpPort ?? previous.defaultFtpPort),
      defaultSshPort: Number(data.defaultSshPort ?? previous.defaultSshPort),
      defaultFtpPath: String(data.defaultFtpPath ?? previous.defaultFtpPath),
      defaultFtpUsername: String(data.defaultFtpUsername ?? previous.defaultFtpUsername),
      defaultFtpPassword: String(data.defaultFtpPassword ?? previous.defaultFtpPassword),
      defaultSshUsername: String(data.defaultSshUsername ?? previous.defaultSshUsername),
    }))
  }, [data])

  const saveMutation = useMutation(() => settingsService.updateSettings(form), {
    onSuccess: async () => {
      await refetch()
    },
  })

  const handleSave = async () => {
    await saveMutation.execute()
  }

  return (
    <section id="settings" className={ui.section}>
      <h2 className={ui.sectionTitle}>Ustawienia</h2>

      {loading ? <p className={ui.muted}>Ładowanie ustawień...</p> : null}
      {error ? <p className="text-sm text-red-600">{error.message}</p> : null}
      {saveMutation.error ? <p className="text-sm text-red-600">{saveMutation.error.message}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className={ui.card}>
          <h3 className={ui.sectionSubtitle}>Ustawienia aplikacji</h3>
          <div className="mt-3 space-y-3">
            <div className={ui.formGroup}>
              <label className={ui.label}>Interwał odświeżania (s)</label>
              <input className={ui.input} type="number" value={form.refreshInterval} onChange={(event) => setForm({ ...form, refreshInterval: Number(event.target.value) })} />
            </div>
          </div>
        </div>

        <div className={ui.card}>
          <h3 className={ui.sectionSubtitle}>Porty</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className={ui.formGroup}>
              <label className={ui.label}>Domyślny port FTP</label>
              <input className={ui.input} type="number" value={form.defaultFtpPort} onChange={(event) => setForm({ ...form, defaultFtpPort: Number(event.target.value) })} />
            </div>
            <div className={ui.formGroup}>
              <label className={ui.label}>Domyślny port SSH</label>
              <input className={ui.input} type="number" value={form.defaultSshPort} onChange={(event) => setForm({ ...form, defaultSshPort: Number(event.target.value) })} />
            </div>
          </div>
        </div>

        <div className={ui.card}>
          <h3 className={ui.sectionSubtitle}>FTP</h3>
          <div className="mt-3 space-y-3">
            <div className={ui.formGroup}>
              <label className={ui.label}>Domyślna ścieżka FTP</label>
              <input className={ui.input} value={form.defaultFtpPath} onChange={(event) => setForm({ ...form, defaultFtpPath: event.target.value })} />
            </div>
            <div className={ui.formGroup}>
              <label className={ui.label}>Domyślny użytkownik FTP</label>
              <input className={ui.input} value={form.defaultFtpUsername} onChange={(event) => setForm({ ...form, defaultFtpUsername: event.target.value })} />
            </div>
            <div className={ui.formGroup}>
              <label className={ui.label}>Domyślne hasło FTP</label>
              <input className={ui.input} type="password" value={form.defaultFtpPassword} onChange={(event) => setForm({ ...form, defaultFtpPassword: event.target.value })} />
            </div>
          </div>
        </div>

        <div className={ui.card}>
          <h3 className={ui.sectionSubtitle}>SSH</h3>
          <div className="mt-3 space-y-3">
            <div className={ui.formGroup}>
              <label className={ui.label}>Domyślny użytkownik SSH</label>
              <input className={ui.input} value={form.defaultSshUsername} onChange={(event) => setForm({ ...form, defaultSshUsername: event.target.value })} />
            </div>
          </div>
        </div>
      </div>

      <button className={ui.btnPrimary} onClick={handleSave} disabled={saveMutation.loading}>
        {saveMutation.loading ? 'Zapisywanie...' : 'Zapisz ustawienia'}
      </button>
    </section>
  )
}

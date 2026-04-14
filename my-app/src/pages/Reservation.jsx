import { useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useReservations } from '../hooks'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export default function Reservation() {
  const reservationService = useReservations()
  const [form, setForm] = useState({
    date: todayIso(),
    start_time: '10:00',
    end_time: '11:00',
    name: '',
    notes: '',
  })
  const [checkResult, setCheckResult] = useState(null)

  const { data: reservations, loading, error, refetch } = useAsync(
    () => reservationService.getReservations({ status: 'active' }),
    { deps: [form.date] }
  )

  const checkMutation = useMutation((payload) => reservationService.checkAvailability(payload), {
    onSuccess: (response) => {
      setCheckResult(response)
    },
  })

  const createMutation = useMutation((payload) => reservationService.createReservation(payload), {
    onSuccess: async () => {
      await refetch()
    },
  })

  const cancelMutation = useMutation((id) => reservationService.cancelReservation(id), {
    onSuccess: async () => {
      await refetch()
    },
  })

  const canCreate = form.name.trim() && form.start_time < form.end_time

  const handleCheck = async () => {
    await checkMutation.execute({
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      name: form.name,
    })
  }

  const handleCreate = async () => {
    await createMutation.execute({
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      name: form.name,
      notes: form.notes,
    })
  }

  const handleCancel = async (id) => {
    if (!window.confirm('Anulować rezerwację?')) {
      return
    }
    await cancelMutation.execute(id)
  }

  const reservationList = reservations || []

  return (
    <section id="reservations" className={ui.section}>
      <div className={ui.headerRow}>
        <h2 className={ui.sectionTitle}>Rezerwacje siłowni</h2>
      </div>

      <div className={ui.card}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className={ui.formGroup}>
            <label className={ui.label}>Data</label>
            <input type="date" className={ui.input} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </div>
          <div className={ui.formGroup}>
            <label className={ui.label}>Od</label>
            <input type="time" className={ui.input} value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} />
          </div>
          <div className={ui.formGroup}>
            <label className={ui.label}>Do</label>
            <input type="time" className={ui.input} value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} />
          </div>
          <div className={ui.formGroup}>
            <label className={ui.label}>Kto rezerwuje</label>
            <input type="text" className={ui.input} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </div>
        </div>

        <div className="mt-3">
          <label className={ui.label}>Notatki</label>
          <textarea className={ui.textarea} rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className={ui.btnSecondary} onClick={handleCheck} disabled={checkMutation.loading || !canCreate}>
            {checkMutation.loading ? 'Sprawdzanie...' : 'Sprawdź termin'}
          </button>
          <button className={ui.btnPrimary} onClick={handleCreate} disabled={createMutation.loading || !canCreate}>
            {createMutation.loading ? 'Zapisywanie...' : 'Zarezerwuj'}
          </button>
        </div>

        {checkResult ? (
          <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
            {checkResult.available ? 'Termin dostępny.' : 'Termin zajęty.'}
          </div>
        ) : null}

        {checkMutation.error ? <p className="mt-2 text-sm text-red-600">{checkMutation.error.message}</p> : null}
        {createMutation.error ? <p className="mt-2 text-sm text-red-600">{createMutation.error.message}</p> : null}
      </div>

      <div className={ui.card}>
        <h3 className={ui.sectionSubtitle}>Aktualne rezerwacje</h3>
        {loading ? <p className={ui.muted}>Ładowanie listy...</p> : null}
        {error ? <p className="text-sm text-red-600">{error.message}</p> : null}
        <div className="mt-3 space-y-2">
          {reservationList.map((reservation) => (
            <div key={reservation.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-800">
                <strong>{reservation.date}</strong> {reservation.start_time}-{reservation.end_time} | {reservation.name}
              </div>
              <button className={ui.btnDanger} onClick={() => handleCancel(reservation.id)} disabled={cancelMutation.loading}>
                Anuluj
              </button>
            </div>
          ))}
          {reservationList.length === 0 ? <p className={ui.muted}>Brak rezerwacji.</p> : null}
        </div>
      </div>
    </section>
  )
}

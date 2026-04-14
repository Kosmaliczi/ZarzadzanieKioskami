import { useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useUsers } from '../hooks'

export default function User() {
  const userService = useUsers()
  const [newUser, setNewUser] = useState({ username: '', password: '' })

  const { data: users, loading, error, refetch } = useAsync(() => userService.getUsers())

  const createMutation = useMutation(() => userService.createUser(newUser), {
    onSuccess: async () => {
      setNewUser({ username: '', password: '' })
      await refetch()
    },
  })

  const deleteMutation = useMutation((id) => userService.deleteUser(id), {
    onSuccess: async () => {
      await refetch()
    },
  })

  const roleMutation = useMutation(({ id, role }) => userService.updateUserRole(id, role), {
    onSuccess: async () => {
      await refetch()
    },
  })

  const handleCreate = async (event) => {
    event.preventDefault()
    await createMutation.execute()
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Usunąć użytkownika?')) {
      return
    }
    await deleteMutation.execute(id)
  }

  const handleToggleRole = async (user) => {
    const nextRole = user.role === 'admin' ? 'user' : 'admin'
    await roleMutation.execute({ id: user.id, role: nextRole })
  }

  const userList = users || []

  return (
    <section id="users" className={ui.section}>
      <h2 className={ui.sectionTitle}>Zarządzanie użytkownikami</h2>

      <form onSubmit={handleCreate} className={`${ui.card} grid gap-3 md:grid-cols-3`}>
        <input
          type="text"
          placeholder="Login"
          value={newUser.username}
          onChange={(event) => setNewUser({ ...newUser, username: event.target.value })}
          className={ui.input}
          required
        />
        <input
          type="password"
          placeholder="Hasło"
          value={newUser.password}
          onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
          className={ui.input}
          required
        />
        <button type="submit" className={ui.btnPrimary} disabled={createMutation.loading}>
          {createMutation.loading ? 'Tworzenie...' : 'Utwórz użytkownika'}
        </button>
      </form>

      {loading ? <p className={ui.muted}>Ładowanie użytkowników...</p> : null}
      {error ? <p className="text-sm text-red-600">{error.message}</p> : null}
      {createMutation.error ? <p className="text-sm text-red-600">{createMutation.error.message}</p> : null}
      {deleteMutation.error ? <p className="text-sm text-red-600">{deleteMutation.error.message}</p> : null}
      {roleMutation.error ? <p className="text-sm text-red-600">{roleMutation.error.message}</p> : null}

      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th className={ui.th}>ID</th>
              <th className={ui.th}>Login</th>
              <th className={ui.th}>Rola</th>
              <th className={ui.th}>Akcje</th>
            </tr>
          </thead>
          <tbody>
            {userList.map((user) => (
              <tr key={user.id}>
                <td className={ui.td}>{user.id}</td>
                <td className={ui.td}>{user.username}</td>
                <td className={ui.td}>{user.role}</td>
                <td className={`${ui.td} flex flex-wrap gap-2`}>
                  <button className={ui.btnSecondary} onClick={() => handleToggleRole(user)} disabled={roleMutation.loading}>
                    Zmień rolę
                  </button>
                  <button className={ui.btnDanger} onClick={() => handleDelete(user.id)} disabled={deleteMutation.loading}>
                    Usuń
                  </button>
                </td>
              </tr>
            ))}
            {userList.length === 0 ? (
              <tr>
                <td className={ui.td} colSpan={4}>Brak użytkowników</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

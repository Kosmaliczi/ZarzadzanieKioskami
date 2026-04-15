import { useState } from 'react'
import { ui } from './uiClasses'
import { useAsync, useMutation, useUsers } from '../hooks'

export default function User() {
  const userService = useUsers()
  const [newUser, setNewUser] = useState({ username: '', password: '' })
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [permissionsDraft, setPermissionsDraft] = useState({})
  const [permissionsInfo, setPermissionsInfo] = useState('')

  const { data: users, loading, error, refetch } = useAsync(() => userService.getUsers())
  const { data: permissionsCatalog, loading: permissionsCatalogLoading, error: permissionsCatalogError } = useAsync(
    () => userService.getPermissionsCatalog()
  )

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

  const loadPermissionsMutation = useMutation((id) => userService.getUserPermissions(id), {
    onSuccess: (permissions) => {
      setPermissionsDraft(permissions || {})
    },
  })

  const savePermissionsMutation = useMutation(({ id, permissions }) => userService.updateUserPermissions(id, permissions), {
    onSuccess: () => {
      setPermissionsInfo('Uprawnienia akcji zapisane pomyślnie')
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

  const handleOpenPermissions = async (user) => {
    setPermissionsInfo('')
    setSelectedUserId(user.id)
    await loadPermissionsMutation.execute(user.id)
  }

  const handlePermissionToggle = (actionKey) => {
    setPermissionsDraft((prev) => ({
      ...prev,
      [actionKey]: !Boolean(prev[actionKey]),
    }))
  }

  const handleSavePermissions = async () => {
    if (!selectedUserId) {
      return
    }
    await savePermissionsMutation.execute({ id: selectedUserId, permissions: permissionsDraft })
  }

  const userList = users || []
  const actionList = permissionsCatalog || []
  const selectedUser = userList.find((item) => item.id === selectedUserId)

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
      {permissionsCatalogError ? <p className="text-sm text-red-600">{permissionsCatalogError.message}</p> : null}
      {loadPermissionsMutation.error ? <p className="text-sm text-red-600">{loadPermissionsMutation.error.message}</p> : null}
      {savePermissionsMutation.error ? <p className="text-sm text-red-600">{savePermissionsMutation.error.message}</p> : null}
      {permissionsInfo ? <p className="text-sm text-blue-700">{permissionsInfo}</p> : null}

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
                  <button className={ui.btn} onClick={() => handleOpenPermissions(user)} disabled={loadPermissionsMutation.loading}>
                    Prawa akcji
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

      <div className={`${ui.card} mt-4 space-y-4`}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Przydzielanie praw do akcji</h3>
          {selectedUser ? <span className="text-sm text-slate-600">Użytkownik: {selectedUser.username}</span> : null}
        </div>

        {!selectedUser ? <p className={ui.muted}>Wybierz "Prawa akcji" przy konkretnym użytkowniku.</p> : null}

        {selectedUser && selectedUser.role === 'admin' ? (
          <p className="text-sm text-amber-700">Administrator ma pełne uprawnienia i nie wymaga dodatkowego przydziału praw akcji.</p>
        ) : null}

        {selectedUser && selectedUser.role !== 'admin' ? (
          <>
            {permissionsCatalogLoading ? <p className={ui.muted}>Ładowanie katalogu akcji...</p> : null}
            <div className="space-y-3">
              {actionList.map((action, index) => (
                <label key={action.key} className="flex items-start gap-3 rounded-lg border border-slate-300 bg-white p-4 cursor-pointer hover:bg-slate-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={Boolean(permissionsDraft[action.key])}
                    onChange={() => handlePermissionToggle(action.key)}
                    className="mt-1 h-5 w-5 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{action.label}</p>
                        <p className="text-xs text-slate-500 mt-1">Kod: <code className="bg-slate-100 px-2 py-1 rounded">{action.key}</code></p>
                      </div>
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-200 text-xs font-medium text-slate-700">
                        {index + 1}
                      </span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button className={ui.btnPrimary} onClick={handleSavePermissions} disabled={savePermissionsMutation.loading}>
                {savePermissionsMutation.loading ? 'Zapisywanie...' : 'Zapisz prawa akcji'}
              </button>
              <span className="text-sm text-slate-600 self-center">
                Wybrano: {Object.values(permissionsDraft).filter(Boolean).length} z {actionList.length}
              </span>
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}

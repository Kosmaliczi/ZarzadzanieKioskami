/**
 * Moduł zarządzania użytkownikami
 */

/**
 * Załaduj i wyświetl listę użytkowników
 */
async function loadUsersList() {
    const listDiv = document.getElementById('users-list');
    const userRole = localStorage.getItem('userRole') || 'user';
    const currentUsername = localStorage.getItem('username') || '';

    try {
        // Pobierz użytkowników z API
        const response = await fetch('/api/users', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) {
            throw new Error(`Nie masz uprawnień do tej sekcji: ${response.status}`);
        }

        const result = await response.json();

        if (result.success && result.users) {
            if (result.users.length === 0) {
                listDiv.innerHTML = `
                    <div class="no-users">
                        <i class="fas fa-user-slash"></i>
                        <p>Brak użytkowników w systemie</p>
                    </div>
                `;
            } else {
                // Generuj HTML dla każdego użytkownika
                listDiv.innerHTML = result.users.map(user => {
                    const isCurrentUser = user.username === currentUsername;
                    
                    // Pokaż selector roli i przycisk usuwania tylko dla administratorów
                    const adminControls = userRole === 'admin' ? `
                        <select class="role-selector" data-id="${user.id}" data-current-role="${user.role}">
                            <option value="user" ${user.role === 'user' ? 'selected' : ''}>Użytkownik</option>
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrator</option>
                        </select>
                        <button class="btn info btn-sm change-password-btn" data-id="${user.id}" data-username="${user.username}" title="Zmień hasło">
                            <i class="fas fa-key"></i> Hasło
                        </button>
                        <button class="btn danger btn-sm delete-user-btn" data-id="${user.id}">
                            <i class="fas fa-trash"></i> Usuń
                        </button>
                    ` : (isCurrentUser ? `
                        <button class="btn info btn-sm change-password-btn" data-id="${user.id}" data-username="${user.username}" title="Zmień swoje hasło">
                            <i class="fas fa-key"></i> Zmień hasło
                        </button>
                    ` : '');
                    
                    return `
                    <div class="user-item" data-id="${user.id}">
                        <div class="user-info">
                            <div class="user-header">
                                <span class="user-login"><i class="fas fa-user-circle"></i> ${user.username}</span>
                                <span class="user-id">#${user.id}</span>
                                ${isCurrentUser ? '<span class="current-user-badge">(To Ty)</span>' : ''}
                            </div>
                            <div class="user-details">
                                <span><i class="fas fa-calendar"></i> Utworzony: ${new Date(user.created_at).toLocaleDateString('pl-PL')}</span>
                                <span class="user-role">
                                    <i class="fas ${user.role === 'admin' ? 'fa-shield-alt' : 'fa-user'}"></i>
                                    Rola: <strong>${user.role === 'admin' ? 'Administrator' : 'Użytkownik'}</strong>
                                </span>
                            </div>
                        </div>
                        <div class="user-actions">
                            ${adminControls}
                        </div>
                    </div>
                `}).join('');

                // Dodaj event listenery do selectów zmiany roli
                document.querySelectorAll('.role-selector').forEach(select => {
                    select.addEventListener('change', async (e) => {
                        const userId = e.currentTarget.getAttribute('data-id');
                        const newRole = e.currentTarget.value;
                        const previousRole = e.currentTarget.getAttribute('data-current-role');
                        
                        if (newRole !== previousRole) {
                            await updateUserRole(userId, newRole);
                        }
                    });
                });

                // Dodaj event listenery do przycisków zmiany hasła
                document.querySelectorAll('.change-password-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const userId = e.currentTarget.getAttribute('data-id');
                        const username = e.currentTarget.getAttribute('data-username');
                        const isOwnPassword = userRole !== 'admin' || username === currentUsername;
                        await openChangePasswordModal(userId, username, isOwnPassword);
                    });
                });

                // Dodaj event listenery do przycisków usuwania
                document.querySelectorAll('.delete-user-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const userId = e.currentTarget.getAttribute('data-id');
                        await deleteUser(userId);
                    });
                });
            }
        } else {
            throw new Error('Nieprawidłowa odpowiedź z serwera');
        }

    } catch (error) {
        console.error('Błąd podczas ładowania użytkowników:', error);
        showToast('Błąd podczas ładowania użytkowników', 'error');
        listDiv.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Błąd: ${error.message}</p>
            </div>
        `;
    }
}

/**
 * Usuń użytkownika
 */
async function deleteUser(userId) {
    // Sprawdź uprawnienia
    if (localStorage.getItem('userRole') !== 'admin') {
        showToast('Brak uprawnień do usuwania użytkowników. Tylko administratorzy mogą to robić.', 'error');
        addActivity('Blokada: Próba usunięcia użytkownika bez uprawnień');
        console.warn('Próba wykonania operacji DELETE User bez uprawnień administratora');
        return;
    }
    
    if (!confirm('Czy na pewno chcesz usunąć tego użytkownika? Ta operacja jest nieodwracalna.')) {
        return;
    }

    try {
        const response = await fetch(`/api/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showToast('Użytkownik został usunięty', 'success');
            addActivity(`Usunięto użytkownika ID: ${userId}`);
            
            // Usuń element z listy wizualnie
            const userElement = document.querySelector(`.user-item[data-id="${userId}"]`);
            if (userElement) {
                userElement.style.opacity = '0.5';
                userElement.style.textDecoration = 'line-through';
                setTimeout(() => {
                    userElement.remove();
                    
                    // Sprawdź czy lista jest pusta
                    const remainingItems = document.querySelectorAll('.user-item');
                    if (remainingItems.length === 0) {
                        document.getElementById('users-list').innerHTML = `
                            <div class="no-users">
                                <i class="fas fa-user-slash"></i>
                                <p>Brak użytkowników w systemie</p>
                            </div>
                        `;
                    }
                }, 500);
            }
        } else {
            throw new Error(result.error || 'Nie udało się usunąć użytkownika');
        }

    } catch (error) {
        console.error('Błąd podczas usuwania użytkownika:', error);
        showToast(`Błąd: ${error.message}`, 'error');
    }
}

/**
 * Zaktualizuj rolę użytkownika
 */
async function updateUserRole(userId, newRole) {
    // Sprawdź uprawnienia
    if (localStorage.getItem('userRole') !== 'admin') {
        showToast('Brak uprawnień do zmiany ról użytkowników. Tylko administratorzy mogą to robić.', 'error');
        addActivity('Blokada: Próba zmiany roli użytkownika bez uprawnień');
        console.warn('Próba wykonania operacji PUT User Role bez uprawnień administratora');
        
        // Przywróć poprzednią wartość w selectcie
        const select = document.querySelector(`.role-selector[data-id="${userId}"]`);
        if (select) {
            select.value = select.getAttribute('data-current-role');
        }
        return;
    }
    
    try {
        const response = await fetch(`/api/users/${userId}/role`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ role: newRole })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showToast(`Rola zmieniona na: ${newRole === 'admin' ? 'Administrator' : 'Użytkownik'}`, 'success');
            addActivity(`Zmieniono rolę użytkownika ID: ${userId} na ${newRole}`);
            
            // Aktualizuj element na liście
            const userElement = document.querySelector(`.user-item[data-id="${userId}"]`);
            if (userElement) {
                const roleSpan = userElement.querySelector('.user-role');
                if (roleSpan) {
                    const roleDisplay = newRole === 'admin' ? 'Administrator' : 'Użytkownik';
                    const roleIcon = newRole === 'admin' ? 'fa-shield-alt' : 'fa-user';
                    roleSpan.innerHTML = `
                        <i class="fas ${roleIcon}"></i>
                        Rola: <strong>${roleDisplay}</strong>
                    `;
                }
            }
            
            // Zaznacz select jako zmieniony
            const select = document.querySelector(`.role-selector[data-id="${userId}"]`);
            if (select) {
                select.setAttribute('data-current-role', newRole);
            }
        } else {
            throw new Error(result.error || 'Nie udało się zmienić roli użytkownika');
        }

    } catch (error) {
        console.error('Błąd podczas zmiany roli użytkownika:', error);
        showToast(`Błąd: ${error.message}`, 'error');
        
        // Przywróć poprzednią wartość w selectcie
        const select = document.querySelector(`.role-selector[data-id="${userId}"]`);
        if (select) {
            select.value = select.getAttribute('data-current-role');
        }
    }
}

/**
 * Otwórz modal do zmiany hasła
 */
async function openChangePasswordModal(userId, username, requireCurrentPassword = true) {
    const modal = document.getElementById('change-password-modal') || await createChangePasswordModal();
    const form = modal.querySelector('#change-password-form');
    const currentPasswordInput = modal.querySelector('#current-password');
    const currentPasswordGroup = modal.querySelector('.current-password-group');
    
    // Jeśli admin zmienia hasło innego użytkownika, nie wymagaj starego hasła
    if (currentPasswordGroup) {
        currentPasswordGroup.style.display = requireCurrentPassword ? 'block' : 'none';
        currentPasswordInput.required = requireCurrentPassword;
    }
    
    // Ustaw tytuł
    const title = modal.querySelector('h3');
    if (title) {
        if (requireCurrentPassword) {
            title.textContent = `Zmień hasło - ${username}`;
        } else {
            title.textContent = `Zmień hasło użytkownika - ${username} (admin)`;
        }
    }
    
    // Zresetuj formularz
    form.reset();
    
    // Ustaw handler dla submit
    form.onsubmit = async (e) => {
        e.preventDefault();
        await changePassword(userId, username, requireCurrentPassword, modal);
    };
    
    // Pokaż modal
    modal.style.display = 'flex';
}

/**
 * Zmień hasło użytkownika
 */
async function changePassword(userId, username, requireCurrentPassword, modal) {
    const form = modal.querySelector('#change-password-form');
    const currentPasswordInput = modal.querySelector('#current-password');
    const newPasswordInput = modal.querySelector('#new-password');
    const confirmPasswordInput = modal.querySelector('#confirm-password');
    const submitBtn = form.querySelector('button[type="submit"]');
    
    // Walidacja
    if (requireCurrentPassword && !currentPasswordInput.value) {
        showToast('Podaj bieżące hasło', 'error');
        return;
    }
    
    if (!newPasswordInput.value) {
        showToast('Podaj nowe hasło', 'error');
        return;
    }
    
    if (!confirmPasswordInput.value) {
        showToast('Potwierdź nowe hasło', 'error');
        return;
    }
    
    if (newPasswordInput.value.length < 6) {
        showToast('Hasło musi mieć co najmniej 6 znaków', 'error');
        return;
    }
    
    if (newPasswordInput.value !== confirmPasswordInput.value) {
        showToast('Nowe hasła do siebie nie pasują', 'error');
        return;
    }
    
    if (requireCurrentPassword && newPasswordInput.value === currentPasswordInput.value) {
        showToast('Nowe hasło musi być inne od bieżącego', 'error');
        return;
    }
    
    try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Zmiana...';
        
        const endpoint = requireCurrentPassword 
            ? '/api/account/change-password'
            : `/api/users/${userId}/change-password`;
        
        const body = requireCurrentPassword
            ? {
                current_password: currentPasswordInput.value,
                new_password: newPasswordInput.value,
                confirm_password: confirmPasswordInput.value
              }
            : {
                new_password: newPasswordInput.value,
                confirm_password: confirmPasswordInput.value
              };
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify(body)
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            showToast('Hasło zostało zmienione pomyślnie', 'success');
            addActivity(`Zmieniono hasło użytkownika ${username}`);
            
            // Zamknij modal
            modal.style.display = 'none';
            form.reset();
        } else {
            throw new Error(result.error || 'Nie udało się zmienić hasła');
        }
    } catch (error) {
        console.error('Błąd podczas zmiany hasła:', error);
        showToast(`Błąd: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Zmień hasło';
    }
}

/**
 * Utwórz modal do zmiany hasła
 */
function createChangePasswordModal() {
    const modal = document.createElement('div');
    modal.id = 'change-password-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Zmień hasło</h3>
                <button class="close-btn" onclick="document.getElementById('change-password-modal').style.display = 'none'">&times;</button>
            </div>
            <form id="change-password-form">
                <div class="form-group current-password-group">
                    <label for="current-password">Bieżące hasło</label>
                    <input type="password" id="current-password" placeholder="Wpisz bieżące hasło" required>
                </div>
                
                <div class="form-group">
                    <label for="new-password">Nowe hasło</label>
                    <input type="password" id="new-password" placeholder="Wpisz nowe hasło (min. 6 znaków)" required>
                </div>
                
                <div class="form-group">
                    <label for="confirm-password">Potwierdź nowe hasło</label>
                    <input type="password" id="confirm-password" placeholder="Potwierdź nowe hasło" required>
                </div>
                
                <div class="modal-actions">
                    <button type="submit" class="btn primary">Zmień hasło</button>
                    <button type="button" class="btn secondary" onclick="document.getElementById('change-password-modal').style.display = 'none'">Anuluj</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Zamknij modal gdy kliknie się poza nim
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
    
    return modal;
}

/**
 * Inicjalizuj funkcjonalność zarządzania użytkownikami
 */
function setupUsers() {
    const createBtn = document.getElementById('create-user-btn');
    const loginInput = document.getElementById('new-user-login');
    const passwordInput = document.getElementById('new-user-password');
    const passwordConfirmInput = document.getElementById('new-user-password-confirm');
    const resultDiv = document.getElementById('create-user-result');
    const statusDiv = document.getElementById('create-user-status');

    // Obsługuj kliknięcie na przycisk tworzenia użytkownika
    createBtn.addEventListener('click', async () => {
        // Sprawdź uprawnienia
        if (localStorage.getItem('userRole') !== 'admin') {
            showToast('Brak uprawnień do tworzenia użytkowników. Tylko administratorzy mogą to robić.', 'error');
            addActivity('Blokada: Próba utworzenia użytkownika bez uprawnień');
            console.warn('Próba wykonania operacji POST Users bez uprawnień administratora');
            return;
        }
        
        const username = loginInput.value.trim();
        const password = passwordInput.value;
        const passwordConfirm = passwordConfirmInput.value;

        // Walidacja
        if (!username || !password || !passwordConfirm) {
            showToast('Wypełnij wszystkie pola', 'error');
            return;
        }

        if (username.length < 3) {
            showToast('Login musi mieć co najmniej 3 znaki', 'error');
            return;
        }

        if (password.length < 6) {
            showToast('Hasło musi mieć co najmniej 6 znaków', 'error');
            return;
        }

        if (password !== passwordConfirm) {
            showToast('Hasła do siebie nie pasują', 'error');
            return;
        }

        try {
            createBtn.disabled = true;
            createBtn.textContent = 'Tworzenie...';

            // Przygotuj dane do wysłania
            const userData = {
                username: username,
                password: password
            };

            // Wysłij zapytanie do API
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify(userData)
            });

            // Sprawdź czy response jest validnym JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error(`API zwróciło nieprawidłową odpowiedź (${response.status}). Endpoint nie istnieje lub serwer zwrócił błąd.`);
            }

            const result = await response.json();

            if (response.ok && result.success) {
                // Użytkownik utworzony pomyślnie
                statusDiv.innerHTML = `
                    <div class="status-success">
                        <i class="fas fa-check-circle"></i>
                        <p><strong>Użytkownik utworzony!</strong></p>
                        <p>Login: <strong>${result.username}</strong></p>
                        <p>${result.message}</p>
                    </div>
                `;
                resultDiv.classList.remove('hidden');

                // Zresetuj formularz
                loginInput.value = '';
                passwordInput.value = '';
                passwordConfirmInput.value = '';

                showToast('Użytkownik został utworzony pomyślnie', 'success');
                addActivity(`Utworzono użytkownika ${result.username}`);
                
                // Załaduj listę użytkowników na nowo
                setTimeout(() => {
                    loadUsersList();
                }, 1000);
            } else {
                // Błąd przy tworzeniu
                statusDiv.innerHTML = `
                    <div class="status-error">
                        <i class="fas fa-exclamation-circle"></i>
                        <p><strong>Błąd tworzenia użytkownika!</strong></p>
                        <p>${result.error || 'Nie udało się utworzyć użytkownika'}</p>
                    </div>
                `;
                resultDiv.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Błąd podczas tworzenia użytkownika:', error);
            statusDiv.innerHTML = `
                <div class="status-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p><strong>Błąd!</strong></p>
                    <p>${error.message}</p>
                </div>
            `;
            resultDiv.classList.remove('hidden');
            showToast('Błąd podczas tworzenia użytkownika', 'error');
        } finally {
            createBtn.disabled = false;
            createBtn.textContent = '+ Utwórz użytkownika';
        }
    });

    // Załaduj listę użytkowników na start
    loadUsersList();
    
    // Utwórz modal do zmiany hasła
    createChangePasswordModal();
}

// Eksportuj funkcję dla głównego pliku
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { setupUsers };
}

/**
 * Moduł obsługi rezerwacji siłowni
 */

/**
 * Załaduj i wyświetl listę rezerwacji
 */
async function loadReservations() {
    const listContainer = document.getElementById('reservations-list-container');
    const listDiv = document.getElementById('reservations-list');
    const showBtn = document.getElementById('show-reservations-btn');

    try {
        showBtn.disabled = true;
        showBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ładowanie...';

        // Pobierz rezerwacje z API
        const response = await fetch('/api/reservations', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) {
            throw new Error(`Błąd pobierania rezerwacji: ${response.status}`);
        }

        const result = await response.json();

        if (result.success && result.reservations) {
            // Wyświetl listę rezerwacji
            if (result.reservations.length === 0) {
                listDiv.innerHTML = `
                    <div class="no-reservations">
                        <i class="fas fa-calendar-times"></i>
                        <p>Brak aktywnych rezerwacji</p>
                    </div>
                `;
            } else {
                // Generuj HTML dla każdej rezerwacji
                listDiv.innerHTML = result.reservations.map(res => `
                    <div class="reservation-item" data-id="${res.id}">
                        <div class="reservation-info">
                            <div class="reservation-header">
                                <span class="reservation-name"><i class="fas fa-user"></i> ${res.name}</span>
                                <span class="reservation-id">#${res.id}</span>
                            </div>
                            <div class="reservation-details">
                                <span><i class="fas fa-calendar"></i> ${res.date}</span>
                                <span><i class="fas fa-clock"></i> ${res.start_time} - ${res.end_time}</span>
                            </div>
                            ${res.notes ? `<div class="reservation-notes"><i class="fas fa-sticky-note"></i> ${res.notes}</div>` : ''}
                            <div class="reservation-meta">
                                <span><i class="fas fa-user-tag"></i> Utworzone przez: ${res.created_by}</span>
                            </div>
                        </div>
                        <div class="reservation-actions">
                            <button class="btn danger btn-sm cancel-reservation-btn" data-id="${res.id}">
                                <i class="fas fa-times"></i> Anuluj
                            </button>
                        </div>
                    </div>
                `).join('');

                // Dodaj event listenery do przycisków anulowania
                document.querySelectorAll('.cancel-reservation-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const reservationId = e.currentTarget.getAttribute('data-id');
                        await cancelReservation(reservationId);
                    });
                });
            }

            // Pokaż kontener z listą
            listContainer.classList.remove('hidden');
            showBtn.innerHTML = '<i class="fas fa-eye-slash"></i> Ukryj rezerwacje';
            
        } else {
            throw new Error('Nieprawidłowa odpowiedź z serwera');
        }

    } catch (error) {
        console.error('Błąd podczas ładowania rezerwacji:', error);
        showToast('Błąd podczas ładowania rezerwacji', 'error');
        listDiv.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Błąd: ${error.message}</p>
            </div>
        `;
        listContainer.classList.remove('hidden');
    } finally {
        showBtn.disabled = false;
    }
}

/**
 * Anuluj rezerwację
 */
async function cancelReservation(reservationId) {
    if (!confirm('Czy na pewno chcesz anulować tę rezerwację?')) {
        return;
    }

    try {
        const response = await fetch(`/api/reservations/${reservationId}/cancel`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showToast('Rezerwacja została anulowana', 'success');
            addActivity(`Anulowano rezerwację #${reservationId}`);
            
            // Usuń element z listy wizualnie
            const reservationElement = document.querySelector(`.reservation-item[data-id="${reservationId}"]`);
            if (reservationElement) {
                reservationElement.style.opacity = '0.5';
                reservationElement.style.textDecoration = 'line-through';
                setTimeout(() => {
                    reservationElement.remove();
                    
                    // Sprawdź czy lista jest pusta
                    const remainingItems = document.querySelectorAll('.reservation-item');
                    if (remainingItems.length === 0) {
                        document.getElementById('reservations-list').innerHTML = `
                            <div class="no-reservations">
                                <i class="fas fa-calendar-times"></i>
                                <p>Brak aktywnych rezerwacji</p>
                            </div>
                        `;
                    }
                }, 500);
            }
        } else {
            throw new Error(result.error || 'Nie udało się anulować rezerwacji');
        }

    } catch (error) {
        console.error('Błąd podczas anulowania rezerwacji:', error);
        showToast(`Błąd: ${error.message}`, 'error');
    }
}

/**
 * Inicjalizuj funkcjonalność rezerwacji
 */
function setupReservations() {
    const checkBtn = document.getElementById('check-reservation-btn');
    const makeBtn = document.getElementById('make-reservation-btn');
    const showReservationsBtn = document.getElementById('show-reservations-btn');
    const reservationDateInput = document.getElementById('reservation-date');
    const reservationResultDiv = document.getElementById('reservation-result');
    const reservationStatusDiv = document.getElementById('reservation-status');
    const listContainer = document.getElementById('reservations-list-container');

    // Ustaw dzisiaj jako minimalną datę
    const today = new Date().toISOString().split('T')[0];
    reservationDateInput.min = today;
    reservationDateInput.value = today;

    // Obsługuj przycisk "Pokaż rezerwacje"
    let reservationsVisible = false;
    showReservationsBtn.addEventListener('click', async () => {
        if (reservationsVisible) {
            // Ukryj listę
            listContainer.classList.add('hidden');
            showReservationsBtn.innerHTML = '<i class="fas fa-list"></i> Pokaż rezerwacje';
            reservationsVisible = false;
        } else {
            // Pokaż i załaduj listę
            await loadReservations();
            reservationsVisible = true;
        }
    });

    // Obsługuj kliknięcie na przycisk sprawdzenia rezerwacji
    checkBtn.addEventListener('click', async () => {
        const date = document.getElementById('reservation-date').value;
        const startTime = document.getElementById('reservation-start').value;
        const endTime = document.getElementById('reservation-end').value;
        const name = document.getElementById('reservation-name').value;

        // Walidacja
        if (!date || !startTime || !endTime || !name) {
            showToast('Wypełnij wszystkie pola', 'error');
            return;
        }

        if (startTime >= endTime) {
            showToast('Godzina rozpoczęcia musi być wcześniejsza niż godzina zakończenia', 'error');
            return;
        }

        try {
            checkBtn.disabled = true;
            checkBtn.textContent = 'Sprawdzanie...';

            // Przygotuj dane do wysłania
            const reservationData = {
                date: date,
                start_time: startTime,
                end_time: endTime,
                name: name
            };

            // Wysłij zapytanie do API
            const response = await fetch('/api/reservations/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify(reservationData)
            });

            // Sprawdź czy response jest validnym JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error(`API zwróciło nieprawidłową odpowiedź (${response.status}). Endpoint nie istnieje lub serwer zwrócił błąd.`);
            }

            const result = await response.json();

            if (response.ok) {
                // Termin jest dostępny
                reservationStatusDiv.innerHTML = `
                    <div class="status-success">
                        <i class="fas fa-check-circle"></i>
                        <p><strong>Termin dostępny!</strong></p>
                        <p>${date} od ${startTime} do ${endTime}</p>
                    </div>
                `;
                reservationResultDiv.classList.remove('hidden');
                makeBtn.classList.remove('hidden');

                addActivity(`Sprawdzono dostępność rezerwacji dla ${name} na ${date} ${startTime}-${endTime}`);
            } else {
                // Termin zajęty
                reservationStatusDiv.innerHTML = `
                    <div class="status-error">
                        <i class="fas fa-times-circle"></i>
                        <p><strong>Termin zajęty!</strong></p>
                        <p>${result.error || 'Wybrany termin nie jest dostępny'}</p>
                        ${result.available_slots ? `<p>Dostępne terminy: ${result.available_slots}</p>` : ''}
                    </div>
                `;
                reservationResultDiv.classList.remove('hidden');
                makeBtn.classList.add('hidden');
            }
        } catch (error) {
            console.error('Błąd podczas sprawdzania rezerwacji:', error);
            reservationStatusDiv.innerHTML = `
                <div class="status-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p><strong>Błąd!</strong></p>
                    <p>${error.message}</p>
                </div>
            `;
            reservationResultDiv.classList.remove('hidden');
            makeBtn.classList.add('hidden');
        } finally {
            checkBtn.disabled = false;
            checkBtn.textContent = '✓ Sprawdź rezerwację';
        }
    });

    // Obsługuj kliknięcie na przycisk zarezerwuj
    makeBtn.addEventListener('click', async () => {
        const date = document.getElementById('reservation-date').value;
        const startTime = document.getElementById('reservation-start').value;
        const endTime = document.getElementById('reservation-end').value;
        const name = document.getElementById('reservation-name').value;

        try {
            makeBtn.disabled = true;
            makeBtn.textContent = 'Rezerwowanie...';

            // Przygotuj dane do wysłania
            const reservationData = {
                date: date,
                start_time: startTime,
                end_time: endTime,
                name: name
            };

            // Wysłij zapytanie do API
            const response = await fetch('/api/reservations/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify(reservationData)
            });

            // Sprawdź czy response jest validnym JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error(`API zwróciło nieprawidłową odpowiedź (${response.status}). Endpoint nie istnieje lub serwer zwrócił błąd.`);
            }

            const result = await response.json();

            if (response.ok) {
                // Rezerwacja pomyślna
                reservationStatusDiv.innerHTML = `
                    <div class="status-success">
                        <i class="fas fa-calendar-check"></i>
                        <p><strong>Rezerwacja potwierdzona!</strong></p>
                        <p>Rezerwacja ID: <strong>${result.reservation_id || 'N/A'}</strong></p>
                        <p>Data: ${date}</p>
                        <p>Godziny: ${startTime} - ${endTime}</p>
                        <p>Rezerwujący: ${name}</p>
                    </div>
                `;
                reservationResultDiv.classList.remove('hidden');
                makeBtn.classList.add('hidden');

                // Zresetuj formularz
                document.getElementById('reservation-date').value = '';
                document.getElementById('reservation-start').value = '';
                document.getElementById('reservation-end').value = '';
                document.getElementById('reservation-name').value = '';

                showToast('Rezerwacja została złożona pomyślnie', 'success');
                addActivity(`Dokonano rezerwacji dla ${name} na ${date} ${startTime}-${endTime}`);
            } else {
                // Błąd przy rezerwacji
                reservationStatusDiv.innerHTML = `
                    <div class="status-error">
                        <i class="fas fa-exclamation-circle"></i>
                        <p><strong>Błąd rezerwacji!</strong></p>
                        <p>${result.error || 'Nie udało się dokonać rezerwacji'}</p>
                    </div>
                `;
                reservationResultDiv.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Błąd podczas tworzenia rezerwacji:', error);
            reservationStatusDiv.innerHTML = `
                <div class="status-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p><strong>Błąd!</strong></p>
                    <p>${error.message}</p>
                </div>
            `;
            reservationResultDiv.classList.remove('hidden');
            showToast('Błąd podczas tworzenia rezerwacji', 'error');
        } finally {
            makeBtn.disabled = false;
            makeBtn.textContent = '+ Zarezerwuj';
        }
    });
}

// Eksportuj funkcję dla głównego pliku
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { setupReservations };
}

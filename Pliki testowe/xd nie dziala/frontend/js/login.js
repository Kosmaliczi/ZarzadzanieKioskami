/**
 * Plik JavaScript do obsługi logowania
 */

// Pobierz elementy DOM
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.querySelector('.login-form');
    const loginBtn = document.getElementById('login-btn');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginError = document.getElementById('login-error');    // Funkcja do weryfikacji logowania poprzez API
    async function verifyLogin(username, password) {
        try {
            const response = await fetch('http://192.168.0.105:5000/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });
            
            return await response.json();
        } catch (error) {
            console.error('Błąd podczas logowania:', error);
            return { success: false, message: 'Błąd serwera, spróbuj ponownie później' };
        }
    }

    // Funkcja do obsługi logowania
    async function handleLogin() {
        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        // Sprawdź czy pola nie są puste
        if (!username || !password) {
            showError("Wypełnij wszystkie pola");
            return;
        }
        
        // Pokazanie wskaźnika ładowania
        loginBtn.disabled = true;
        loginBtn.textContent = 'Logowanie...';
        
        // Weryfikacja danych logowania przez API
        const result = await verifyLogin(username, password);
        
        // Przywrócenie stanu przycisku
        loginBtn.disabled = false;
        loginBtn.textContent = 'Zaloguj';
        
        if (result.success) {
            // Zapisz informację o zalogowaniu
            localStorage.setItem('isLoggedIn', 'true');
            localStorage.setItem('username', username);
            
            // Pokazuj komunikat o sukcesie
            showSuccess("Logowanie pomyślne, przekierowywanie...");
            
            // Przekieruj na stronę główną po krótkiej chwili
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 500);
        } else {
            showError("Nieprawidłowa nazwa użytkownika lub hasło");
        }
    }

    // Funkcja do pokazania błędu
    function showError(message) {
        loginError.textContent = message;
        loginError.style.display = 'block';
        loginError.className = 'form-group error-message';
        
        // Dodaj animację shake
        const loginCard = document.querySelector('.login-card');
        loginCard.classList.add('shake');
        
        // Usuń klasę animacji po zakończeniu
        setTimeout(() => {
            loginCard.classList.remove('shake');
        }, 600);
    }
    
    // Funkcja do pokazania sukcesu
    function showSuccess(message) {
        loginError.textContent = message;
        loginError.style.display = 'block';
        loginError.className = 'form-group success-message';
    }

    // Obsługa kliknięcia przycisku Zaloguj
    loginBtn.addEventListener('click', handleLogin);

    // Obsługa naciśnięcia Enter w polach formularza
    usernameInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            passwordInput.focus();
        }
    });

    passwordInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            handleLogin();
        }
    });    // Obsługa pokazywania podpowiedzi
    const hintLink = document.getElementById('show-hint');
    if (hintLink) {
        hintLink.addEventListener('click', function(e) {
            e.preventDefault();
            showHint();
        });
    }

    // Funkcja pokazująca podpowiedź
    function showHint() {
        const hintMessage = `Domyślne dane logowania:
Użytkownik: admin
Hasło: admin123`;
        
        loginError.textContent = hintMessage;
        loginError.style.display = 'block';
        loginError.className = 'form-group hint-message';
    }

    // Sprawdź czy użytkownik jest już zalogowany
    if (localStorage.getItem('isLoggedIn') === 'true') {
        window.location.href = 'index.html';
    } else {
        // Ustaw fokus na polu nazwy użytkownika
        usernameInput.focus();
    }
});

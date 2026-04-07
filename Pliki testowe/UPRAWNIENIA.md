# System uprawnień użytkowników

## Przegląd

System operacyjny implementuje dwupoziomowy model uprawnień:

1. **Administrator (admin)** - pełny dostęp do wszystkich funkcji
2. **Użytkownik (user)** - ograniczony dostęp, tylko do funkcji czytania danych

---

## Uprawnienia dla administratorów

✅ Dostęp do WSZYSTKICH funkcji:
- Dashboard
- Zarządzanie kioskami (dodawanie, edytowanie, usuwanie)
- Playlisty
- FTP
- Edytor tekstowy
- Rezerwacje siłowni
- Zarządzanie użytkownikami (dodawanie, usuwanie, zmienianie ról)
- Ustawienia
- SSH/Terminal
- Restart usług
- Obracanie ekranów

---

## Uprawnienia dla zwykłych użytkowników

❌ **Ukryte/zablokowane funkcje:**

### Backend (API)
- **GET /api/settings** - ZABLOKOWANE ❌
- **POST /api/settings** - ZABLOKOWANE ❌
- **POST /api/kiosks** - ZABLOKOWANE (dodawanie kiosku) ❌
- **PUT /api/kiosks/<id>** - ZABLOKOWANE (edytowanie kiosku) ❌
- **DELETE /api/kiosks/<id>** - ZABLOKOWANE (usuwanie kiosku) ❌
- **POST /api/kiosks/<id>/restart-service** - ZABLOKOWANE (restart usługi) ❌
- **POST /api/kiosks/<id>/rotate-display** - ZABLOKOWANE (obrót ekranu) ❌
- **GET /api/users** - ZABLOKOWANE ❌
- **POST /api/users** - ZABLOKOWANE (tworzenie użytkownika) ❌
- **PUT /api/users/<id>/role** - ZABLOKOWANE (zmiana roli) ❌
- **DELETE /api/users/<id>** - ZABLOKOWANE (usuwanie użytkownika) ❌

### Frontend (UI)
- **Sekcja Ustawienia** - ukryta z nawigacji
- **Przycisk "Dodaj kiosk"** - ukryty
- **Przycisk SSH** - ukryty (dostęp do terminala)
- **Przyciski usuwania kiosków** - ukryte
- **Przyciski obrotu ekranu** - ukryte
- **Przyciski restartu usługi** - ukryte
- **Formularz tworzenia użytkownika** - ukryty
- **Selectory zmiany roli użytkownika** - ukryte
- **Przyciski usuwania użytkowników** - ukryte

---

## System autoryzacji

### Logowanie
```javascript
POST /api/auth/login
Odpowiedź:
{
  "success": true,
  "username": "john",
  "role": "admin", // lub "user"
  "token": "jwt_token",
  "message": "Logowanie pomyślne"
}
```

Token JWT zawiera rolę użytkownika i jest przechowywany w `localStorage.userRole`.

### Dekoratory backendowe

#### `@token_required`
- Sprawdza prawidłowość tokenu JWT
- Pozwala na dostęp dla wszystkich zalogowanych użytkowników

#### `@admin_required`
- Sprawdza prawidłowość tokenu JWT
- Sprawdza, czy rola użytkownika to `admin`
- Zwraca błąd 403 Forbidden dla zwykłych użytkowników

Wszystkie "operacyjne" endpointy (modyfikacja, usuwanie) wymagają `@admin_required`.

---

## Przechowywanie roli

### LocalStorage
```javascript
localStorage.setItem('userRole', 'admin'); // lub 'user'
```

### JWT Token
```python
{
  'username': 'john',
  'role': 'admin',
  'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
}
```

---

## Wylogowanie

Przy wylogowaniu usuwane są:
- `localStorage.isLoggedIn`
- `localStorage.username`
- `localStorage.userRole`
- `localStorage.authToken`

---

## Domyślne role

- Nowo utworzeni użytkownicy podstawą otrzymują rolę `user`
- Rolę można zmienić z panelu administracyjnego (tylko dla administratorów)

---

## Zmiana roli użytkownika

```bash
PUT /api/users/<user_id>/role
Content-Type: application/json
Authorization: Bearer <admin_token>

{
  "role": "admin"  // lub "user"
}
```

---

## Bezpieczeństwo

✅ **Implementowane mechanizmy:**
1. Weryfikacja JWT w każdym żądaniu
2. Sprawdzanie roli na backendzie
3. Ukrywanie elementów UI dla brakujących uprawnień
4. Blokada dostępu na poziomie API (błąd 403)
5. Logowanie operacyjne ważnych akcji

---

## Tabelaryczne podsumowanie uprawnień

| Operacja | Użytkownik (user) | Administrator (admin) |
|----------|:-:|:-:|
| Podgląd dashboard | ✅ | ✅ |
| Podgląd kiosków | ✅ | ✅ |
| Dodawanie kiosków | ❌ | ✅ |
| Edytowanie kiosków | ❌ | ✅ |
| Usuwanie kiosków | ❌ | ✅ |
| SSH/Terminal | ❌ | ✅ |
| Restart usługi | ❌ | ✅ |
| Obrót ekranu | ❌ | ✅ |
| Podgląd playlisty | ✅ | ✅ |
| Edytowanie playlisty | ? | ✅ |
| FTP | ? | ✅ |
| Edytor tekstowy | ? | ✅ |
| Rezerwacje siłowni | ✅ | ✅ |
| Podgląd użytkowników | ❌ | ✅ |
| Tworzenie użytkowników | ❌ | ✅ |
| Usuwanie użytkowników | ❌ | ✅ |
| Zmiana ról użytkowników | ❌ | ✅ |
| Dostęp do ustawień | ❌ | ✅ |
| Edycja ustawień | ❌ | ✅ |


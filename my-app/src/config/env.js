// Domyślnie używamy same-origin. W dev Vite proxy przekieruje /api na backend.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

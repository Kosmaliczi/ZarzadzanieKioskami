import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ApiProvider } from './hooks'
import { API_BASE_URL } from './config/env'
import './index.css'


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ApiProvider baseUrl={API_BASE_URL}>
      <App />
    </ApiProvider>
  </React.StrictMode>
)
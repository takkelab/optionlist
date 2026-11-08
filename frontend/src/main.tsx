import axios from 'axios'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './styles/global.css'
import { HttpApiClient } from './api/client'
import { AppProviders } from './app/AppProviders'
import { AppRoutes } from './app/AppRoutes'

const api = new HttpApiClient(axios.create({ baseURL: '/api' }))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders api={api} suggestions={api} events={api}>
      {/* 画面の切り替えは startTransition で包まずにすぐ描く。「やりたいこと｜やったこと」を View Transitions で滑らせるとき、
          flushSync の中で切り替えた後の画面を描き終えておかないと、前の画面が撮られる（docs/decisions/0019） */}
      <BrowserRouter useTransitions={false}>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  </StrictMode>,
)

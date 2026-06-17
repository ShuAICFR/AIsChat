import { useParams, Navigate } from 'react-router-dom'

/** 旧路由 /dm/:sessionId → /chat/dm/:sessionId 重定向 */
export default function DMPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  if (sessionId) return <Navigate to={`/chat/dm/${sessionId}`} replace />
  return <Navigate to="/chat" replace />
}

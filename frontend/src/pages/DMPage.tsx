import { useParams } from 'react-router-dom'
import DMChatView from '../components/DMChatView'

export default function DMPage() {
  const { sessionId } = useParams<{ sessionId: string }>()

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center text-textMuted text-sm">
        无效的私信会话
      </div>
    )
  }

  return <DMChatView sessionId={sessionId} />
}

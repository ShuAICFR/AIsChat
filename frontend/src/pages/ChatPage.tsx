import { useParams } from 'react-router-dom'
import ChatArea from '../components/ChatArea'

export default function ChatPage() {
  const { groupId, sessionId } = useParams<{ groupId?: string; sessionId?: string }>()

  return (
    <div className="h-full overflow-hidden">
      <ChatArea
        groupId={groupId ? parseInt(groupId) : null}
        dmSessionId={sessionId || null}
      />
    </div>
  )
}

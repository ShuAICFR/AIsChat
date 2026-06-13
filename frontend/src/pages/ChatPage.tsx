import { useParams, useNavigate } from 'react-router-dom'
import ChatArea from '../components/ChatArea'

export default function ChatPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()

  // 直接派生，URL 是唯一数据源
  const selectedGroupId = groupId ? parseInt(groupId) : null

  const handleSelectGroup = (id: number) => {
    navigate(`/chat/${id}`)
  }

  return (
    <div className="h-full">
      <ChatArea groupId={selectedGroupId} onSelectGroup={handleSelectGroup} />
    </div>
  )
}

'use client'

import { Link } from 'next-view-transitions'
import { SidebarMenuSubButton } from './ui/sidebar'
import { usePathname, useRouter } from 'next/navigation'
import { deleteChat } from '@/actions/delete-chat'
import { Button } from './ui/button'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'

export function SidebarLink(chat: { id: string; title: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault() // Prevent navigation
    setIsDeleting(true)
    try {
      await deleteChat(chat.id)
      router.refresh() // Refresh the page to update the sidebar
    } catch (error) {
      console.error('Failed to delete chat:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <SidebarMenuSubButton
      asChild
      className={`p-1 ${
        pathname.includes(chat.id) ? 'bg-accent' : ''
      } group relative flex items-center justify-between`}
    >
      <Link href={`/app/${chat.id}`} className="w-full h-full" prefetch={true}>
        <span className="truncate">{chat.title}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleDelete}
          disabled={isDeleting}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </Link>
    </SidebarMenuSubButton>
  )
}

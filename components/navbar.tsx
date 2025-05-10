'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AnimatePresence } from 'motion/react'
import { useAppLocalStorage } from '@/hooks/use-app-local-storage'
import { useAppState } from '@/state'
import { SidebarTrigger } from './ui/sidebar'
import { ChatName } from './chat-name'
import { useToast } from '../hooks/use-toast'
import { signOut, useSession } from 'next-auth/react'

export default function Navbar() {
  const { value, setValue } = useAppLocalStorage()
  const chat = useAppState((s) => s.chat)
  const { toast } = useToast()
  const { data: session, status } = useSession()

  return (
    <AnimatePresence>
      <nav className="w-full p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SidebarTrigger />
          {chat && <ChatName id={chat.id} initialName={chat.name} />}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={'ghost'}
            onClick={() => {
              const email = 'tony@fuzati.com'
              try {
                navigator.clipboard.writeText(email)
                toast({
                  title: 'Email copied to clipboard',
                  description: 'You can send feedback to this email',
                })
              } catch (error) {
                toast({
                  title: 'Error copying email',
                  description: `Send me feedback at: ${email}`,
                })
              }
            }}
          >
            Feedback
          </Button>
          
          {value.connectionString && (
            <AnimatePresence>
              <Button
                variant="secondary"
                onClick={() =>
                  setValue((prev) => ({
                    ...prev,
                    connectionString: '',
                  }))
                }
              >
                Change Database
              </Button>
            </AnimatePresence>
          )}
          
          {status === 'loading' ? (
            <Button variant="ghost" disabled>Loading...</Button>
          ) : session ? (
            <>
              {session.user?.name && (
                <span className="text-sm mr-2">
                  {session.user.name}
                </span>
              )}
              <Button 
                variant="ghost" 
                onClick={() => {
                  setValue({
                    connectionString: '',
                    openaiApiKey: '',
                    model: 'gpt-4o-mini',
                  })
                  signOut({ callbackUrl: '/' })
                }}
              >
                Logout
              </Button>
            </>
          ) : (
            <Link href="/login">
              <Button>Login</Button>
            </Link>
          )}
        </div>
      </nav>
    </AnimatePresence>
  )
}

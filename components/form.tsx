'use client'

import React, { useCallback, useRef, useState } from 'react'

import { FlipWords } from './flipping-words'
import { motion } from 'motion/react'

import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { SubmitButton } from './submit-button'

type Props = {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  showSQL: boolean
  onToggleShowSQL: (show: boolean) => void
}

export function Form({ onChange, onSubmit, value, showSQL, onToggleShowSQL }: Props) {
  const [focused, setFocused] = useState(false)
  const [conversationStarted, setConversationStarted] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const submit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (!value) return

      if (!conversationStarted) {
        setConversationStarted(true)
      }
      onSubmit(e)
      inputRef.current?.focus()
    },
    [value, conversationStarted, onSubmit]
  )

  const animationRef = useRef<HTMLDivElement | null>(null)

  const searchs = [
    'What is the average knowledge score by school?',
    'Which questions were answered most correctly?',
    'What is the average score for students who attend mass?',
    'Show me the knowledge scores by grade level',
  ]

  const handleResize = useCallback(() => {
    if (animationRef.current && inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 124)}px`

      if (
        Math.abs(
          animationRef.current.offsetHeight - inputRef.current.offsetHeight
        ) > 10
      ) {
        animationRef.current.style.height = `${inputRef.current.offsetHeight - 10}px`
      }
    }
  }, [animationRef, inputRef])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submit(e as any)
    handleResize()
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-4xl mx-auto relative">
      <div className="relative">
        {value || conversationStarted ? null : (
          <div className="absolute left-4  top-4 pointer-events-none text-muted-foreground">
            <FlipWords words={searchs} />
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, scale: 1 }}
          animate={{
            opacity: focused ? 1 : 0,
            scale: focused ? 1 : 0.98,
          }}
          transition={{
            duration: 0.2,
            ease: 'easeInOut',
          }}
          className="absolute inset-0 blur-md bg-primary/5 rounded-lg pointer-events-none"
          ref={animationRef}
        />

        <Textarea
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          ref={inputRef}
          onChange={(e) => {
            onChange(e)
            handleResize()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
          placeholder={
            conversationStarted ? 'Ask anything...' : ''
          }
          value={value}
          className="resize-none w-full p-4 rounded-lg min-h-[56px] focus:ring-2 focus:ring-primary/20 transition-all duration-200"
        />
      </div>
      
      <div className="flex justify-between items-center mt-2">
        <div className="flex items-center space-x-2">
          <Switch 
            id="show-sql"
            checked={showSQL}
            onCheckedChange={onToggleShowSQL}
          />
          <Label htmlFor="show-sql" className="text-sm text-muted-foreground">
            Show SQL
          </Label>
        </div>
        
        <SubmitButton
          disabled={!value.trim()}
          className="btn-gradient"
        >
          Send
        </SubmitButton>
      </div>
    </form>
  )
}

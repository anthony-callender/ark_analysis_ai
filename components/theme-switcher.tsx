'use client'

import { Button } from '@/components/ui/button'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useIsMounted } from '@/hooks/use-is-mounted'

const ICON_SIZE = 20

const ThemeSwitcher = () => {
  const mounted = useIsMounted()
  const { setTheme, theme } = useTheme()

  if (!mounted) {
    return null
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      className="text-white hover:bg-white/10"
    >
      {theme === 'light' ? (
        <Moon size={ICON_SIZE} />
      ) : (
        <Sun size={ICON_SIZE} />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}

export { ThemeSwitcher }

import { Button } from "@/components/ui/button"
import Link from "next/link"
import { LogoutButton } from "./logout-button"

type DashboardHeaderProps = {
  userRole?: string
  userName?: string
}

export function DashboardHeader({ userRole, userName }: DashboardHeaderProps) {
  return (
    <header className="border-b border-border px-6 py-3 flex justify-between items-center">
      <div className="flex items-center gap-2">
        <Link href="/" className="font-semibold text-lg">
          Diocese Management
        </Link>
        <span className="bg-primary/10 text-primary px-2 py-1 rounded text-sm">
          {userRole}
        </span>
      </div>
      
      <div className="flex items-center gap-4">
        {userName && (
          <span className="text-muted-foreground">
            Logged in as: <strong>{userName}</strong>
          </span>
        )}
        
        <LogoutButton />
      </div>
    </header>
  )
} 
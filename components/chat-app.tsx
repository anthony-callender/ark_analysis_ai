'use client'

import { useEffect } from "react";
import { ChatSidebar } from "./chat-sidebar";
import { ChatWindow } from "./chat-window";
import { useAppState } from "@/state";
import { User } from "@supabase/supabase-js";

interface ChatAppProps {
  user: User;
  chatId?: string;
  initialChat?: {
    id: string;
    name: string;
    messages: any[];
  };
}

export function ChatApp({ user, chatId, initialChat }: ChatAppProps) {
  const { setChat } = useAppState();
  
  // Set initial chat if provided - do this only once on mount
  useEffect(() => {
    if (initialChat) {
      setChat(initialChat);
    }
  }, [initialChat, setChat]);

  // Log user object when component mounts - helpful for debugging
  useEffect(() => {
    console.log('ChatApp mounted with user:', user);
  }, [user]);

  return (
    <div className="flex w-full h-screen overflow-hidden fixed inset-0">
      {/* Sidebar */}
      <ChatSidebar />
      
      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <ChatWindow user={user} chatId={chatId} />
      </main>
    </div>
  );
} 
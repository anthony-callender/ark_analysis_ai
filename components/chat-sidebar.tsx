'use client'

import { useState, useEffect } from "react";
import { Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRouter, usePathname } from "next/navigation";
import { SidebarItem } from "./sidebar-item";
import { useAppState } from "@/state";
import { v4 as uuidv4 } from "uuid";
import { useChatPersistence } from "@/hooks/use-chat-persistence";

export function ChatSidebar() {
  const { chats, setChats, setChat, chat: activeChat, updateChats } = useAppState();
  const { persistChat } = useChatPersistence();
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);

  // Parse the active chat ID from the URL
  const activeId = pathname.startsWith('/app/') 
    ? pathname.split('/')[2] 
    : activeChat?.id || null;

  // Load chats on mount and set up interval refresh
  useEffect(() => {
    // Initial load
    updateChats().catch(console.error);
    
    // Set up polling to refresh chat list less frequently (every 10 seconds)
    const intervalId = setInterval(() => {
      updateChats().catch(console.error);
    }, 10000); // Changed from 5000 to 10000 ms
    
    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [updateChats]);
  
  // Create a new chat
  const createChat = async () => {
    if (loading) return;
    setLoading(true);
    
    try {
      const id = uuidv4();
      const newChatName = "New Chat";
      
      // Create the new chat in state
      const newChat = { 
        id, 
        name: newChatName, 
        messages: [] 
      };

      setChat(newChat);
      
      // Save to database
      await persistChat(id, newChatName, []);
      
      // Navigate to the new chat
      router.push(`/app/${id}`);
      
      // Refresh the chat list
      await updateChats();
    } catch (error) {
      console.error("Error creating chat:", error);
    } finally {
      setLoading(false);
    }
  };

  // Group chats by date
  const groupedChats = chats.reduce((groups, chat) => {
    const date = new Date(chat.created_at);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Format dates to compare
    const chatDate = date.toDateString();
    const todayDate = today.toDateString();
    const yesterdayDate = yesterday.toDateString();
    
    let group;
    if (chatDate === todayDate) {
      group = "Today";
    } else if (chatDate === yesterdayDate) {
      group = "Yesterday";
    } else {
      group = "Past Chats";
    }
    
    if (!groups[group]) {
      groups[group] = [];
    }
    
    groups[group].push({
      id: chat.id,
      title: chat.name,
      messages: [], // We don't need to load all messages for the sidebar
    });
    
    return groups;
  }, {} as Record<string, { id: string; title: string; messages: any[] }[]>);

  // Sort groups by priority
  const sortedGroups = [
    { title: "Today", chats: groupedChats["Today"] || [] },
    { title: "Yesterday", chats: groupedChats["Yesterday"] || [] },
    { title: "Past Chats", chats: groupedChats["Past Chats"] || [] },
  ].filter(group => group.chats.length > 0);

  return (
    <aside className="w-64 border-r p-2 flex flex-col bg-background h-full min-h-screen">
      <div className="flex items-center justify-between mb-2 px-2">
        <h2 className="font-semibold text-lg">Chats</h2>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" onClick={() => router.push('/settings')} title="Settings">
            <Settings className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="secondary" onClick={createChat} disabled={loading}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 pr-1">
        {sortedGroups.map((group) => (
          <div key={group.title} className="mb-3">
            <h3 className="text-sm font-medium text-muted-foreground mb-1 px-2">
              {group.title}
            </h3>
            <ul className="space-y-1">
              {group.chats.map((chat) => (
                <SidebarItem
                  key={chat.id}
                  chat={chat}
                  active={chat.id === activeId}
                  onSelect={() => router.push(`/app/${chat.id}`)}
                />
              ))}
            </ul>
          </div>
        ))}
        
        {chats.length === 0 && (
          <p className="text-sm text-muted-foreground px-2 pt-4">
            No chats yet – create one!
          </p>
        )}
      </ScrollArea>
    </aside>
  );
} 
'use client'

import { useState, useEffect, useMemo } from "react";
import { Plus, Settings, RefreshCcw } from "lucide-react";
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
  const [refreshing, setRefreshing] = useState(false);

  // Parse the active chat ID from the URL
  const activeId = pathname.startsWith('/app/') 
    ? pathname.split('/')[2] 
    : activeChat?.id || null;

  // Only load chats on mount - no interval refresh to avoid potential loops
  useEffect(() => {
    // Initial load once
    const loadChats = async () => {
      try {
        await updateChats();
      } catch (error) {
        console.error("Error loading chats:", error);
      }
    };
    
    loadChats();
    // No dependencies - only run once on mount
  }, []);
  
  // Manual refresh function
  const handleManualRefresh = async () => {
    if (refreshing) return;
    
    setRefreshing(true);
    try {
      await updateChats();
    } catch (error) {
      console.error("Error refreshing chats:", error);
    } finally {
      setRefreshing(false);
    }
  };
  
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

  // Memoize the sorted groups to prevent unnecessary re-renders
  const sortedGroups = useMemo(() => {
    // Simple function to get group name based on date
    const getGroupName = (dateStr: string) => {
      try {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (date.toDateString() === today.toDateString()) return "Today";
        if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
        return "Past Chats";
      } catch (e) {
        return "Past Chats";
      }
    };

    // Group the chats
    const groups: Record<string, Array<{id: string, title: string, messages: any[]}>> = {};
    
    // Initialize all possible groups to ensure consistent order
    groups["Today"] = [];
    groups["Yesterday"] = [];
    groups["Past Chats"] = [];
    
    // Add chats to groups
    chats.forEach(chat => {
      const group = getGroupName(chat.created_at);
      groups[group].push({
        id: chat.id,
        title: chat.name,
        messages: [], // We don't need messages for the sidebar
      });
    });
    
    // Return only non-empty groups
    return Object.entries(groups)
      .filter(([_, items]) => items.length > 0)
      .map(([title, chats]) => ({ title, chats }));
  }, [chats]);

  return (
    <aside className="w-64 border-r p-2 flex flex-col h-full relative bg-gradient-to-br from-primary-900 via-primary-950 to-primary-900 dark:from-neutral-900 dark:via-neutral-900 dark:to-neutral-800 text-white">
      <div className="flex items-center justify-between mb-4 px-2 sticky top-0 z-10 backdrop-blur-sm bg-primary-900/40 dark:bg-neutral-900/50 py-2 rounded-lg">
        <h2 className="font-semibold text-lg">Chats</h2>
        <div className="flex gap-1">
          <Button 
            size="icon" 
            variant="ghost" 
            onClick={handleManualRefresh} 
            disabled={refreshing}
            title="Refresh chats"
            className="text-white hover:bg-white/10"
          >
            <RefreshCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button 
            size="icon" 
            variant="ghost" 
            onClick={() => router.push('/settings')} 
            title="Settings"
            className="text-white hover:bg-white/10"
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Button 
            size="icon"
            onClick={createChat} 
            disabled={loading}
            className="btn-gradient"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 pr-1">
        {sortedGroups.map((group) => (
          <div key={group.title} className="mb-3">
            <h3 className="text-sm font-medium text-white/70 mb-2 px-2">
              {group.title}
            </h3>
            <ul className="space-y-2">
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
          <div className="glass-panel rounded-lg p-4 mt-2 mx-2">
            <p className="text-sm text-white/80">
              No chats yet – create one!
            </p>
          </div>
        )}
      </ScrollArea>
    </aside>
  );
} 
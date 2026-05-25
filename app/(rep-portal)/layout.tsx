import AuthProvider from "@/components/auth-provider";
import { ChatWidget } from "@/components/chat-widget";

export default function RepPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-stone-50">
        {children}
        <ChatWidget />
      </div>
    </AuthProvider>
  );
}

import AuthProvider from "@/components/auth-provider";

export default function RepPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-stone-950">
        {children}
      </div>
    </AuthProvider>
  );
}

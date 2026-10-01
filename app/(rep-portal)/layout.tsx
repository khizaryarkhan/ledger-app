import AuthProvider from "@/components/auth-provider";
import { DataProvider } from "@/components/data-provider";

export default function RepPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>
        <div className="min-h-screen bg-stone-950">
          {children}
        </div>
      </DataProvider>
    </AuthProvider>
  );
}

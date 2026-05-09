"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useData } from "@/components/data-provider";
import { Card } from "@/components/ui";
import { Building2, Users, Link2, Mail, ChevronRight, CheckCircle, AlertCircle, Loader } from "lucide-react";

export default function SettingsPage() {
  const { data: session } = useSession();
  const { reps, regions } = useData();
  const [qboStatus, setQboStatus] = useState<any>(null);
  const [smtpStatus, setSmtpStatus] = useState<any>(null);

  useEffect(() => {
    fetch("/api/qbo/sync").then(r => r.json()).then(setQboStatus).catch(() => setQboStatus({ connected: false }));
    fetch("/api/org/smtp").then(r => r.json()).then(setSmtpStatus).catch(() => setSmtpStatus({ configured: false }));
  }, []);

  const userName = session?.user?.name || "";
  const userEmail = session?.user?.email || "";

  const groups = [
    {
      href: "/settings/company",
      icon: Building2,
      title: "Company",
      description: "Organisation profile, display name, logo and date format preferences.",
      badge: null,
    },
    {
      href: "/settings/team",
      icon: Users,
      title: "Team",
      description: `${reps?.length ?? 0} rep${(reps?.length ?? 0) !== 1 ? "s" : ""} · ${regions?.length ?? 0} region${(regions?.length ?? 0) !== 1 ? "s" : ""}. Manage reps, regions, portal logins and classification.`,
      badge: null,
    },
    {
      href: "/settings/integrations",
      icon: Link2,
      title: "Integrations",
      description: "QuickBooks Online connection, sync controls, reconciliation, history and data tools.",
      badge:
        qboStatus === null
          ? { state: "loading", label: "" }
          : qboStatus.connected
          ? { state: "ok", label: `Connected · ${qboStatus.companyName || "QBO"}` }
          : { state: "off", label: "Not connected" },
    },
    {
      href: "/settings/notifications",
      icon: Mail,
      title: "Notifications & Email",
      description: "SMTP server configuration for sending collection reminder emails and receipts.",
      badge:
        smtpStatus === null
          ? { state: "loading", label: "" }
          : smtpStatus.configured
          ? { state: "ok", label: `From: ${smtpStatus.settings?.fromEmail || "configured"}` }
          : { state: "off", label: "Not configured" },
    },
  ];

  return (
    <div className="p-6 max-w-[860px] mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Settings</h1>
        <p className="text-sm text-stone-500 mt-1">
          Manage your company, team, integrations and notification preferences.
        </p>
      </div>

      {/* Profile summary */}
      <div className="flex items-center gap-3 mb-8 p-4 bg-stone-50 rounded-xl ring-1 ring-stone-200">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-stone-700 to-stone-900 flex items-center justify-center text-white text-sm font-semibold shrink-0">
          {userName.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase()}
        </div>
        <div>
          <div className="text-sm font-semibold text-stone-900">{userName}</div>
          <div className="text-[12px] text-stone-500">{userEmail}</div>
        </div>
        <div className="ml-auto">
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-stone-200 text-stone-600">
            {(session?.user as any)?.role || "User"}
          </span>
        </div>
      </div>

      {/* Settings groups grid */}
      <div className="grid grid-cols-2 gap-4">
        {groups.map(group => {
          const Icon = group.icon;
          return (
            <Link key={group.href} href={group.href} className="block">
              <Card className="h-full hover:shadow-md hover:ring-stone-300 transition-all cursor-pointer group p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center shrink-0 group-hover:bg-stone-200 transition-colors">
                    <Icon size={18} className="text-stone-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-semibold text-stone-900">{group.title}</h3>
                      <ChevronRight
                        size={15}
                        className="text-stone-400 group-hover:text-stone-700 transition-colors shrink-0"
                      />
                    </div>
                    <p className="text-[12px] text-stone-500 leading-relaxed mb-3">{group.description}</p>

                    {group.badge && (
                      group.badge.state === "loading" ? (
                        <div className="inline-flex items-center gap-1.5">
                          <Loader size={11} className="animate-spin text-stone-400" />
                          <span className="text-[11px] text-stone-400">Checking…</span>
                        </div>
                      ) : (
                        <div
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            group.badge.state === "ok"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-stone-100 text-stone-500"
                          }`}
                        >
                          {group.badge.state === "ok" ? (
                            <CheckCircle size={11} />
                          ) : (
                            <AlertCircle size={11} />
                          )}
                          {group.badge.label}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useEffect, ReactNode } from "react";
import { X, Check, AlertCircle } from "lucide-react";

export const Badge = ({ children, variant = "neutral", size = "sm" }: { children: ReactNode; variant?: string; size?: string }) => {
  const variants: Record<string, string> = {
    neutral: "bg-stone-100 text-stone-700 ring-stone-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    yellow: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-rose-50 text-rose-700 ring-rose-200",
    purple: "bg-violet-50 text-violet-700 ring-violet-200",
    orange: "bg-orange-50 text-orange-700 ring-orange-200",
  };
  const sizes: Record<string, string> = { sm: "text-[11px] px-2 py-0.5", md: "text-xs px-2.5 py-1" };
  return <span className={`inline-flex items-center gap-1 rounded-md ring-1 ring-inset font-medium ${variants[variant]} ${sizes[size]}`}>{children}</span>;
};

export const stageBadge = (stage: string) => {
  const map: Record<string, string> = {
    "New": "neutral", "Reminder Scheduled": "blue", "Reminder Sent": "blue",
    "Awaiting Reply": "purple", "Promise to Pay": "yellow", "Disputed": "red",
    "Escalated": "red", "On Hold": "orange", "Closed": "green",
  };
  return map[stage] || "neutral";
};

export const dueStatusBadge = (status: string) => {
  const map: Record<string, string> = { "Paid": "green", "Overdue": "red", "Due Today": "orange", "Due Soon": "yellow", "Not Due": "neutral", "Written Off": "neutral" };
  return map[status] || "neutral";
};

export const Button = ({ children, variant = "primary", size = "md", onClick, disabled, icon: Icon, type = "button", className = "" }: any) => {
  const variants: Record<string, string> = {
    primary: "bg-stone-900 text-white hover:bg-stone-800 disabled:bg-stone-300",
    secondary: "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50 hover:ring-stone-300",
    ghost: "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  };
  const sizes: Record<string, string> = { sm: "h-7 px-2.5 text-xs gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-10 px-4 text-sm gap-2" };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center font-medium rounded-md transition-colors ${variants[variant]} ${sizes[size]} ${className}`}>
      {Icon && <Icon size={size === "sm" ? 13 : 15} strokeWidth={2} />}
      {children}
    </button>
  );
};

export const Input = ({ value, onChange, placeholder, type = "text", className = "", icon: Icon, ...rest }: any) => (
  <div className={`relative ${className}`}>
    {Icon && <Icon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" strokeWidth={2} />}
    <input type={type} value={value ?? ""} onChange={onChange} placeholder={placeholder}
      className={`w-full h-9 ${Icon ? "pl-8" : "pl-3"} pr-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none placeholder-stone-400 bg-white`}
      {...rest} />
  </div>
);

export const Select = ({ value, onChange, options, placeholder, className = "" }: any) => (
  <select value={value ?? ""} onChange={onChange}
    className={`h-9 px-3 pr-8 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white appearance-none bg-no-repeat ${className}`}
    style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: "right 0.5rem center", backgroundSize: "12px" }}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map((o: any) => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
  </select>
);

export const Card = ({ children, className = "", padding = "md" }: any) => {
  const pad: Record<string, string> = { none: "", sm: "p-3", md: "p-5", lg: "p-6" };
  return <div className={`bg-white rounded-lg ring-1 ring-stone-200 ${pad[padding]} ${className}`}>{children}</div>;
};

export const Modal = ({ open, onClose, title, children, size = "md", footer }: any) => {
  if (!open) return null;
  const sizes: Record<string, string> = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", xl: "max-w-6xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${sizes[size]} max-h-[92vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <h3 className="text-base font-semibold text-stone-900 tracking-tight">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-stone-200 flex items-center justify-end gap-2 bg-stone-50/50 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
};

export const EmptyState = ({ icon: Icon, title, description, action }: any) => (
  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
    <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mb-4">
      <Icon size={20} className="text-stone-400" strokeWidth={1.75} />
    </div>
    <h3 className="text-sm font-semibold text-stone-900 mb-1">{title}</h3>
    <p className="text-sm text-stone-500 max-w-sm mb-5">{description}</p>
    {action}
  </div>
);

export const Toast = ({ toast, onClose }: any) => {
  useEffect(() => {
    if (toast) { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }
  }, [toast, onClose]);
  if (!toast) return null;
  const variants: Record<string, string> = { success: "bg-emerald-600", error: "bg-rose-600", info: "bg-stone-900" };
  return (
    <div className="fixed bottom-6 right-6 z-50 animate-toast">
      <div className={`${variants[toast.type] || variants.info} text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2`}>
        {toast.type === "success" && <Check size={16} />}
        {toast.type === "error" && <AlertCircle size={16} />}
        {toast.message}
      </div>
    </div>
  );
};

export const RegionFilter = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const { REGIONS } = require("@/lib/regions");
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="h-9 px-3 pr-8 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white appearance-none bg-no-repeat"
      style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: "right 0.5rem center", backgroundSize: "12px" }}>
      <option value="">All regions</option>
      {REGIONS.map((r: any) => <option key={r.id} value={r.id}>{r.label}</option>)}
    </select>
  );
};


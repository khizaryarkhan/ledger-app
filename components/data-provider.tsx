"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";

type DataContextType = {
  loaded: boolean;
  customers: any[];
  contacts: any[];
  projects: any[];
  invoices: any[];
  communications: any[];
  tasks: any[];
  refresh: () => Promise<void>;
  toast: (message: string, type?: string) => void;
  toastState: any;
  clearToast: () => void;
  updateInvoice: (id: string, patch: any) => Promise<any>;
  recordPayment: (id: string, amount: number) => Promise<any>;
  addContact: (data: any) => Promise<any>;
  addNote: (data: any) => Promise<any>;
  sendEmail: (data: any) => Promise<any>;
  addTask: (data: any) => Promise<any>;
  toggleTask: (id: string, completed: boolean) => Promise<any>;
  importInvoices: (rows: any[]) => Promise<any>;
  addCustomer: (data: any) => Promise<any>;
  updateCustomer: (id: string, data: any) => Promise<any>;
  addProject: (data: any) => Promise<any>;
  updateProject: (id: string, data: any) => Promise<any>;
  addInvoice: (data: any) => Promise<any>;
  bulkDeleteInvoices: (ids: string[]) => Promise<any>;
  bulkDeleteCustomers: (ids: string[]) => Promise<any>;
  bulkDeleteProjects: (ids: string[]) => Promise<any>;
};

const DataContext = createContext<DataContextType | null>(null);

async function fetchJSON(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

const postJSON = (url: string, data: any) => fetchJSON(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const patchJSON = (url: string, data: any) => fetchJSON(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

export function DataProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [communications, setCommunications] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [toastState, setToastState] = useState<any>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, ct, p, i, comm, t] = await Promise.all([
        fetchJSON("/api/customers"),
        fetchJSON("/api/contacts"),
        fetchJSON("/api/projects"),
        fetchJSON("/api/invoices"),
        fetchJSON("/api/communications"),
        fetchJSON("/api/tasks"),
      ]);
      setCustomers(c); setContacts(ct); setProjects(p); setInvoices(i); setCommunications(comm); setTasks(t);
    } catch (e: any) {
      console.error("Refresh failed:", e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toast = (message: string, type = "success") => setToastState({ message, type });
  const clearToast = () => setToastState(null);

  const addCustomer = async (data: any) => {
    const created = await postJSON("/api/customers", data);
    setCustomers(prev => [created, ...prev]);
    toast("Customer created");
    return created;
  };

  const updateCustomer = async (id: string, data: any) => {
    const updated = await patchJSON(`/api/customers/${id}`, data);
    setCustomers(prev => prev.map(c => c.id === id ? updated : c));
    toast("Customer updated");
    return updated;
  };

  const addProject = async (data: any) => {
    const created = await postJSON("/api/projects", data);
    setProjects(prev => [created, ...prev]);
    toast("Project created");
    return created;
  };

  const updateProject = async (id: string, data: any) => {
    const updated = await patchJSON(`/api/projects/${id}`, data);
    setProjects(prev => prev.map(p => p.id === id ? updated : p));
    toast("Project updated");
    return updated;
  };

  const addInvoice = async (data: any) => {
    const created = await postJSON("/api/invoices", data);
    setInvoices(prev => [created, ...prev]);
    toast("Invoice created");
    return created;
  };

  const updateInvoice = async (id: string, patch: any) => {
    const updated = await patchJSON(`/api/invoices/${id}`, patch);
    setInvoices(prev => prev.map(i => i.id === id ? updated : i));
    toast("Invoice updated");
    return updated;
  };

  const recordPayment = async (id: string, amount: number) => {
    const updated = await postJSON(`/api/invoices/${id}/payment`, { amount });
    setInvoices(prev => prev.map(i => i.id === id ? updated : i));
    toast(updated.paymentStatus === "Paid" ? "Invoice marked as paid" : "Partial payment recorded");
    return updated;
  };

  const addContact = async (data: any) => {
    const created = await postJSON("/api/contacts", data);
    setContacts(prev => [...prev, created]);
    toast("Contact added");
    return created;
  };

  const addNote = async ({ customerId, invoiceId, body }: any) => {
    const created = await postJSON("/api/communications", { customerId, invoiceId, direction: "Outbound", channel: "Note", subject: "Internal note", body });
    setCommunications(prev => [created, ...prev]);
    toast("Note saved");
    return created;
  };

  const sendEmail = async (data: any) => {
    const created = await postJSON("/api/communications", { ...data, direction: "Outbound", channel: "Email" });
    setCommunications(prev => [created, ...prev]);
    if (data.invoiceId && !data.isDraft) {
      const inv = await fetchJSON("/api/invoices");
      setInvoices(inv);
    }
    toast(data.isDraft ? "Draft saved" : "Email sent");
    return created;
  };

  const addTask = async (data: any) => {
    const created = await postJSON("/api/tasks", data);
    setTasks(prev => [created, ...prev]);
    toast("Task added");
    return created;
  };

  const toggleTask = async (id: string, completed: boolean) => {
    const updated = await patchJSON(`/api/tasks/${id}`, { completed });
    setTasks(prev => prev.map(t => t.id === id ? updated : t));
    return updated;
  };

  const importInvoices = async (rows: any[]) => {
    const result = await postJSON("/api/import", { rows });
    if (result.imported > 0) {
      const inv = await fetchJSON("/api/invoices");
      setInvoices(inv);
    }
    toast(`Imported ${result.imported} invoices${result.errors.length ? ` (${result.errors.length} errors)` : ""}`);
    return result;
  };

  const bulkDeleteInvoices = async (ids: string[]) => {
    await postJSON("/api/invoices/bulk-delete", { ids });
    setInvoices(prev => prev.filter(i => !ids.includes(i.id)));
    toast(`${ids.length} invoice${ids.length > 1 ? "s" : ""} deleted`);
  };

  const bulkDeleteCustomers = async (ids: string[]) => {
    await postJSON("/api/customers/bulk-delete", { ids });
    setCustomers(prev => prev.filter(c => !ids.includes(c.id)));
    toast(`${ids.length} customer${ids.length > 1 ? "s" : ""} deleted`);
  };

  const bulkDeleteProjects = async (ids: string[]) => {
    await postJSON("/api/projects/bulk-delete", { ids });
    setProjects(prev => prev.filter(p => !ids.includes(p.id)));
    toast(`${ids.length} project${ids.length > 1 ? "s" : ""} deleted`);
  };

  return (
    <DataContext.Provider value={{
      loaded, customers, contacts, projects, invoices, communications, tasks,
      refresh, toast, toastState, clearToast,
      updateInvoice, recordPayment, addContact, addNote, sendEmail, addTask, toggleTask, importInvoices,
      addCustomer, updateCustomer, addProject, updateProject, addInvoice, bulkDeleteInvoices, bulkDeleteCustomers, bulkDeleteProjects,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

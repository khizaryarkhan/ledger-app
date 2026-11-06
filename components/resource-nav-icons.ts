/**
 * Icons for the Resources menu (lib/resources/nav.ts), shared by the app
 * sidebar and the employee portal so the same link wears the same icon in both.
 */
import {
  LayoutDashboard, Bell, Gauge, Contact, Clock, CheckSquare, ClipboardList, Scale, ScrollText,
  CalendarClock, BarChart3, Wrench, Users, MapPin,
} from "lucide-react";
import type { ComponentType } from "react";
import type { ResourceNavIcon } from "@/lib/resources/nav";

type Icon = ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;

export const RESOURCE_NAV_ICONS: Record<ResourceNavIcon, Icon> = {
  dashboard: LayoutDashboard, notifications: Bell, reports: Gauge, details: Contact, timesheet: Clock, approve: CheckSquare,
  compliance: ClipboardList, enquiry: Scale, post: ScrollText, planning: CalendarClock, utilisation: Gauge,
  team: BarChart3, cost: Scale, equipment: Wrench, machine: Gauge, people: Users, designation: ClipboardList,
  types: ClipboardList, leave: Scale, calendar: MapPin, payroll: ScrollText,
};
